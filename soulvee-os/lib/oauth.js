// Sign-in links for platforms that use OAuth. Each link carries a one-time state (checked on the way
// back, so nobody else can finish a sign-in started here) and a PKCE code for platforms that use it.
const crypto = require('node:crypto');

function create(ttl = 15 * 60e3) {
  const pending = new Map();
  function begin(provider) {
    for (const [key, p] of pending) if (Date.now() - p.at > ttl) pending.delete(key);
    const state = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    pending.set(state, { provider, verifier, at: Date.now() });
    return { state, verifier, challenge };
  }
  function finish(provider, state) {
    const p = pending.get(String(state || ''));
    pending.delete(String(state || ''));
    if (!p || p.provider !== provider || Date.now() - p.at > ttl) return null;
    return p;
  }
  return { begin, finish };
}

module.exports = { create };
