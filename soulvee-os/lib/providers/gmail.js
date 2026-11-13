// Gmail through the Gmail API with Google sign-in. Several mailboxes can be connected. New mail that
// matches each mailbox's search (Primary inbox, last 7 days by default) lands in the inbox, and replies
// go out from that mailbox in the same email thread.
const { call, fail } = require('../net');

const SCOPES = 'openid email https://www.googleapis.com/auth/gmail.modify';
const QUERY = 'in:inbox category:primary newer_than:7d';

async function gm(ctx, path, acc, opts = {}) {
  const res = await call(`${ctx.urls.google}/gmail/v1/users/me/${path}`, { ...opts, headers: { authorization: `Bearer ${acc.secret.token}`, ...(opts.headers || {}) }, label: 'Gmail' });
  if (res.ok) return res.data || {};
  const e = (res.data && res.data.error) || {};
  const why = e.message || `HTTP ${res.status}`;
  if (res.status === 401) throw fail('auth', `Gmail no longer accepts this sign-in (${why}). Reconnect it in Accounts.`);
  if (res.status === 429 || (res.status === 403 && /rate|quota/i.test(why))) throw fail('rate', `Gmail's limit was reached: ${why}`, true);
  if (res.status >= 500) throw fail('server', `Gmail had a problem: ${why}`, true);
  throw fail(res.status === 403 ? 'permission' : 'rejected', `Gmail: ${why}`);
}

async function tokenCall(ctx, form) {
  const res = await call(ctx.urls.googleToken, { form: { client_id: ctx.env.GOOGLE_CLIENT_ID, client_secret: ctx.env.GOOGLE_CLIENT_SECRET, ...form }, label: 'Google' });
  const out = res.data || {};
  if (res.ok && out.access_token) return out;
  if (out.error === 'invalid_grant') throw fail('auth', 'Google no longer accepts this sign-in (it expires after 7 days while the Google app is in "Testing"). Reconnect it in Accounts.');
  throw fail(res.status >= 500 ? 'server' : 'rejected', `Google: ${out.error_description || out.error || 'HTTP ' + res.status}`, res.status >= 500);
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = s => Buffer.from(String(s || ''), 'base64').toString('utf8');
const header = (msg, name) => (((msg.payload && msg.payload.headers) || []).find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';
// "Ada Obi <ada@obi.test>" → { name, email }
const address = v => { const m = String(v).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); return m ? { name: m[1].trim(), email: m[2].trim().toLowerCase() } : { name: '', email: String(v).trim().toLowerCase() }; };

// The plain-text body, else the HTML body without tags; quoted earlier messages are cut off.
function bodyText(payload) {
  const parts = [];
  const walk = p => { if (!p) return; if (p.parts) p.parts.forEach(walk); else parts.push(p); };
  walk(payload);
  const plain = parts.find(p => p.mimeType === 'text/plain' && p.body && p.body.data);
  const html = parts.find(p => p.mimeType === 'text/html' && p.body && p.body.data);
  const text = plain ? unb64(plain.body.data) : html ? unb64(html.body.data).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
  return text.split(/\r?\n(?:On .{5,200} wrote:|-{2,} ?Original Message ?-{2,}|>.*)/)[0].trim().slice(0, 4000);
}

module.exports = {
  id: 'gmail',
  name: 'Gmail',

  oauth: {
    ready: env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    authorize(ctx, { state, redirect }) {
      const q = new URLSearchParams({ client_id: ctx.env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
      return `${ctx.urls.googleAuth}?${q}`;
    },
    async exchange(ctx, { code, redirect }) {
      const tok = await tokenCall(ctx, { code, redirect_uri: redirect, grant_type: 'authorization_code' });
      if (!tok.refresh_token) throw fail('rejected', 'Google did not return a refresh token. Remove Soulvee OS from your Google account permissions, then connect again.');
      const acc = { secret: { token: tok.access_token } };
      const me = await gm(ctx, 'profile', acc);
      return [{ provider: 'gmail', kind: 'mailbox', externalId: me.emailAddress, name: me.emailAddress, handle: me.emailAddress, can: { publish: false, inbox: true }, meta: { email: me.emailAddress }, options: { query: QUERY }, secret: { token: tok.access_token, refresh: tok.refresh_token }, expiresAt: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString() }];
    },
  },

  async refresh(ctx, acc) {
    if (Date.parse(acc.expiresAt || 0) - Date.now() > 2 * 60e3) return null;
    const tok = await tokenCall(ctx, { grant_type: 'refresh_token', refresh_token: acc.secret.refresh });
    return { secret: { token: tok.access_token }, expiresAt: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString() };
  },

  async check(ctx, acc) {
    await gm(ctx, 'profile', acc);
  },

  async poll(ctx, acc, cursor) {
    const seen = new Set((cursor && cursor.seen) || []);
    const list = await gm(ctx, 'messages', acc, { query: { q: acc.options.query || QUERY, maxResults: 25 } });
    const fresh = (list.messages || []).filter(m => !seen.has(m.id)).slice(0, 25);
    const me = String(acc.meta.email).toLowerCase();
    const items = [];
    for (const ref of fresh) {
      const msg = await gm(ctx, `messages/${ref.id}`, acc, { query: { format: 'full' } });
      const from = address(header(msg, 'From'));
      const mine = from.email === me;
      const to = address(header(msg, 'To').split(',')[0] || '');
      const peer = mine ? to : from;
      items.push({ thread: msg.threadId, peer: { id: peer.email, name: peer.name || peer.email, email: peer.email }, id: msg.id, dir: mine ? 'out' : 'in', text: bodyText(msg.payload) || msg.snippet || '', subject: header(msg, 'Subject'), at: new Date(Number(msg.internalDate) || Date.now()).toISOString(), ref: header(msg, 'Message-ID') });
    }
    return { items, cursor: { seen: [...seen, ...fresh.map(m => m.id)].slice(-500) } };
  },

  async send(ctx, acc, convo, msg) {
    const last = [...convo.messages].reverse().find(m => m.ref) || {};
    const subject = /^re:/i.test(convo.subject || '') ? convo.subject : `Re: ${convo.subject || '(no subject)'}`;
    const head = [
      `From: ${acc.meta.email}`,
      `To: ${convo.peer.email || convo.peer.id}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
      ...(last.ref ? [`In-Reply-To: ${last.ref}`, `References: ${last.ref}`] : []),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
    ];
    const out = await gm(ctx, 'messages/send', acc, { json: { raw: b64(head.join('\r\n') + '\r\n\r\n' + msg.text), threadId: convo.thread } });
    return { id: out.id || '' };
  },
};
