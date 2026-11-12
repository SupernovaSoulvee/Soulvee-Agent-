// The unified inbox: conversations from WhatsApp, Messenger, Instagram, Telegram, Gmail, Reddit and
// Signal, kept on the server so messages are collected while the app is closed. Accounts are checked
// every minute (WhatsApp, and Meta when its webhook is set up, arrive straight away), and replies go
// out through the account the conversation came in on.
const crypto = require('node:crypto');
const path = require('node:path');
const store = require('./store');
const providers = require('./providers');
const { fail } = require('./net');

const KEEP = 200; // messages kept per conversation
const MAX_CONVOS = 3000;
const KEEP_DAYS = 180;

function create({ env, dir, accounts }) {
  const ctx = providers.context(env);
  const tick = Number(env.SOULVEE_INBOX_MS) || 60000;
  const db = store.open(path.join(dir, 'inbox.json'), () => ({ conversations: {}, cursors: {} }), { mode: 0o600 });
  const state = { busy: false, timer: null, last: {} };
  const convos = () => db.get().conversations;

  function summary(c) {
    const acc = accounts.get(c.accountId);
    const last = c.messages[c.messages.length - 1] || {};
    const lastIn = [...c.messages].reverse().find(m => m.dir === 'in');
    return { key: c.key, provider: c.provider, accountId: c.accountId, account: acc ? acc.label || acc.name : 'Removed account', brands: acc ? acc.brands : [], peer: c.peer, subject: c.subject || '', lastText: last.text || '', lastDir: last.dir || '', lastAt: c.updatedAt, unread: c.unread || 0, lastInboundAt: lastIn ? lastIn.at : '', count: c.messages.length };
  }

  const list = () => Object.values(convos()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(summary);

  function get(key) {
    const c = convos()[key];
    return c ? { ...summary(c), thread: c.thread, messages: c.messages } : null;
  }

  // Oldest conversations go first once there are too many, or when nothing has happened for six months.
  function prune() {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
    const all = Object.values(convos()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    all.forEach((c, i) => { if (i >= MAX_CONVOS || String(c.updatedAt) < cutoff) delete convos()[c.key]; });
  }

  // Adds new messages and delivery updates from one account. On an account's first check, what is
  // already there is brought in as read, so the inbox doesn't fill with old "unread" messages.
  function ingest(acc, items, quiet) {
    const changed = items.filter(it => {
      const key = `${acc.id}:${it.thread}`;
      const c = convos()[key] || (convos()[key] = { key, provider: acc.provider, accountId: acc.id, thread: it.thread, peer: {}, subject: '', messages: [], unread: 0, updatedAt: '' });
      if (it.statusFor) {
        const m = c.messages.find(x => x.id === it.statusFor);
        if (m) Object.assign(m, { status: it.status }, it.error ? { error: it.error } : {});
        return !!m;
      }
      if (c.messages.some(m => m.id === it.id)) return false;
      c.peer = { ...c.peer, ...Object.fromEntries(Object.entries(it.peer || {}).filter(([, v]) => v)) };
      if (it.subject && !c.subject) c.subject = it.subject;
      c.messages.push({ id: it.id, dir: it.dir, text: String(it.text || '').slice(0, 8000), at: it.at, ...(it.author ? { author: it.author } : {}), ...(it.ref ? { ref: it.ref } : {}) });
      c.messages.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      if (c.messages.length > KEEP) c.messages = c.messages.slice(-KEEP);
      if (it.dir === 'in' && !quiet) c.unread = (c.unread || 0) + 1;
      if (String(it.at) > String(c.updatedAt)) c.updatedAt = it.at;
      return true;
    });
    if (changed.length) {
      prune();
      db.save();
    }
    return changed.length;
  }

  const health = (acc, err) => {
    const msg = err ? err.message : '';
    if ((acc.error || '') !== msg) accounts.mark(acc.id, msg);
  };

  async function poll(acc) {
    const mod = providers.BY_PLATFORM[acc.provider];
    if (!mod || !mod.poll || !acc.enabled || !(acc.can && acc.can.inbox)) return 0;
    const first = !db.get().cursors[acc.id];
    state.last[acc.id] = Date.now();
    const live = await providers.fresh(ctx, accounts, acc);
    const out = await mod.poll(ctx, live, db.get().cursors[acc.id]);
    db.get().cursors[acc.id] = out.cursor || {};
    const added = ingest(live, out.items || [], first);
    if (!added) db.save();
    return added;
  }

  // Checks every account that is due (each platform sets how often); `force` checks them all now.
  async function pollAll(force) {
    if (state.busy) return 0;
    state.busy = true;
    const every = acc => { const slow = (providers.BY_PLATFORM[acc.provider] || {}).pollEvery || 0; return slow ? Number(env.SOULVEE_SLOW_POLL_MS) || slow : 0; };
    const due = acc => force || Date.now() - (state.last[acc.id] || 0) >= every(acc);
    const counts = [];
    for (const acc of accounts.list(a => a.enabled && a.can && a.can.inbox).filter(due)) counts.push(await poll(acc).then(n => { health(acc, null); return n; }, err => { health(acc, err); return 0; }));
    state.busy = false;
    return counts.reduce((a, b) => a + b, 0);
  }

  async function reply(key, msg) {
    const c = convos()[key];
    if (!c) throw fail('not_found', 'That conversation was not found.');
    const acc = accounts.get(c.accountId);
    if (!acc) throw fail('not_found', 'The account this conversation came in on has been removed.');
    const mod = providers.BY_PLATFORM[acc.provider];
    if (!mod || !mod.send) throw fail('rejected', 'Replies from Soulvee OS are not possible for this account.');
    const text = String((msg && msg.text) || '').trim().slice(0, 8000);
    const template = msg && msg.template && msg.template.name ? { name: String(msg.template.name).trim().slice(0, 100), language: String(msg.template.language || 'en').trim().slice(0, 10) } : null;
    if (!text && !template) throw fail('bad_input', 'Write a reply first.');
    const live = await providers.fresh(ctx, accounts, acc);
    const out = await mod.send(ctx, live, c, { text, template }).catch(err => { if (err.code === 'auth') health(acc, err); throw err; });
    const at = new Date().toISOString();
    c.messages.push({ id: out.id || 'out_' + crypto.randomUUID(), dir: 'out', text: template ? `Template: ${template.name}` : text, at, status: 'sent' });
    c.updatedAt = at;
    c.unread = 0;
    db.save();
    return get(key);
  }

  function read(key) {
    const c = convos()[key];
    if (!c) throw fail('not_found', 'That conversation was not found.');
    c.unread = 0;
    db.save();
    return summary(c);
  }

  // A verified Meta webhook delivery: WhatsApp messages are added straight away; Messenger and
  // Instagram events trigger a check of that Page.
  async function webhook(body) {
    const live = accounts.list(a => a.enabled);
    providers.MODULES.whatsapp.webhook(body, live).forEach(f => ingest(f.account, f.items, false));
    for (const acc of providers.MODULES.meta.webhookTargets(body, live)) await poll(acc).then(() => health(acc, null), err => health(acc, err));
  }

  // Forgets a removed account's conversations and checkpoint.
  function forget(accountId) {
    Object.values(convos()).filter(c => c.accountId === accountId).forEach(c => delete convos()[c.key]);
    delete db.get().cursors[accountId];
    db.save();
  }

  function start() {
    state.timer = setInterval(() => pollAll().catch(err => console.error('Inbox check failed: ' + err.message)), tick);
    state.timer.unref();
    setTimeout(() => pollAll().catch(() => {}), 2000).unref();
  }

  const unread = () => Object.values(convos()).reduce((a, c) => a + (c.unread || 0), 0);

  return { list, get, reply, read, pollAll, webhook, forget, start, unread };
}

module.exports = { create };
