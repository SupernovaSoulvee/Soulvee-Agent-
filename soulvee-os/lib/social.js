// Social publishing, three ways:
//   Accounts - Facebook Pages, Instagram, Threads, X, LinkedIn, Telegram channels and Reddit, connected
//              directly in Accounts. Soulvee OS posts at the scheduled time and retries if a network is down.
//   Buffer   - one API key posts to Instagram, TikTok, Facebook, LinkedIn, X, Threads, YouTube
//              and Pinterest. Buffer does the scheduling, so nothing has to stay running.
//   Webhook  - Soulvee OS calls a Make, Zapier or n8n webhook at the scheduled time and that
//              scenario posts it. Jobs are kept on disk and retried if the webhook fails.
const crypto = require('node:crypto');
const path = require('node:path');
const store = require('./store');
const providers = require('./providers');
const shared = require('../public/shared.js');

const SERVICES = new Set(['instagram', 'tiktok', 'facebook', 'linkedin', 'twitter', 'threads', 'youtube', 'pinterest', 'bluesky', 'mastodon', 'googlebusiness', 'substack']);
const NEEDS_MEDIA = { instagram: 'an image or video', tiktok: 'a video or photos', youtube: 'a video', pinterest: 'an image or video' };
const RETRY = [60e3, 5 * 60e3, 15 * 60e3]; // waits before attempts 2, 3 and 4
const KEEP_DAYS = 60;

const ORGANIZATIONS = 'query SoulveeOrganizations { account { organizations { id name } } }';
const CREATE = `mutation SoulveeCreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id dueAt } }
    ... on MutationError { message }
  }
}`;
const postsQuery = (org, since, after) => `query SoulveeResults { posts(first: 50${after ? `, after: ${JSON.stringify(after)}` : ''}, input: { organizationId: ${JSON.stringify(org)}, filter: { status: [sent], startDate: ${JSON.stringify(since)} } }) { edges { node { id text dueAt sentAt channelId channelService metrics { type value unit } metricsUpdatedAt } } pageInfo { endCursor hasNextPage } } }`;
const channelsQuery = org => `query SoulveeChannels { channels(input: { organizationId: ${JSON.stringify(org)} }) { id name displayName service avatar isQueuePaused isDisconnected isLocked } }`;

