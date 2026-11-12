// X (Twitter) through the X API v2 with OAuth 2.0 (PKCE). Each X account signs in separately.
// Access tokens last two hours and are refreshed automatically with the refresh token.
// Images are uploaded with the v2 media endpoint; videos go through Buffer instead.
const { call, fail, fetchMedia } = require('../net');

const SCOPES = 'tweet.read tweet.write users.read media.write offline.access';

const said = data => (data && (data.detail || data.title || data.error_description || (data.errors && data.errors.map(e => e.message || e.detail).join('; ')) || data.error)) || '';

async function xapi(ctx, path, opts = {}) {
  const res = await call(`${ctx.urls.x}/${path}`, { ...opts, label: 'X' });
  if (res.ok) return res.data || {};
  const why = said(res.data) || `HTTP ${res.status}`;
  if (res.status === 401) throw fail('auth', `X no longer accepts this sign-in (${why}). Reconnect it in Accounts.`);
  if (res.status === 402 || /credits|payment|client-not-enrolled|usage cap/i.test(why)) throw fail('plan', `X refused because of the API plan: ${why}. Check your X developer account's access level and credits.`);
  if (res.status === 429) throw fail('rate', `X's limit was reached: ${why}`, true);
  if (res.status >= 500) throw fail('server', `X had a problem: ${why}`, true);
  if (res.status === 403 && /duplicate/i.test(why)) throw fail('duplicate', 'X refused a duplicate post. Change the text a little and post again.');
  throw fail('rejected', `X: ${why}`);
}

const basic = ctx => (ctx.env.X_CLIENT_SECRET ? { authorization: 'Basic ' + Buffer.from(`${ctx.env.X_CLIENT_ID}:${ctx.env.X_CLIENT_SECRET}`).toString('base64') } : {});
const expiry = s => new Date(Date.now() + (Number(s) || 7200) * 1000).toISOString();

module.exports = {
  id: 'x',
  name: 'X',

  oauth: {
    ready: env => !!env.X_CLIENT_ID,
    authorize(ctx, { state, challenge, redirect }) {
      const q = new URLSearchParams({ response_type: 'code', client_id: ctx.env.X_CLIENT_ID, redirect_uri: redirect, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' });
      return `${ctx.urls.xAuth}?${q}`;
    },
    async exchange(ctx, { code, verifier, redirect }) {
      const tok = await xapi(ctx, '2/oauth2/token', { form: { code, grant_type: 'authorization_code', client_id: ctx.env.X_CLIENT_ID, redirect_uri: redirect, code_verifier: verifier }, headers: basic(ctx) });
      const me = await xapi(ctx, '2/users/me', { query: { 'user.fields': 'profile_image_url,username,name' }, headers: { authorization: `Bearer ${tok.access_token}` } });
      const u = me.data || {};
      return [{ provider: 'x', kind: 'profile', externalId: u.id, name: u.name || u.username, handle: '@' + u.username, avatar: u.profile_image_url || '', can: { publish: true, inbox: false }, meta: { userId: u.id, username: u.username }, secret: { token: tok.access_token, refresh: tok.refresh_token || '' }, expiresAt: expiry(tok.expires_in) }];
    },
  },

  async refresh(ctx, acc) {
    if (Date.parse(acc.expiresAt || 0) - Date.now() > 5 * 60e3) return null;
    if (!acc.secret.refresh) throw fail('auth', 'The X sign-in has expired. Reconnect it in Accounts.');
    const tok = await xapi(ctx, '2/oauth2/token', { form: { grant_type: 'refresh_token', refresh_token: acc.secret.refresh, client_id: ctx.env.X_CLIENT_ID }, headers: basic(ctx) });
    return { secret: { token: tok.access_token, refresh: tok.refresh_token || acc.secret.refresh }, expiresAt: expiry(tok.expires_in) };
  },

  async check(ctx, acc) {
    await xapi(ctx, '2/users/me', { headers: { authorization: `Bearer ${acc.secret.token}` } });
  },

  limits: { text: 280 },

  async publish(ctx, acc, post) {
    const auth = { authorization: `Bearer ${acc.secret.token}` };
    if (post.text.length > 280) throw fail('too_long', `Too long for X: ${post.text.length}/280 characters.`);
    const media = post.media || [];
    if (media.some(m => m.type === 'video')) throw fail('needs_buffer', 'Videos on X go through Buffer, or post the text with images here.');
    const ids = [];
    for (const m of media.slice(0, 4)) {
      const file = await fetchMedia(m.url, 5 * 1024 * 1024);
      const form = new FormData();
      form.append('media', new Blob([file.buf], { type: file.type }), 'image');
      form.append('media_category', 'tweet_image');
      form.append('media_type', file.type);
      const up = await xapi(ctx, '2/media/upload', { body: form, headers: auth });
      ids.push(String((up.data && (up.data.id || up.data.media_id)) || up.media_id_string || ''));
    }
    const out = await xapi(ctx, '2/tweets', { json: { text: post.text, ...(ids.length ? { media: { media_ids: ids } } : {}) }, headers: auth });
    const id = (out.data || {}).id;
    return { id, url: `https://x.com/${acc.meta.username}/status/${id}` };
  },
};
