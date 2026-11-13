// Autopilot: once a week, at the day and time you choose, drafts the coming week's posts for each
// brand plan (with images, if switched on and set up), learning from recent Buffer results.
// Drafts wait in an inbox until the app imports them for you to review; nothing is published.
const crypto = require('node:crypto');
const path = require('node:path');
const store = require('./store');
const claude = require('./claude');
const shared = require('../public/shared.js');

const MAX_POSTS = 14; // per brand plan
const MAX_PLANS = 10;

function create({ env, dir, ai, social, images }) {
  const config = store.open(path.join(dir, 'autopilot.json'), () => ({
    enabled: false, day: 0, time: '17:00', timezone: 'Africa/Lagos', learn: true, notify: true,
    plans: [], context: { offers: [], recent: {} }, enabledAt: null, lastRun: null, lastResult: null,
  }));
  const inbox = store.open(path.join(dir, 'autopilot-inbox.json'), () => ({ drafts: [] }));
  const tick = Number(env.SOULVEE_SCHEDULER_MS) || 30000;
  const state = { running: false, progress: '' };

  // The first scheduled moment after the last run (or after autopilot was switched on).
  // A manual run counts as the scheduled one if that falls within the next 48 hours.
  function nextRun(cfg) {
    const manual = cfg.lastResult && cfg.lastResult.trigger === 'manual' && cfg.lastRun;
    const first = slotAfter(cfg, new Date(cfg.lastRun || cfg.enabledAt || Date.now()));
    if (manual && first && Date.parse(first) - Date.parse(cfg.lastRun) < 48 * 3600e3) return slotAfter(cfg, new Date(Date.parse(first) + 60e3));
    return first;
  }

  function slotAfter(cfg, anchor) {
    const p = shared.zoneParts(anchor, cfg.timezone);
    const [hour, minute] = cfg.time.split(':').map(Number);
    for (let i = 0; i <= 7; i++) {
      const base = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
      const at = shared.zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute, cfg.timezone);
      if (shared.zoneParts(at, cfg.timezone).weekday === cfg.day && at > anchor) return at.toISOString();
    }
    return null;
  }

  function status() {
    const cfg = config.get();
    return {
      enabled: cfg.enabled, day: cfg.day, time: cfg.time, timezone: cfg.timezone, learn: cfg.learn, notify: cfg.notify, plans: cfg.plans,
      nextRun: cfg.enabled ? nextRun(cfg) : null, lastRun: cfg.lastRun, lastResult: cfg.lastResult,
      running: state.running, progress: state.progress, inbox: inbox.get().drafts.length,
      ready: !!ai.client, images: images.status(), buffer: social.status().buffer, webhook: social.status().webhook,
      contextAt: cfg.context.updatedAt || null,
    };
  }

  function update(raw) {
    if (!raw || typeof raw !== 'object') throw fail('bad_config', 'Bad autopilot settings.');
    const cfg = config.get();
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw.time)) ? String(raw.time) : cfg.time;
    const timezone = validZone(raw.timezone) ? raw.timezone : cfg.timezone;
    const plans = (Array.isArray(raw.plans) ? raw.plans : []).slice(0, MAX_PLANS).map(cleanPlan).filter(Boolean);
    const enabled = !!raw.enabled;
    if (enabled && !plans.length) throw fail('no_plans', 'Add at least one brand plan before switching autopilot on.');
    if (enabled && !cfg.enabled) cfg.enabledAt = new Date().toISOString();
    // Changing the schedule restarts the count from now, so it never fires for a time already passed.
    if (enabled && (time !== cfg.time || timezone !== cfg.timezone || Number(raw.day) !== cfg.day)) cfg.enabledAt = new Date().toISOString();
    Object.assign(cfg, { enabled, day: Math.max(0, Math.min(6, Math.round(Number(raw.day)) || 0)), time, timezone, learn: raw.learn !== false, notify: raw.notify !== false, plans });
    if (enabled) cfg.lastRun = cfg.lastRun && Date.parse(cfg.lastRun) > Date.parse(cfg.enabledAt) ? cfg.lastRun : null;
    config.save();
    return status();
  }

  // The app sends what autopilot needs to know about: live offers and recent post titles per brand.
  function setContext(raw) {
    const cfg = config.get();
    const offers = (raw && Array.isArray(raw.offers) ? raw.offers : []).slice(0, 100).map(o => ({
      id: String(o.id || '').slice(0, 64), brand: String(o.brand || ''), name: String(o.name || '').slice(0, 120), pitch: String(o.pitch || '').slice(0, 400),
      tiers: (Array.isArray(o.tiers) ? o.tiers : []).slice(0, 6).map(t => ({ name: String(t.name || '').slice(0, 60), price: Number(t.price) || 0 })),
    }));
    const recent = {};
    Object.entries((raw && raw.recent) || {}).forEach(([brand, titles]) => { if (Array.isArray(titles)) recent[brand] = titles.slice(0, 30).map(t => String(t).slice(0, 120)); });
    cfg.context = { offers, recent, updatedAt: new Date().toISOString() };
    config.save();
    return { ok: true };
  }

  async function run(trigger) {
    if (state.running) throw fail('busy', 'Autopilot is already running.');
    if (!ai.client) throw fail('no_key', 'Autopilot needs AI: add ANTHROPIC_API_KEY to the server.');
    const cfg = config.get();
    const plans = cfg.plans.filter(p => p.enabled !== false);
    if (!plans.length) throw fail('no_plans', 'Add at least one brand plan first.');
    state.running = true;
    const started = new Date();
    const runId = `run_${crypto.randomUUID()}`;
    const label = `Autopilot · ${shared.longDate(started, cfg.timezone)}`;
    const drafts = [];
    const problems = [];
    const finish = async () => {
      inbox.get().drafts.push(...drafts);
      await inbox.save();
      cfg.lastRun = started.toISOString();
      cfg.lastResult = { at: new Date().toISOString(), ok: drafts.length > 0, drafts: drafts.length, images: drafts.filter(d => d.media.length).length, trigger, problems };
      await config.save();
      state.running = false;
      state.progress = '';
      if (cfg.notify && drafts.length && social.status().webhook) {
        const brands = {};
        drafts.forEach(d => { brands[d.brand] = (brands[d.brand] || 0) + 1; });
        social.notify('autopilot.ready', { runId, drafts: drafts.length, brands, titles: drafts.map(d => d.title), appUrl: (env.PUBLIC_URL || '').replace(/\/$/, '') ? `${env.PUBLIC_URL.replace(/\/$/, '')}/#content` : '' }).catch(() => {});
      }
    };
    try {
      state.progress = 'Reading what worked';
      const learnings = cfg.learn && social.status().buffer ? await social.insights({ tz: cfg.timezone }).then(r => r.learnings, () => '') : '';
      for (const plan of plans) {
        const brand = shared.brandOf(plan.brand);
        state.progress = `Writing ${brand.short} posts`;
        const offer = cfg.context.offers.find(o => o.id === plan.offerId) || null;
        const prompt = shared.contentPrompt({ brand: plan.brand, goal: plan.goal, offer, platforms: plan.platforms, count: plan.count, firstDay: 1, lastDay: 7, today: started, tz: cfg.timezone, learnings, recent: cfg.context.recent[plan.brand] || [] });
        const out = await claude.generate(ai, { prompt, schema: shared.CONTENT_SCHEMA, effort: 'medium' }).catch(err => ({ error: err }));
        if (out.error) { problems.push(`${brand.short}: ${out.error.message}`); continue; }
        const posts = (Array.isArray(out.posts) ? out.posts : []).slice(0, plan.count);
        for (const [i, p] of posts.entries()) {
          const draft = shared.draftFromAi(p, { brand: plan.brand, platforms: plan.platforms, tz: cfg.timezone, firstDay: 1, lastDay: 7, now: started, source: { type: 'autopilot', id: runId, label } });
          draft.id = `ap_${crypto.randomUUID()}`;
          draft.autopilot = true;
          if (plan.images && images.status().ready && draft.visual) {
            state.progress = `Making ${brand.short} images (${i + 1}/${posts.length})`;
            const media = await images.generate({ brand: plan.brand, visual: draft.visual, format: draft.format, platforms: draft.platforms, title: draft.title }).catch(err => ({ error: err }));
            if (media.error) draft.notes = `Image not made: ${media.error.message}`;
            if (!media.error) draft.media = [{ type: 'image', url: media.url }];
          }
          drafts.push(draft);
        }
      }
    } catch (err) {
      problems.push(err.message);
    }
    await finish();
    return status();
  }

  // Starts a run in the background; the app polls status() to follow it.
  function runNow() {
    if (state.running) throw fail('busy', 'Autopilot is already running.');
    if (!ai.client) throw fail('no_key', 'Autopilot needs AI: add ANTHROPIC_API_KEY to the server.');
    if (!config.get().plans.some(p => p.enabled !== false)) throw fail('no_plans', 'Add at least one brand plan first.');
    run('manual').catch(err => console.error(`Autopilot run failed: ${err.message}`));
    return { ...status(), running: true };
  }

  function due() {
    const cfg = config.get();
    if (!cfg.enabled || state.running || !ai.client) return false;
    const at = nextRun(cfg);
    return !!at && Date.parse(at) <= Date.now();
  }

  function start() {
    const timer = setInterval(() => { if (due()) run('schedule').catch(err => console.error(`Autopilot run failed: ${err.message}`)); }, tick);
    timer.unref();
  }

  function take() {
    return inbox.get().drafts;
  }

  function ack(ids) {
    const data = inbox.get();
    const before = data.drafts.length;
    data.drafts = data.drafts.filter(d => !ids.includes(d.id));
    inbox.save();
    return { removed: before - data.drafts.length, left: data.drafts.length };
  }

  return { status, update, setContext, runNow, start, take, ack };
}

function cleanPlan(raw) {
  if (!raw || typeof raw !== 'object' || !shared.BRANDS.some(b => b.id === raw.brand)) return null;
  const platforms = (Array.isArray(raw.platforms) ? raw.platforms : []).filter(id => shared.PLATFORMS.some(p => p.id === id));
  return {
    brand: raw.brand,
    count: Math.max(1, Math.min(MAX_POSTS, Math.round(Number(raw.count)) || 5)),
    platforms: platforms.length ? platforms : ['instagram'],
    goal: String(raw.goal || '').slice(0, 300),
    offerId: String(raw.offerId || '').slice(0, 64),
    images: !!raw.images,
    enabled: raw.enabled !== false,
  };
}

function validZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

module.exports = { create };
