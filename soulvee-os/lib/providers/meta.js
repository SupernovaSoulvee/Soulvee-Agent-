// Facebook Pages and Instagram professional accounts through Meta's Graph API, with Facebook Login.
// One sign-in brings in every Page you manage and the Instagram account linked to each, so three
// Pages or three Instagram accounts are managed side by side. Each gets its own Page access token.
// Posting works for your own Pages while the Meta app is in development mode; reading and answering
// customers' Messenger and Instagram messages needs Meta to approve the app (Advanced Access).
const { call, fail } = require('../net');

const SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata,pages_messaging,instagram_basic,instagram_content_publish,instagram_manage_messages,business_management';
const PAGE_FIELDS = 'id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}';

async function graph(ctx, path, opts = {}) {
  const res = await call(`${ctx.urls.graph}/${ctx.graphVersion}/${String(path).replace(/^\//, '')}`, { ...opts, label: 'Meta' });
  if (res.ok) return res.data || {};
  const e = (res.data && res.data.error) || {};
  const said = e.error_user_msg || e.message || `HTTP ${res.status}`;
  if (e.code === 190) throw fail('auth', `Meta no longer accepts this sign-in (${said}). Reconnect it in Accounts.`);
  if ([4, 17, 32, 613, 80001].includes(e.code) || e.error_subcode === 2207042 || res.status === 429) throw fail('rate', `Meta's limit was reached: ${said}`, true);
  if (e.error_subcode === 2018278 || /outside of allowed window/i.test(said)) throw fail('window', 'This person last wrote more than 24 hours ago, so Meta only allows a reply once they write again.');
  if (e.code === 10 || (e.code >= 200 && e.code < 300)) throw fail('permission', `Meta refused: ${said}. The Meta app may be missing a permission, or need App Review for this.`);
  if (res.status >= 500 || e.is_transient) throw fail('server', `Meta had a problem: ${said}`, true);
  throw fail('rejected', `Meta: ${said}`);
}

const appKeys = ctx => ({ client_id: ctx.env.META_APP_ID, client_secret: ctx.env.META_APP_SECRET });

// Every Page the token can manage, plus each Page's Instagram account. A pasted Page token works too.
async function discover(ctx, token) {
  const canExchange = !!(ctx.env.META_APP_ID && ctx.env.META_APP_SECRET);
  const long = canExchange ? await graph(ctx, 'oauth/access_token', { query: { grant_type: 'fb_exchange_token', ...appKeys(ctx), fb_exchange_token: token } }).then(r => r.access_token || token, () => token) : token;
  const listed = await graph(ctx, 'me/accounts', { query: { fields: PAGE_FIELDS, limit: 100, access_token: long } }).catch(err => (err.code === 'rejected' ? null : Promise.reject(err)));
  const pages = listed ? listed.data || [] : [await graph(ctx, 'me', { query: { fields: PAGE_FIELDS.replace('access_token,', ''), access_token: long } }).then(p => ({ ...p, access_token: long }))];
  if (!pages.length) throw fail('bad_input', "Meta didn't return any Facebook Pages. When you sign in, choose the Pages (and their Instagram accounts) to share, and make sure you're an admin of them.");
  const found = [];
  pages.forEach(p => {
    found.push({ provider: 'facebook', kind: 'page', externalId: p.id, name: p.name, handle: '', avatar: (p.picture && p.picture.data && p.picture.data.url) || '', can: { publish: true, inbox: true }, meta: { pageId: p.id }, secret: { token: p.access_token } });
    const ig = p.instagram_business_account;
    if (ig) found.push({ provider: 'instagram', kind: 'profile', externalId: ig.id, name: ig.name || ig.username, handle: ig.username ? '@' + ig.username : '', avatar: ig.profile_picture_url || '', can: { publish: true, inbox: true }, meta: { pageId: p.id, igId: ig.id, username: ig.username || '', page: p.name }, secret: { token: p.access_token } });
  });
  return found;
}

