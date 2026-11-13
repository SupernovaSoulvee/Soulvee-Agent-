// LinkedIn through the Posts API. Posting as yourself works with the "Share on LinkedIn" and "Sign In
// with LinkedIn using OpenID Connect" products. Posting as a company page needs LinkedIn's approval for
// the Community Management API; when the app has it, set LINKEDIN_SCOPES to add the organization scopes
// and every page you administer is connected too. Tokens last 60 days; reconnect before they run out.
const { call, fail, fetchMedia } = require('../net');

const SCOPES = 'openid profile w_member_social';

const said = data => (data && (data.message || data.error_description || data.error)) || '';

async function li(ctx, url, opts = {}) {
  const res = await call(url, { ...opts, label: 'LinkedIn' });
  if (res.ok) return res;
  const why = said(res.data) || `HTTP ${res.status}`;
  if (res.status === 401) throw fail('auth', `LinkedIn no longer accepts this sign-in (${why}). Reconnect it in Accounts.`);
  if (res.status === 426 || /version/i.test(why) && res.status === 400) throw fail('version', `LinkedIn refused the API version (${why}). Set LINKEDIN_VERSION to a current month, e.g. 202609.`);
  if (res.status === 429) throw fail('rate', `LinkedIn's limit was reached: ${why}`, true);
  if (res.status >= 500) throw fail('server', `LinkedIn had a problem: ${why}`, true);
  throw fail(res.status === 403 ? 'permission' : 'rejected', `LinkedIn: ${why}`);
}

const rest = ctx => ({ 'LinkedIn-Version': ctx.linkedinVersion, 'X-Restli-Protocol-Version': '2.0.0' });

// LinkedIn's post text treats some characters as markup, so they are escaped; hashtags stay clickable.
const commentary = text => String(text).split(/(#[\p{L}\p{N}_]+)/u).map(part => (/^#[\p{L}\p{N}_]+$/u.test(part) ? `{hashtag|\\#|${part.slice(1)}}` : part.replace(/[\\|{}@[\]()<>#*_~]/g, ch => '\\' + ch))).join('');

module.exports = {
  id: 'linkedin',
  name: 'LinkedIn',
  commentary,

  oauth: {
    ready: env => !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),
    authorize(ctx, { state, redirect }) {
      const q = new URLSearchParams({ response_type: 'code', client_id: ctx.env.LINKEDIN_CLIENT_ID, redirect_uri: redirect, state, scope: String(ctx.env.LINKEDIN_SCOPES || SCOPES).split(/[\s,]+/).filter(Boolean).join(' ') });
      return `${ctx.urls.linkedinAuth}/authorization?${q}`;
    },
    async exchange(ctx, { code, redirect }) {
      const tok = (await li(ctx, `${ctx.urls.linkedinAuth}/accessToken`, { form: { grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: ctx.env.LINKEDIN_CLIENT_ID, client_secret: ctx.env.LINKEDIN_CLIENT_SECRET } })).data;
      const auth = { authorization: `Bearer ${tok.access_token}` };
      const me = (await li(ctx, `${ctx.urls.linkedin}/v2/userinfo`, { headers: auth })).data;
      const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 5184000) * 1000).toISOString();
      const secret = { token: tok.access_token };
      const found = [{ provider: 'linkedin', kind: 'profile', externalId: me.sub, name: me.name || [me.given_name, me.family_name].filter(Boolean).join(' '), handle: '', avatar: me.picture || '', can: { publish: true, inbox: false }, meta: { author: `urn:li:person:${me.sub}` }, secret, expiresAt }];
      if (/organization/.test(ctx.env.LINKEDIN_SCOPES || '')) {
        const acls = (await li(ctx, `${ctx.urls.linkedin}/rest/organizationAcls`, { query: { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED' }, headers: { ...auth, ...rest(ctx) } }).catch(() => ({ data: {} }))).data;
        for (const el of (acls && acls.elements) || []) {
          const id = String(el.organization || '').split(':').pop();
          const org = (await li(ctx, `${ctx.urls.linkedin}/rest/organizations/${id}`, { headers: { ...auth, ...rest(ctx) } }).catch(() => ({ data: {} }))).data || {};
          found.push({ provider: 'linkedin', kind: 'organization', externalId: 'org:' + id, name: org.localizedName || `Company page ${id}`, handle: org.vanityName || '', avatar: '', can: { publish: true, inbox: false }, meta: { author: `urn:li:organization:${id}` }, secret, expiresAt });
        }
      }
      return found;
    },
  },

  async refresh(ctx, acc) {
    if (Date.parse(acc.expiresAt || 0) > Date.now()) return null;
    throw fail('auth', 'The LinkedIn sign-in has expired (they last 60 days). Reconnect it in Accounts.');
  },

  async check(ctx, acc) {
    await li(ctx, `${ctx.urls.linkedin}/v2/userinfo`, { headers: { authorization: `Bearer ${acc.secret.token}` } });
  },

  limits: { text: 3000 },

  async publish(ctx, acc, post) {
    const auth = { authorization: `Bearer ${acc.secret.token}` };
    const author = acc.meta.author;
    if (post.text.length > 3000) throw fail('too_long', `Too long for LinkedIn: ${post.text.length}/3,000 characters.`);
    const media = post.media || [];
    if (media.some(m => m.type === 'video')) throw fail('needs_buffer', 'Videos on LinkedIn go through Buffer, or post the text with images here.');
    const images = [];
    for (const m of media.slice(0, 9)) {
      const init = (await li(ctx, `${ctx.urls.linkedin}/rest/images?action=initializeUpload`, { json: { initializeUploadRequest: { owner: author } }, headers: { ...auth, ...rest(ctx) } })).data.value;
      const file = await fetchMedia(m.url);
      await li(ctx, init.uploadUrl, { method: 'PUT', body: file.buf, headers: { ...auth, 'content-type': file.type } });
      images.push(init.image);
    }
    const body = {
      author,
      commentary: commentary(post.text),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (images.length === 1) body.content = { media: { id: images[0] } };
    if (images.length > 1) body.content = { multiImage: { images: images.map(id => ({ id })) } };
    const res = await li(ctx, `${ctx.urls.linkedin}/rest/posts`, { json: body, headers: { ...auth, ...rest(ctx) } });
    const urn = res.headers.get('x-restli-id') || '';
    return { id: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : '' };
  },
};
