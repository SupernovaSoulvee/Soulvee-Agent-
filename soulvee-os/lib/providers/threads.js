// Threads through Meta's Threads API. Each Threads profile signs in separately, so several can be
// connected. Long-lived tokens last 60 days and are refreshed automatically before they run out.
const { call, fail } = require('../net');

const SCOPES = 'threads_basic,threads_content_publish';

async function th(ctx, path, opts = {}) {
  const res = await call(`${ctx.urls.threads}/${path}`, { ...opts, label: 'Threads' });
  if (res.ok) return res.data || {};
  const e = (res.data && res.data.error) || {};
  const said = e.error_user_msg || e.message || `HTTP ${res.status}`;
  if (e.code === 190) throw fail('auth', `Threads no longer accepts this sign-in (${said}). Reconnect it in Accounts.`);
  if ([4, 17, 32, 613].includes(e.code) || res.status === 429) throw fail('rate', `Threads' limit was reached: ${said}`, true);
  if (res.status >= 500) throw fail('server', `Threads had a problem: ${said}`, true);
  throw fail('rejected', `Threads: ${said}`);
}

const profile = async (ctx, token, expiresIn) => {
  const me = await th(ctx, 'v1.0/me', { query: { fields: 'id,username,name,threads_profile_picture_url', access_token: token } });
  return [{ provider: 'threads', kind: 'profile', externalId: me.id, name: me.name || me.username, handle: me.username ? '@' + me.username : '', avatar: me.threads_profile_picture_url || '', can: { publish: true, inbox: false }, meta: { userId: me.id, username: me.username || '' }, secret: { token, issuedAt: new Date().toISOString() }, expiresAt: new Date(Date.now() + (Number(expiresIn) || 5184000) * 1000).toISOString() }];
};

// Waits for Threads to process a media container before publishing it.
async function ready(ctx, id, token) {
  for (let i = 0; i < 60; i++) {
    const s = await th(ctx, `v1.0/${id}`, { query: { fields: 'status,error_message', access_token: token } });
    if (!s.status || s.status === 'FINISHED' || s.status === 'PUBLISHED') return;
    if (s.status === 'ERROR' || s.status === 'EXPIRED') throw fail('media', `Threads couldn't use the media: ${s.error_message || s.status}.`);
    await new Promise(r => setTimeout(r, ctx.pollMs));
  }
  throw fail('media', 'Threads is still processing the media. Try again in a few minutes.', true);
}

module.exports = {
  id: 'threads',
  name: 'Threads',

  oauth: {
    ready: env => !!(env.THREADS_APP_ID && env.THREADS_APP_SECRET),
    authorize(ctx, { state, redirect }) {
      const q = new URLSearchParams({ client_id: ctx.env.THREADS_APP_ID, redirect_uri: redirect, scope: SCOPES, response_type: 'code', state });
      return `${ctx.urls.threadsAuth}?${q}`;
    },
    async exchange(ctx, { code, redirect }) {
      const short = await th(ctx, 'oauth/access_token', { form: { client_id: ctx.env.THREADS_APP_ID, client_secret: ctx.env.THREADS_APP_SECRET, grant_type: 'authorization_code', redirect_uri: redirect, code } });
      const long = await th(ctx, 'access_token', { query: { grant_type: 'th_exchange_token', client_secret: ctx.env.THREADS_APP_SECRET, access_token: short.access_token } });
      return profile(ctx, long.access_token, long.expires_in);
    },
  },

  // A long-lived token can be refreshed once it is a day old; Soulvee OS does it in its last week.
  async refresh(ctx, acc) {
    const left = Date.parse(acc.expiresAt || 0) - Date.now();
    const age = Date.now() - Date.parse(acc.secret.issuedAt || acc.connectedAt || 0);
    if (!(left < 7 * 864e5) || age < 864e5) return null;
    const out = await th(ctx, 'refresh_access_token', { query: { grant_type: 'th_refresh_token', access_token: acc.secret.token } });
    return { secret: { token: out.access_token, issuedAt: new Date().toISOString() }, expiresAt: new Date(Date.now() + (Number(out.expires_in) || 5184000) * 1000).toISOString() };
  },

  async check(ctx, acc) {
    await th(ctx, 'v1.0/me', { query: { fields: 'id', access_token: acc.secret.token } });
  },

  limits: { text: 500 },

  async publish(ctx, acc, post) {
    const token = acc.secret.token;
    const user = acc.meta.userId;
    const media = (post.media || []).slice(0, 20);
    if (post.text.length > 500) throw fail('too_long', `Too long for Threads: ${post.text.length}/500 characters.`);
    const item = (m, extra) => th(ctx, `v1.0/${user}/threads`, { form: { ...(m.type === 'video' ? { media_type: 'VIDEO', video_url: m.url } : { media_type: 'IMAGE', image_url: m.url }), ...extra, access_token: token } });
    const container = async () => {
      if (!media.length) return (await th(ctx, `v1.0/${user}/threads`, { form: { media_type: 'TEXT', text: post.text, access_token: token } })).id;
      if (media.length === 1) {
        const c = await item(media[0], { text: post.text });
        await ready(ctx, c.id, token);
        return c.id;
      }
      const kids = [];
      for (const m of media) kids.push((await item(m, { is_carousel_item: true })).id);
      for (const k of kids) await ready(ctx, k, token);
      const c = await th(ctx, `v1.0/${user}/threads`, { form: { media_type: 'CAROUSEL', children: kids.join(','), text: post.text, access_token: token } });
      await ready(ctx, c.id, token);
      return c.id;
    };
    const creation = await container();
    const done = await th(ctx, `v1.0/${user}/threads_publish`, { form: { creation_id: creation, access_token: token } });
    const link = await th(ctx, `v1.0/${done.id}`, { query: { fields: 'permalink', access_token: token } }).catch(() => ({}));
    return { id: done.id, url: link.permalink || '' };
  },
};
