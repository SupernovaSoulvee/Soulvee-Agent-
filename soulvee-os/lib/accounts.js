// Connected accounts: Facebook Pages, Instagram and Threads profiles, X and LinkedIn profiles, Telegram
// bots and channels, WhatsApp numbers, Reddit accounts, Gmail mailboxes and Signal numbers. Several of
// each can be connected. Access tokens stay in this file on the server (readable only by its owner)
// and are never sent to the browser.
const crypto = require('node:crypto');
const path = require('node:path');
const store = require('./store');
const shared = require('../public/shared.js');

const PUBLIC = ['id', 'provider', 'kind', 'externalId', 'name', 'handle', 'avatar', 'brands', 'label', 'enabled', 'can', 'meta', 'options', 'status', 'error', 'connectedAt', 'updatedAt', 'expiresAt', 'checkedAt'];
const BRAND_IDS = new Set(shared.BRANDS.map(b => b.id));

function create(dir) {
  const db = store.open(path.join(dir, 'accounts.json'), () => ({ accounts: [], webhookToken: '' }), { mode: 0o600 });
  const all = () => db.get().accounts;

  const view = a => Object.fromEntries(PUBLIC.filter(k => a[k] !== undefined).map(k => [k, a[k]]));
  const get = id => all().find(a => a.id === id) || null;
  const list = test => all().filter(a => !test || test(a));

  // Adds what a connection found. Reconnecting the same page, channel or number keeps its id, label,
  // brands, on/off switch and options, and refreshes its tokens.
  function upsert(found) {
    const now = new Date().toISOString();
    const out = found.map(f => {
      const old = all().find(a => a.provider === f.provider && String(a.externalId) === String(f.externalId));
      if (old) {
        Object.assign(old, { ...f, id: old.id, label: old.label, brands: old.brands, enabled: old.enabled, options: { ...(f.options || {}), ...(old.options || {}) }, status: 'ok', error: '', updatedAt: now });
        return old;
      }
      const fresh = { id: 'acc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 14), label: '', brands: [], enabled: true, options: {}, meta: {}, status: 'ok', error: '', connectedAt: now, updatedAt: now, ...f };
      all().push(fresh);
      return fresh;
    });
    db.save();
    return out;
  }

  // Only what the owner can change: label, brands, on/off, and a few per-account options.
  function update(id, patch) {
    const a = get(id);
    if (!a) return null;
    const p = patch || {};
    if (typeof p.label === 'string') a.label = p.label.trim().slice(0, 60);
    if (Array.isArray(p.brands)) a.brands = [...new Set(p.brands.filter(b => BRAND_IDS.has(b)))];
    if (typeof p.enabled === 'boolean') a.enabled = p.enabled;
    const o = p.options || {};
    if (typeof o.subreddit === 'string') a.options.subreddit = o.subreddit.trim().replace(/^\/?r\//i, '').slice(0, 24);
    if (typeof o.query === 'string') a.options.query = o.query.trim().slice(0, 200);
    a.updatedAt = new Date().toISOString();
    db.save();
    return a;
  }

  function remove(id) {
    const before = all().length;
    db.get().accounts = all().filter(a => a.id !== id);
    db.save();
    return all().length < before;
  }

  function mark(id, error) {
    const a = get(id);
    if (!a) return;
    a.status = error ? 'error' : 'ok';
    a.error = error || '';
    a.checkedAt = new Date().toISOString();
    db.save();
  }

  // New tokens after a refresh. Accounts sharing the same sign-in (e.g. one bot, several channels) all get them.
  function refreshed(a, secret, expiresAt) {
    const old = JSON.stringify(a.secret || {});
    list(x => x.provider === a.provider && JSON.stringify(x.secret || {}) === old).forEach(x => {
      x.secret = { ...(x.secret || {}), ...secret };
      if (expiresAt !== undefined) x.expiresAt = expiresAt;
    });
    db.save();
  }

  // The token Meta must echo back when the webhook address is registered.
  function webhookToken() {
    if (!db.get().webhookToken) {
      db.get().webhookToken = crypto.randomBytes(18).toString('hex');
      db.save();
    }
    return db.get().webhookToken;
  }

  return { list, get, view, upsert, update, remove, mark, refreshed, webhookToken };
}

module.exports = { create };