// Waits until Instagram has fetched and processed a media container (videos take a while).
async function ready(ctx, id, token) {
  for (let i = 0; i < 60; i++) {
    const s = await graph(ctx, id, { query: { fields: 'status_code,status', access_token: token } });
    if (!s.status_code || s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw fail('media', `Instagram couldn't use the media: ${s.status || s.status_code}. Check it is a public JPEG image or MP4 video.`);
    await new Promise(r => setTimeout(r, ctx.pollMs));
  }
  throw fail('media', 'Instagram is still processing the video. Try again in a few minutes.', true);
}

async function toPage(ctx, acc, post) {
  const token = acc.secret.token;
  const page = acc.meta.pageId;
  const media = post.media || [];
  const video = media.find(m => m.type === 'video');
  if (video) {
    const v = await graph(ctx, `${page}/videos`, { json: { file_url: video.url, description: post.text, access_token: token } });
    return { id: v.id, url: `https://www.facebook.com/${page}/videos/${v.id}` };
  }
  // Photos are uploaded unpublished, then attached to one Page post.
  const photos = [];
  for (const m of media.filter(x => x.type === 'image').slice(0, 10)) photos.push(await graph(ctx, `${page}/photos`, { json: { url: m.url, published: false, access_token: token } }));
  const body = { message: post.text, access_token: token };
  if (photos.length) body.attached_media = photos.map(p => ({ media_fbid: p.id }));
  if (!photos.length && post.link) body.link = post.link;
  const out = await graph(ctx, `${page}/feed`, { json: body });
  return { id: out.id, url: `https://www.facebook.com/${out.id}` };
}

async function toInstagram(ctx, acc, post) {
  const token = acc.secret.token;
  const ig = acc.meta.igId;
  const media = (post.media || []).slice(0, 10);
  const story = post.igType === 'story';
  if (!media.length) throw fail('needs_media', 'Instagram needs an image or video. Add one to the post first.');
  if (post.text.length > 2200) throw fail('too_long', `Too long for Instagram: ${post.text.length}/2,200 characters.`);
  const container = (m, fields) => graph(ctx, `${ig}/media`, { json: { ...(m.type === 'video' ? { video_url: m.url } : { image_url: m.url }), ...fields, access_token: token } });
  const single = async () => {
    const m = media[0];
    const fields = story ? { media_type: 'STORIES' } : m.type === 'video' ? { media_type: 'REELS', caption: post.text, share_to_feed: true } : { caption: post.text };
    const c = await container(m, fields);
    await ready(ctx, c.id, token);
    return c.id;
  };
  const carousel = async () => {
    const kids = [];
    for (const m of media) kids.push((await container(m, { is_carousel_item: true, ...(m.type === 'video' ? { media_type: 'VIDEO' } : {}) })).id);
    for (const k of kids) await ready(ctx, k, token);
    const c = await graph(ctx, `${ig}/media`, { json: { media_type: 'CAROUSEL', children: kids.join(','), caption: post.text, access_token: token } });
    await ready(ctx, c.id, token);
    return c.id;
  };
  const creation = media.length > 1 && !story ? await carousel() : await single();
  const done = await graph(ctx, `${ig}/media_publish`, { json: { creation_id: creation, access_token: token } });
  const link = await graph(ctx, done.id, { query: { fields: 'permalink', access_token: token } }).catch(() => ({}));
  return { id: done.id, url: link.permalink || '' };
}

module.exports = {
  id: 'meta',
  name: 'Facebook Pages & Instagram',
  platforms: ['facebook', 'instagram'],
  graph,
  // Pages count API calls against Meta's per-Page limits, so their inboxes are checked every 3 minutes
  // (straight away when a Meta webhook says something arrived, or on "Check now").
  pollEvery: 180000,

  oauth: {
    ready: env => !!(env.META_APP_ID && env.META_APP_SECRET),
    authorize(ctx, { state, redirect }) {
      const q = new URLSearchParams({ client_id: ctx.env.META_APP_ID, redirect_uri: redirect, state, response_type: 'code', scope: ctx.env.META_SCOPES || SCOPES });
      return `${ctx.urls.facebook}/${ctx.graphVersion}/dialog/oauth?${q}`;
    },
    async exchange(ctx, { code, redirect }) {
      const out = await graph(ctx, 'oauth/access_token', { query: { ...appKeys(ctx), redirect_uri: redirect, code } });
      return discover(ctx, out.access_token);
    },
  },

  // fields: { token } — a user access token (e.g. from the Graph API Explorer) or a Page access token.
  async connect(ctx, f) {
    const token = String(f.token || '').trim();
    if (token.length < 20) throw fail('bad_input', 'Paste a Meta user or Page access token.');
    return discover(ctx, token);
  },

  async check(ctx, acc) {
    await graph(ctx, acc.provider === 'instagram' ? acc.meta.igId : acc.meta.pageId, { query: { fields: 'id', access_token: acc.secret.token } });
  },

  publish: (ctx, acc, post) => (acc.provider === 'instagram' ? toInstagram(ctx, acc, post) : toPage(ctx, acc, post)),

  // Messenger (Pages) and Instagram direct messages, read through the Page's conversations.
  async poll(ctx, acc, cursor) {
    const instagram = acc.provider === 'instagram';
    const out = await graph(ctx, `${acc.meta.pageId}/conversations`, { query: { platform: instagram ? 'instagram' : 'messenger', fields: 'id,updated_time,participants,messages.limit(20){id,message,from,created_time}', limit: 25, access_token: acc.secret.token } });
    const since = (cursor && cursor.since) || '';
    const self = new Set([acc.meta.pageId, acc.meta.igId].filter(Boolean));
    const convos = (out.data || []).filter(c => !since || Date.parse(c.updated_time) > Date.parse(since));
    const items = convos.flatMap(c => {
      const other = ((c.participants && c.participants.data) || []).find(p => !self.has(p.id)) || {};
      return ((c.messages && c.messages.data) || []).map(m => ({
        thread: c.id,
        peer: { id: other.id || '', name: other.name || other.username || 'Customer', handle: other.username ? '@' + other.username : '' },
        id: m.id,
        dir: m.from && self.has(m.from.id) ? 'out' : 'in',
        text: m.message || '[attachment]',
        at: new Date(m.created_time).toISOString(),
      }));
    });
    const newest = (out.data || []).map(c => c.updated_time).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).pop();
    return { items, cursor: { since: newest || since } };
  },

  async send(ctx, acc, convo, msg) {
    if (!convo.peer.id) throw fail('rejected', "Meta didn't say who this conversation is with, so it can't be answered from here.");
    const out = await graph(ctx, `${acc.meta.pageId}/messages`, { json: { recipient: { id: convo.peer.id }, messaging_type: 'RESPONSE', message: { text: msg.text }, access_token: acc.secret.token } });
    return { id: out.message_id || '' };
  },

  // A Messenger or Instagram webhook event: which connected accounts to check for new messages now.
  webhookTargets(body, accounts) {
    const ids = new Set((body.entry || []).map(e => String(e.id)));
    const kind = body.object === 'instagram' ? 'instagram' : 'facebook';
    return accounts.filter(a => a.provider === kind && (ids.has(String(a.meta.pageId)) || ids.has(String(a.meta.igId))));
  },
};