function create(env, dir, deps = {}) {
  const ctx = providers.context(env);
  const accounts = deps.accounts;
  const buffer = { key: env.BUFFER_API_KEY || '', url: env.BUFFER_API_URL || 'https://api.buffer.com' };
  const hook = { url: env.SOCIAL_WEBHOOK_URL || '', secret: env.SOCIAL_WEBHOOK_SECRET || '' };
  const tick = Number(env.SOULVEE_SCHEDULER_MS) || 30000;
  const queue = store.open(path.join(dir, 'social-queue.json'), () => ({ jobs: [] }));
  const state = { cache: null, busy: false, timer: null, insights: null };

  function status() {
    return { buffer: !!buffer.key, webhook: !!hook.url, signed: !!(hook.url && hook.secret) };
  }

  async function gql(query, variables) {
    const res = await fetch(buffer.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${buffer.key}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
    }).catch(err => { throw fail('buffer_network', `Couldn't reach Buffer: ${err.message}`); });
    const body = await res.json().catch(() => null);
    const errors = (body && body.errors) || [];
    const code = errors.map(e => e && e.extensions && e.extensions.code).find(Boolean);
    if (res.status === 401 || code === 'UNAUTHORIZED') throw fail('buffer_auth', 'Buffer rejected the API key. Check BUFFER_API_KEY on the server.');
    if (res.status === 429 || code === 'RATE_LIMIT_EXCEEDED') throw fail('buffer_rate', "Buffer's API limit was reached. Try again in a few minutes.");
    if (!body) throw fail('buffer', `Buffer didn't answer properly (HTTP ${res.status}).`);
    if (errors.length) throw fail('buffer', `Buffer: ${errors.map(e => e.message).join('; ')}`);
    return body.data || {};
  }

  // Every channel connected in Buffer, across all organizations. Cached for 5 minutes.
  async function channels(refresh) {
    if (!buffer.key) throw fail('buffer_off', 'Buffer is not connected: add BUFFER_API_KEY to the server.');
    if (!refresh && state.cache && Date.now() - state.cache.at < 5 * 60e3) return state.cache.list;
    const data = await gql(ORGANIZATIONS);
    const orgs = (data.account && data.account.organizations) || [];
    const lists = await Promise.all(orgs.map(org => gql(channelsQuery(org.id)).then(d => (d.channels || []).map(c => ({ ...c, organizationId: org.id, organization: org.name })))));
    state.cache = { at: Date.now(), list: lists.flat() };
    return state.cache.list;
  }

  async function toBuffer(post) {
    const all = await channels(false);
    const results = [];
    for (const id of post.channels) {
      const channel = all.find(c => c.id === id);
      if (!channel) {
        results.push({ channelId: id, ok: false, message: 'This channel is no longer in Buffer. Refresh the channel list.' });
        continue;
      }
      const base = { channelId: id, service: channel.service, name: channel.displayName || channel.name };
      const problem = mediaProblem(post, channel.service) || channelProblem(channel);
      if (problem) {
        results.push({ ...base, ok: false, message: problem });
        continue;
      }
      const data = await gql(CREATE, { input: bufferInput(post, channel) }).catch(err => ({ error: err }));
      if (data.error) {
        results.push({ ...base, ok: false, message: data.error.message });
        continue;
      }
      const out = data.createPost || {};
      results.push(out.post
        ? { ...base, ok: true, postId: out.post.id, dueAt: out.post.dueAt || post.scheduledAt || null }
        : { ...base, ok: false, message: out.message || "Buffer didn't accept the post." });
    }
    return results;
  }

  function enqueue(post) {
    const now = new Date().toISOString();
    const job = { id: `job_${crypto.randomUUID()}`, post, status: 'scheduled', runAt: post.scheduledAt || now, attempts: 0, createdAt: now, history: [] };
    queue.get().jobs.push(job);
    queue.save();
    setTimeout(run, 0);
    return summary(job);
  }

  async function deliver(job, event) {
    const payload = JSON.stringify({
      event,
      id: job.id,
      sentAt: new Date().toISOString(),
      late: event === 'post.publish' && Date.now() - Date.parse(job.runAt) > 5 * 60e3,
      post: job.post,
    });
    const stamp = String(Math.floor(Date.now() / 1000));
    const headers = { 'content-type': 'application/json', 'user-agent': 'SoulveeOS/1.0', 'x-soulvee-event': event, 'x-soulvee-delivery': job.id, 'x-soulvee-timestamp': stamp };
    // Lets the receiving scenario check the call really came from Soulvee OS.
    if (hook.secret) headers['x-soulvee-signature'] = `sha256=${crypto.createHmac('sha256', hook.secret).update(`${stamp}.${payload}`).digest('hex')}`;
    const res = await fetch(hook.url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(20000) }).catch(err => ({ ok: false, status: 0, error: err }));
    if (res.text) await res.text().catch(() => '');
    if (res.ok) return { ok: true, status: res.status };
    return { ok: false, status: res.status, message: res.error ? `Couldn't reach the webhook: ${res.error.message}` : `The webhook answered HTTP ${res.status}.` };
  }

  // Posts one job to a connected account. A problem that waiting won't fix (too long, missing media,
  // a refused sign-in) fails at once; network trouble and rate limits are retried.
  async function toAccount(job) {
    const acc = accounts && accounts.get(job.accountId);
    if (!acc) return { ok: false, final: true, message: 'That account is no longer connected.' };
    if (!acc.enabled) return { ok: false, final: true, message: 'That account is switched off in Accounts.' };
    const mod = providers.BY_PLATFORM[acc.provider];
    if (!mod || !mod.publish) return { ok: false, final: true, message: 'Posting to this account is not possible.' };
    return providers.fresh(ctx, accounts, acc)
      .then(live => mod.publish(ctx, live, job.post))
      .then(r => ({ ok: true, postId: r.id || '', url: r.url || '' }), err => {
        if (err.code === 'auth') accounts.mark(acc.id, err.message);
        return { ok: false, final: !err.retry, message: err.message };
      });
  }

  async function attempt(job) {
    job.status = 'sending';
    job.attempts += 1;
    await queue.save();
    const out = job.target === 'account' ? await toAccount(job) : await deliver(job, 'post.publish');
    const at = new Date().toISOString();
    job.history.push({ at, ...out });
    if (out.ok) {
      job.status = 'sent';
      job.sentAt = at;
      job.error = '';
      if (out.url) job.url = out.url;
      if (out.postId) job.postId = out.postId;
    }
    if (!out.ok && (out.final || job.attempts > RETRY.length)) {
      job.status = 'failed';
      job.error = out.message;
    }
    if (!out.ok && !out.final && job.attempts <= RETRY.length) {
      job.status = 'scheduled';
      job.runAt = new Date(Date.now() + RETRY[job.attempts - 1]).toISOString();
      job.error = out.message;
    }
    await queue.save();
  }

  async function run() {
    if (state.busy) return;
    state.busy = true;
    const due = queue.get().jobs.filter(j => j.status === 'scheduled' && Date.parse(j.runAt) <= Date.now() && (j.target === 'account' || hook.url));
    for (const job of due) await attempt(job).catch(err => console.error(`Posting job ${job.id} failed: ${err.message}`));
    state.busy = false;
  }

  function start() {
    const data = queue.get();
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    // A job caught mid-send by a restart is sent again; finished jobs are kept for 60 days.
    data.jobs.forEach(j => { if (j.status === 'sending') j.status = 'scheduled'; });
    data.jobs = data.jobs.filter(j => j.status === 'scheduled' || Date.parse(j.createdAt) > cutoff);
    queue.save();
    state.timer = setInterval(run, tick);
    state.timer.unref();
    run();
  }

  function jobs(ids) {
    return queue.get().jobs.filter(j => ids.includes(j.id)).map(summary);
  }

  function cancel(id) {
    const job = queue.get().jobs.find(j => j.id === id);
    if (!job) throw fail('not_found', 'That scheduled post was not found.');
    if (job.status !== 'scheduled') throw fail('too_late', `It can't be cancelled: it is already ${job.status}.`);
    job.status = 'cancelled';
    queue.save();
    return summary(job);
  }

  // Posts to any mix of Buffer channels ("buffer:<id>") and connected accounts. Posts for now are sent
  // straight away and their results returned (waiting up to 25 seconds); scheduled ones are queued.
  async function toAccounts(post) {
    const results = [];
    const bufferIds = post.targets.filter(t => t.startsWith('buffer:')).map(t => t.slice(7));
    if (bufferIds.length && !buffer.key) bufferIds.forEach(id => results.push({ target: 'buffer:' + id, ok: false, message: 'Buffer is not connected: add BUFFER_API_KEY to the server.' }));
    if (bufferIds.length && buffer.key) (await toBuffer({ ...post, channels: bufferIds })).forEach(r => results.push({ target: 'buffer:' + r.channelId, via: 'buffer', provider: r.service === 'twitter' ? 'x' : r.service, ...r }));
    const now = new Date().toISOString();
    const due = !post.scheduledAt || Date.parse(post.scheduledAt) <= Date.now();
    const jobs = [];
    post.targets.filter(t => !t.startsWith('buffer:')).forEach(id => {
      const acc = accounts && accounts.get(id);
      if (!acc || !acc.enabled || !(acc.can && acc.can.publish)) {
        results.push({ target: id, ok: false, message: !acc ? 'That account is no longer connected.' : !acc.enabled ? 'That account is switched off in Accounts.' : "This account can't publish posts." });
        return;
      }
      // Jobs for now start as "sending" so the scheduler can't pick them up a second time.
      const job = { id: `job_${crypto.randomUUID()}`, target: 'account', accountId: id, post, status: due ? 'sending' : 'scheduled', runAt: post.scheduledAt || now, attempts: 0, createdAt: now, history: [] };
      queue.get().jobs.push(job);
      jobs.push({ job, acc });
    });
    if (jobs.length) await queue.save();
    if (due && jobs.length) await Promise.race([Promise.all(jobs.map(({ job }) => attempt(job).catch(() => {}))), new Promise(r => setTimeout(r, 25000))]);
    jobs.forEach(({ job, acc }) => results.push({ target: acc.id, name: acc.label || acc.name, provider: acc.provider, ok: job.status !== 'failed', ...summary(job) }));
    return { target: 'accounts', results };
  }

  async function publish(post, target) {
    if (target === 'accounts') return toAccounts(post);
    if (target === 'buffer') {
      if (!buffer.key) throw fail('buffer_off', 'Buffer is not connected: add BUFFER_API_KEY to the server.');
      return { target, results: await toBuffer(post) };
    }
    if (!hook.url) throw fail('webhook_off', 'No webhook is set: add SOCIAL_WEBHOOK_URL to the server.');
    return { target, job: enqueue(post) };
  }

  // Sends a sample post straight away, so a new Make/Zapier scenario can be built and checked.
  async function testHook() {
    if (!hook.url) throw fail('webhook_off', 'No webhook is set: add SOCIAL_WEBHOOK_URL to the server.');
    const sample = { id: `test_${crypto.randomUUID()}`, runAt: new Date().toISOString(), post: { id: 'test', brand: 'dj', title: 'Test post from Soulvee OS', text: 'Test post from Soulvee OS — safe to ignore.', platforms: ['instagram'], media: [], scheduledAt: null, test: true } };
    return deliver(sample, 'test');
  }

  // Recent sent posts with their results, newest first, across every Buffer organization.
  async function sentPosts(days) {
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const data = await gql(ORGANIZATIONS);
    const orgs = (data.account && data.account.organizations) || [];
    const posts = [];
    for (const org of orgs) {
      let after = null;
      for (let page = 0; page < 4; page++) {
        const out = await gql(postsQuery(org.id, since, after));
        const conn = out.posts || {};
        (conn.edges || []).forEach(e => { if (e && e.node) posts.push(e.node); });
        if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
        after = conn.pageInfo.endCursor;
      }
    }
    return posts;
  }

  // What has worked: per-post engagement from Buffer, plus a short summary the AI learns from.
  // Cached for 30 minutes; Buffer itself refreshes metrics once a day.
  async function insights(opts = {}) {
    if (!buffer.key) throw fail('buffer_off', 'Buffer is not connected: add BUFFER_API_KEY to the server.');
    const days = Math.max(7, Math.min(180, Number(opts.days) || 60));
    const tz = opts.tz || 'Africa/Lagos';
    const key = `${days}|${tz}`;
    if (!opts.refresh && state.insights && state.insights.key === key && Date.now() - state.insights.at < 30 * 60e3) return state.insights.value;
    const [posts, all] = await Promise.all([sentPosts(days), channels(false).catch(() => [])]);
    const value = summarise(posts, all, days, tz);
    state.insights = { key, at: Date.now(), value };
    return value;
  }

  // A signed one-off event to the webhook, e.g. "autopilot.ready".
  async function notify(event, data) {
    if (!hook.url) return { ok: false, message: 'No webhook set.' };
    return deliver({ id: `${event}_${crypto.randomUUID()}`, runAt: new Date().toISOString(), post: data }, event);
  }

  return { status, channels, publish, jobs, cancel, testHook, start, insights, notify };
}

