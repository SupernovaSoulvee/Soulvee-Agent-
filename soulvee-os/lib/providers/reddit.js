// Reddit through its Data API with a "script" app: the account's own client ID and secret plus its
// username and password. Since late 2025 Reddit reviews API access before an app may use it, so
// this works once Reddit has approved your app. Posts go to your profile or a subreddit you choose;
// private messages land in the inbox.
const { call, fail } = require('../net');

const agent = acc => `SoulveeOS/1.2 (by /u/${(acc.meta && acc.meta.username) || 'soulvee'})`;

async function rd(ctx, acc, path, opts = {}) {
  const res = await call(`${ctx.urls.reddit}/${path}`, { ...opts, agent: agent(acc), headers: { authorization: `bearer ${acc.secret.access}`, ...(opts.headers || {}) }, label: 'Reddit' });
  if (res.ok) return res.data || {};
  const why = (res.data && (res.data.message || res.data.error)) || `HTTP ${res.status}`;
  if (res.status === 401) throw fail('auth', `Reddit no longer accepts this sign-in (${why}). Check the account in Accounts.`);
  if (res.status === 429) throw fail('rate', `Reddit's limit was reached: ${why}`, true);
  if (res.status >= 500) throw fail('server', `Reddit had a problem: ${why}`, true);
  throw fail(res.status === 403 ? 'permission' : 'rejected', `Reddit: ${why}`);
}

async function token(ctx, f, username) {
  const res = await call(`${ctx.urls.redditAuth}/api/v1/access_token`, {
    form: { grant_type: 'password', username, password: f.password },
    headers: { authorization: 'Basic ' + Buffer.from(`${f.clientId}:${f.clientSecret}`).toString('base64') },
    agent: `SoulveeOS/1.2 (by /u/${username})`,
    label: 'Reddit',
  });
  const out = res.data || {};
  if (res.ok && out.access_token) return { access: out.access_token, expiresAt: new Date(Date.now() + (Number(out.expires_in) || 3600) * 1000 - 60e3).toISOString() };
  if (res.status === 401 || out.error === 'invalid_grant') throw fail('auth', 'Reddit rejected those details. Check the client ID and secret of your script app, and the username and password (accounts with two-factor sign-in need it turned off for script apps).');
  if (res.status === 403) throw fail('permission', 'Reddit refused API access for this app. Reddit now reviews apps before they can use its API; request access, then try again.');
  throw fail('rejected', `Reddit: ${out.error || out.message || 'HTTP ' + res.status}`);
}

// Keeps a fresh access token (they last an hour) using the stored script-app details.
async function live(ctx, acc) {
  if (acc.secret.access && Date.parse(acc.secret.accessExpiresAt || 0) > Date.now()) return null;
  const t = await token(ctx, acc.secret, acc.meta.username);
  return { secret: { access: t.access, accessExpiresAt: t.expiresAt } };
}

module.exports = {
  id: 'reddit',
  name: 'Reddit',

  // fields: { clientId, clientSecret, username, password, subreddit }
  async connect(ctx, f) {
    const fields = { clientId: String(f.clientId || '').trim(), clientSecret: String(f.clientSecret || '').trim(), password: String(f.password || '') };
    const username = String(f.username || '').trim().replace(/^\/?u\//i, '');
    if (!fields.clientId || !fields.clientSecret || !username || !fields.password) throw fail('bad_input', 'Fill in the client ID and secret of your Reddit script app, and the account username and password.');
    const t = await token(ctx, fields, username);
    const acc = { meta: { username }, secret: { access: t.access } };
    const me = await rd(ctx, acc, 'api/v1/me');
    const sub = String(f.subreddit || '').trim().replace(/^\/?r\//i, '');
    return [{ provider: 'reddit', kind: 'profile', externalId: me.name || username, name: 'u/' + (me.name || username), handle: 'u/' + (me.name || username), avatar: String(me.icon_img || '').split('?')[0], can: { publish: true, inbox: true }, meta: { username: me.name || username }, options: sub ? { subreddit: sub } : {}, secret: { ...fields, access: t.access, accessExpiresAt: t.expiresAt } }];
  },

  refresh: live,

  async check(ctx, acc) {
    await rd(ctx, acc, 'api/v1/me');
  },

  limits: { text: 40000, title: 300 },

  // Posts to the subreddit chosen for this post, else the account's default, else the account's own profile.
  async publish(ctx, acc, post) {
    const sr = String(post.subreddit || acc.options.subreddit || `u_${acc.meta.username}`).replace(/^\/?r\//i, '');
    const title = String(post.redditTitle || post.title || post.text.split('\n')[0]).trim().slice(0, 300);
    if (!title) throw fail('bad_post', 'Reddit posts need a title.');
    const image = (post.media || []).find(m => m.type === 'image');
    const link = post.link || (image && image.url) || '';
    const out = await rd(ctx, acc, 'api/submit', { form: { sr, title, kind: link ? 'link' : 'self', ...(link ? { url: link } : { text: post.text }), api_type: 'json', resubmit: true, sendreplies: true } });
    const errors = (out.json && out.json.errors) || [];
    if (errors.length) throw fail('rejected', `Reddit: ${errors.map(e => e[1] || e[0]).join('; ')}`);
    const data = (out.json && out.json.data) || {};
    return { id: data.name || data.id || '', url: data.url || '' };
  },

  // New private messages, each sender kept as one conversation.
  async poll(ctx, acc, cursor) {
    const seen = new Set((cursor && cursor.seen) || []);
    const out = await rd(ctx, acc, 'message/unread', { query: { limit: 50 } });
    const fresh = ((out.data && out.data.children) || []).map(c => c.data || {}).filter(m => !m.was_comment && !seen.has(m.name));
    const items = fresh.map(m => ({ thread: String(m.author || m.dest || 'reddit').toLowerCase(), peer: { id: m.author || '', name: 'u/' + (m.author || 'reddit'), handle: 'u/' + (m.author || '') }, id: m.name, dir: 'in', text: m.body || '', subject: m.subject || '', at: new Date((m.created_utc || Date.now() / 1000) * 1000).toISOString(), ref: m.name }));
    return { items, cursor: { seen: [...seen, ...fresh.map(m => m.name)].slice(-500) } };
  },

  async send(ctx, acc, convo, msg) {
    const last = [...convo.messages].reverse().find(m => m.dir === 'in' && m.ref);
    if (!last) throw fail('rejected', 'There is no Reddit message to reply to in this conversation.');
    const out = await rd(ctx, acc, 'api/comment', { form: { thing_id: last.ref, text: msg.text, api_type: 'json' } });
    const errors = (out.json && out.json.errors) || [];
    if (errors.length) throw fail('rejected', `Reddit: ${errors.map(e => e[1] || e[0]).join('; ')}`);
    return { id: (((out.json && out.json.data && out.json.data.things) || [])[0] || { data: {} }).data.name || '' };
  },
};
