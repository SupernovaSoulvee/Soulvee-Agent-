// Every platform Soulvee OS connects to directly, and what each one needs.
const telegram = require('./telegram');
const meta = require('./meta');
const whatsapp = require('./whatsapp');
const threads = require('./threads');
const x = require('./x');
const linkedin = require('./linkedin');
const reddit = require('./reddit');
const gmail = require('./gmail');
const signal = require('./signal');

const MODULES = { telegram, meta, whatsapp, threads, x, linkedin, reddit, gmail, signal };
// Which module handles an account, by the account's platform.
const BY_PLATFORM = { telegram, facebook: meta, instagram: meta, whatsapp, threads, x, linkedin, reddit, gmail, signal };

function context(env) {
  return {
    env,
    graphVersion: env.META_GRAPH_VERSION || 'v26.0',
    linkedinVersion: env.LINKEDIN_VERSION || '202608',
    pollMs: Number(env.SOULVEE_MEDIA_POLL_MS) || 3000,
    urls: {
      telegram: env.TELEGRAM_API_URL || 'https://api.telegram.org',
      graph: env.META_GRAPH_URL || 'https://graph.facebook.com',
      facebook: env.META_DIALOG_URL || 'https://www.facebook.com',
      threads: env.THREADS_API_URL || 'https://graph.threads.net',
      threadsAuth: env.THREADS_AUTH_URL || 'https://threads.net/oauth/authorize',
      x: env.X_API_URL || 'https://api.x.com',
      xAuth: env.X_AUTH_URL || 'https://x.com/i/oauth2/authorize',
      linkedin: env.LINKEDIN_API_URL || 'https://api.linkedin.com',
      linkedinAuth: env.LINKEDIN_AUTH_URL || 'https://www.linkedin.com/oauth/v2',
      google: env.GOOGLE_API_URL || 'https://gmail.googleapis.com',
      googleAuth: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
      googleToken: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
      reddit: env.REDDIT_API_URL || 'https://oauth.reddit.com',
      redditAuth: env.REDDIT_AUTH_URL || 'https://www.reddit.com',
    },
  };
}

const secret = (key, label, hint) => ({ key, label, hint, secret: true });
const field = (key, label, hint) => ({ key, label, hint });

// What the Accounts screen shows for each platform: how to connect, what it can do, and what to set up.
function catalog(env, extra) {
  const ready = m => !!(m.oauth && m.oauth.ready(env));
  return [
    { id: 'meta', name: 'Facebook Pages & Instagram', platforms: ['facebook', 'instagram'], does: 'Posts, Reels, Stories and carousels to each Page and Instagram account; Messenger and Instagram messages in the inbox', oauth: ready(meta), env: 'META_APP_ID, META_APP_SECRET', fields: [secret('token', 'Or paste an access token', 'A user or Page token from the Graph API Explorer')], note: 'Posting to your own Pages works while the Meta app is in development mode. Answering customers in the inbox needs Meta to approve the app (Advanced Access for pages_messaging and instagram_manage_messages).' },
    { id: 'threads', name: 'Threads', platforms: ['threads'], does: 'Text, image, video and carousel posts', oauth: ready(threads), env: 'THREADS_APP_ID, THREADS_APP_SECRET', fields: [], note: 'Threads only accepts an https sign-in return address, so connect it on a hosted server or through a tunnel.' },
    { id: 'x', name: 'X', platforms: ['x'], does: 'Posts with up to four images', oauth: ready(x), env: 'X_CLIENT_ID (and X_CLIENT_SECRET for a confidential app)', fields: [], note: 'X charges for API use; check your developer account has access to post.' },
    { id: 'linkedin', name: 'LinkedIn', platforms: ['linkedin'], does: 'Posts with images, as you or as company pages you run', oauth: ready(linkedin), env: 'LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET', fields: [], note: 'Company pages need LinkedIn to approve the Community Management API for your app. Sign-ins last 60 days.' },
    { id: 'telegram', name: 'Telegram', platforms: ['telegram'], does: 'Posts to your channels and groups; messages to your bot in the inbox', oauth: false, fields: [secret('token', 'Bot token', 'From @BotFather'), field('chats', 'Channels or groups', 'e.g. @soulveemusic, @soulveeplus — make the bot an admin first')], note: 'One bot can post to many channels. Free, and no review needed.' },
    { id: 'whatsapp', name: 'WhatsApp Business', platforms: ['whatsapp'], does: 'Customer chats in the inbox, replies from the app', oauth: false, fields: [secret('token', 'Access token', 'A permanent system user token from Meta Business settings'), field('phoneNumberId', 'Phone number ID', 'Under your number in the WhatsApp section of the Meta app'), secret('appSecret', 'App secret', 'Meta app → Settings → Basic; used to check webhook calls are real')], webhook: extra.webhook, note: 'Needs the WhatsApp Business Platform (Cloud API) and a public server address for the webhook. WhatsApp charges for template messages; replies within 24 hours of a customer message are free.' },
    { id: 'reddit', name: 'Reddit', platforms: ['reddit'], does: 'Posts to your profile or a subreddit; private messages in the inbox', oauth: false, fields: [field('clientId', 'Client ID', 'Of a "script" app at reddit.com/prefs/apps'), secret('clientSecret', 'Client secret'), field('username', 'Username'), secret('password', 'Password'), field('subreddit', 'Default subreddit', 'Optional; blank posts to your profile')], note: 'Since late 2025 Reddit reviews API access first, and most personal apps are refused. Until yours is approved, post to Reddit by hand.' },
    { id: 'gmail', name: 'Gmail', platforms: ['gmail'], does: 'New emails in the inbox, replies in the same thread', oauth: ready(gmail), env: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET', fields: [], note: 'While the Google app is in "Testing", Google ends the sign-in after 7 days; publish the app (it can stay unverified for your own use) to keep it connected.' },
    { id: 'signal', name: 'Signal', platforms: ['signal'], does: 'One-to-one chats in the inbox', oauth: false, fields: [field('url', 'Bridge address', 'Your signal-cli-rest-api, e.g. http://localhost:8080'), field('number', 'Signal number', 'International format, e.g. +2348031234567')], note: "Signal has no official business API. This uses signal-cli-rest-api, a community bridge you run yourself; use it for one-to-one chats, not bulk messages." },
    { id: 'tiktok', name: 'TikTok', platforms: ['tiktok'], does: 'Videos and photo posts', oauth: false, viaBuffer: true, fields: [], note: "TikTok's own API only lets audited apps post publicly, so TikTok posts go through Buffer. Connect your TikTok accounts in Buffer and they appear here." },
  ];
}

// Refreshes an account's token when it is close to running out, before it is used.
async function fresh(ctx, accounts, acc) {
  const mod = BY_PLATFORM[acc.provider];
  if (!mod || !mod.refresh) return acc;
  const patch = await mod.refresh(ctx, acc);
  if (patch) accounts.refreshed(acc, patch.secret, patch.expiresAt);
  return accounts.get(acc.id) || acc;
}

module.exports = { MODULES, BY_PLATFORM, context, catalog, fresh };