const COUNT_KEYS = ['reactions', 'likes', 'comments', 'shares', 'reposts', 'saves', 'quotes', 'clicks', 'reach', 'impressions', 'views', 'follows'];

// Engagement rate in %: Buffer's own figure when the network reports one, otherwise
// interactions (comments, shares and saves weigh more than reactions) over reach, impressions or views.
function engagement(m) {
  const actions = (m.reactions || m.likes || 0) + 2 * (m.comments || 0) + 3 * ((m.shares || 0) + (m.reposts || 0) + (m.saves || 0)) + 2 * (m.quotes || 0);
  const seen = m.reach || m.impressions || m.views || 0;
  const rate = typeof m.engagementRate === 'number' ? m.engagementRate : seen > 0 ? (actions / seen) * 100 : null;
  return { rate: rate === null ? null : Math.round(rate * 10) / 10, actions, seen };
}

function summarise(raw, allChannels, days, tz) {
  const named = id => { const c = allChannels.find(x => x.id === id); return c ? c.displayName || c.name : ''; };
  const posts = raw.filter(p => Array.isArray(p.metrics) && p.metrics.length).map(p => {
    const m = {};
    p.metrics.forEach(x => { if (x && x.type) m[x.type] = Number(x.value) || 0; });
    const counts = {};
    COUNT_KEYS.forEach(k => { if (m[k]) counts[k] = m[k]; });
    const e = engagement(m);
    return { id: p.id, channelId: p.channelId, channel: named(p.channelId), service: p.channelService, sentAt: p.sentAt || p.dueAt, text: String(p.text || '').slice(0, 280), metrics: counts, rate: e.rate, actions: e.actions, seen: e.seen };
  });
  // Ranked by engagement rate where there is one, then by interactions.
  const ranked = [...posts].sort((a, b) => (b.rate === null ? -1 : b.rate) - (a.rate === null ? -1 : a.rate) || b.actions - a.actions);
  const withRate = ranked.filter(p => p.rate !== null);
  const avg = list => Math.round((list.reduce((t, p) => t + p.rate, 0) / list.length) * 10) / 10;
  const byService = {};
  withRate.forEach(p => { (byService[p.service] = byService[p.service] || []).push(p); });
  const platforms = Object.entries(byService).map(([service, list]) => ({ service, label: label(service), posts: list.length, rate: avg(list) })).sort((a, b) => b.rate - a.rate);
  const when = iso => { const p = shared.zoneParts(new Date(iso), tz); return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.weekday], hour: p.hour, text: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.weekday]} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` }; };
  const hours = {};
  withRate.forEach(p => { if (p.sentAt) { const h = when(p.sentAt).hour; (hours[h] = hours[h] || []).push(p); } });
  const bestHour = Object.entries(hours).filter(([, list]) => list.length >= 2).map(([h, list]) => ({ hour: +h, rate: avg(list), posts: list.length })).sort((a, b) => b.rate - a.rate)[0] || null;
  const line = p => `- ${label(p.service || '')}${p.sentAt ? ' · ' + when(p.sentAt).text : ''} · ${p.rate !== null ? p.rate + '% engagement' : p.actions + ' interactions'}${p.seen ? ' · ' + p.seen.toLocaleString('en-NG') + ' reached' : ''}: "${p.text.replace(/\s+/g, ' ').slice(0, 140)}"`;
  const top = ranked.slice(0, 5);
  const bottom = ranked.length >= 8 ? ranked.slice(-3).reverse() : [];
  const learnings = posts.length ? [
    `Results from the last ${days} days on Buffer (${posts.length} posts with data):`,
    'Best:', ...top.map(line),
    ...(bottom.length ? ['Weakest:', ...bottom.map(line)] : []),
    platforms.length ? `Average engagement by platform: ${platforms.map(p => `${p.label} ${p.rate}% (${p.posts} post${p.posts === 1 ? '' : 's'})`).join(', ')}.` : '',
    bestHour ? `Best posting hour so far: around ${String(bestHour.hour).padStart(2, '0')}:00 (${bestHour.rate}% across ${bestHour.posts} posts).` : '',
  ].filter(Boolean).join('\n') : '';
  return { days, tz, updatedAt: new Date().toISOString(), count: posts.length, sent: raw.length, posts: ranked, platforms, bestHour, learnings };
}

function bufferInput(post, channel) {
  const media = post.media || [];
  const video = media.some(m => m.type === 'video');
  const input = {
    text: post.text,
    channelId: channel.id,
    schedulingType: 'automatic',
    mode: post.scheduledAt ? 'customScheduled' : 'shareNow',
    assets: media.map(m => (m.type === 'video' ? { video: { url: m.url } } : { image: { url: m.url } })),
    aiAssisted: !!post.aiAssisted,
  };
  if (post.scheduledAt) input.dueAt = new Date(post.scheduledAt).toISOString();
  const meta = metadata(post, channel.service, video);
  if (meta) input.metadata = meta;
  return input;
}

function metadata(post, service, video) {
  const title = (post.title || String(post.text || '').split('\n')[0]).trim().slice(0, 100);
  const comment = post.firstComment ? { firstComment: post.firstComment } : {};
  if (service === 'instagram') return { instagram: { type: post.igType || (video ? 'reel' : 'post'), shouldShareToFeed: true, ...comment } };
  if (service === 'youtube') return { youtube: { title: title || 'New video', categoryId: post.ytCategory || '22' } };
  if (service === 'tiktok' && !video) return { tiktok: { title: title.slice(0, 90) } };
  if (service === 'linkedin' && post.firstComment) return { linkedin: comment };
  if (service === 'pinterest') return { pinterest: { title, ...(post.pinBoard ? { boardServiceId: post.pinBoard } : {}), ...(post.link ? { url: post.link } : {}) } };
  return null;
}

function mediaProblem(post, service) {
  const media = post.media || [];
  if (NEEDS_MEDIA[service] && !media.length) return `${label(service)} needs ${NEEDS_MEDIA[service]}. Add a public media URL to the post.`;
  if (service === 'youtube' && !media.some(m => m.type === 'video')) return 'YouTube needs a video.';
  if (service === 'twitter' && String(post.text).length > 280) return `Too long for X: ${String(post.text).length}/280 characters.`;
  return '';
}

function channelProblem(channel) {
  if (channel.isDisconnected) return 'This channel is disconnected in Buffer. Reconnect it in Buffer first.';
  if (channel.isLocked) return 'This channel is locked in Buffer (over your plan limit).';
  return '';
}

function label(service) {
  return { twitter: 'X', youtube: 'YouTube', tiktok: 'TikTok', linkedin: 'LinkedIn', googlebusiness: 'Google Business' }[service] || service.charAt(0).toUpperCase() + service.slice(1);
}

function summary(job) {
  return { id: job.id, status: job.status, runAt: job.runAt, attempts: job.attempts, sentAt: job.sentAt || null, error: job.error || '', ...(job.target === 'account' ? { accountId: job.accountId, url: job.url || '', postId: job.postId || '' } : {}), jobId: job.id };
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Checks and normalises a post sent by the browser. Throws a coded error when it can't be published.
function clean(raw, target) {
  if (!raw || typeof raw !== 'object') throw fail('bad_post', 'Bad post');
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) throw fail('bad_post', 'The post has no text.');
  if (text.length > 10000) throw fail('bad_post', 'The post text is too long.');
  const media = Array.isArray(raw.media) ? raw.media.slice(0, 10) : [];
  if (media.some(m => !m || !['image', 'video'].includes(m.type) || !/^https?:\/\/\S+$/i.test(String(m.url || '')))) throw fail('bad_post', 'Each media item needs a public http(s) URL.');
  const when = raw.scheduledAt ? Date.parse(raw.scheduledAt) : NaN;
  if (raw.scheduledAt && Number.isNaN(when)) throw fail('bad_post', 'The scheduled time is not a valid date.');
  if (raw.scheduledAt && when < Date.now() - 60e3) throw fail('past', 'That time has already passed. Pick a time in the future, or publish now.');
  const channels = Array.isArray(raw.channels) ? raw.channels.filter(c => typeof c === 'string' && c) : [];
  if (target === 'buffer' && !channels.length) throw fail('bad_post', 'Choose at least one Buffer channel.');
  const targets = Array.isArray(raw.targets) ? [...new Set(raw.targets.filter(t => typeof t === 'string' && /^[\w:.-]{1,80}$/.test(t)))].slice(0, 40) : [];
  if (target === 'accounts' && !targets.length) throw fail('bad_post', 'Choose at least one account to post to.');
  const platforms = Array.isArray(raw.platforms) ? raw.platforms.filter(p => typeof p === 'string').slice(0, 12) : [];
  const igType = ['post', 'reel', 'story'].includes(raw.igType) ? raw.igType : '';
  return {
    id: String(raw.id || '').slice(0, 64),
    brand: String(raw.brand || '').slice(0, 32),
    title: String(raw.title || '').slice(0, 200),
    text,
    media: media.map(m => ({ type: m.type, url: String(m.url) })),
    platforms,
    channels,
    targets,
    scheduledAt: raw.scheduledAt ? new Date(when).toISOString() : null,
    subreddit: /^[A-Za-z0-9_]{2,24}$/.test(String(raw.subreddit || '').replace(/^\/?r\//i, '')) ? String(raw.subreddit).replace(/^\/?r\//i, '') : '',
    redditTitle: String(raw.redditTitle || '').trim().slice(0, 300),
    igType,
    firstComment: String(raw.firstComment || '').slice(0, 2200),
    ytCategory: /^\d{1,3}$/.test(String(raw.ytCategory || '')) ? String(raw.ytCategory) : '',
    pinBoard: String(raw.pinBoard || '').slice(0, 64),
    link: /^https?:\/\//i.test(String(raw.link || '')) ? String(raw.link) : '',
    aiAssisted: !!raw.aiAssisted,
  };
}

module.exports = { create, clean, SERVICES };
