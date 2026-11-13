#!/usr/bin/env node
// Soulvee OS server: serves the app, streams Claude for the AI features (the API key stays
// on the server), publishes social posts to connected accounts, Buffer or a Make/Zapier/n8n
// webhook, and collects messages from connected accounts into the inbox.
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Settings come from .env next to this file. SOULVEE_ENV_FILE points somewhere else, and "none" skips
// it: the test runner sets "none" so tests can never pick up your real keys and accounts.
if (process.env.SOULVEE_ENV_FILE !== 'none') loadEnv(path.resolve(process.env.SOULVEE_ENV_FILE || path.join(__dirname, '.env')));

const claude = require('./lib/claude');
const social = require('./lib/social');
const imaging = require('./lib/images');
const autopilot = require('./lib/autopilot');
const accountStore = require('./lib/accounts');
const oauthLinks = require('./lib/oauth');
const providers = require('./lib/providers');
const inboxStore = require('./lib/inbox');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const ACCESS_TOKEN = process.env.SOULVEE_ACCESS_TOKEN || ''; // lets other devices use AI, images and publishing
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.SOULVEE_DATA_DIR || path.join(__dirname, 'data'));
const MAX_BODY = 2 * 1024 * 1024;

// Where platforms send people back after signing in, and where Meta sends webhooks.
const BASE_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

const ai = claude.create(process.env);
const accounts = accountStore.create(DATA_DIR);
const oauth = oauthLinks.create();
const pctx = providers.context(process.env);
const posts = social.create(process.env, DATA_DIR, { accounts });
const inbox = inboxStore.create({ env: process.env, dir: DATA_DIR, accounts });
const images = imaging.create(process.env, DATA_DIR);
const pilot = autopilot.create({ env: process.env, dir: DATA_DIR, ai, social: posts, images });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

// The request body as text, or as raw bytes when `raw` is set (webhook signatures are checked on the bytes).
function readBody(req, raw) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(raw ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req).catch(() => null);
  if (text === null) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

function hasToken(req) {
  const cookie = req.headers.cookie || '';
  return req.headers['x-soulvee-token'] === ACCESS_TOKEN || cookie.split(/;\s*/).includes('soulvee_token=' + encodeURIComponent(ACCESS_TOKEN));
}

// A visit from the computer running Soulvee OS. A reverse proxy or tunnel on this computer
// (nginx, Caddy, Cloudflare Tunnel, ngrok) also connects from 127.0.0.1, so forwarded requests count as remote.
function local(req) {
  const ip = req.socket.remoteAddress || '';
  const h = req.headers;
  return (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') && !h['x-forwarded-for'] && !h.forwarded && !h['x-real-ip'];
}

// AI and images spend your API credit, and publishing reaches your real accounts. With
// SOULVEE_ACCESS_TOKEN set they need the token; without it they only work on this computer.
function allowed(req) {
  return ACCESS_TOKEN ? hasToken(req) : local(req);
}

// The message for a request that allowed() turned away. `feature` is e.g. "AI is" or "Images are".
function locked(feature) {
  return ACCESS_TOKEN
    ? `${feature} locked: open the app once with ?token=YOUR_TOKEN.`
    : `${feature} only available on the computer running Soulvee OS. To use it from other devices, set SOULVEE_ACCESS_TOKEN on the server.`;
}

// Why AI is unavailable for this request, or '' when it can be used.
function aiBlock(req, url) {
  if (!ai.client) return 'no_key';
  if (allowed(req) || (ACCESS_TOKEN && url.searchParams.get('token') === ACCESS_TOKEN)) return '';
  return ACCESS_TOKEN ? 'locked' : 'local_only';
}

async function handleClaude(req, res) {
  if (!ai.client) return send(res, 503, { error: { code: 'no_key', message: 'AI is off: set ANTHROPIC_API_KEY on the server.' } });
  if (!allowed(req)) return send(res, 401, { error: { code: 'locked', message: locked('AI is') } });
  const body = await readJson(req);
  const problem = claude.check(body);
  if (problem) return send(res, 400, { error: { code: 'bad_request', message: problem } });
  return claude.stream(ai, res, body);
}

async function handleAiTest(req, res) {
  if (!ai.client) return send(res, 200, { ok: false, code: 'no_key', message: 'AI is off: set ANTHROPIC_API_KEY on the server, then restart it.' });
  if (!allowed(req)) return send(res, 401, { ok: false, code: 'locked', message: locked('AI is') });
  const out = await claude.test(ai).catch(err => ({ ok: false, ...claude.explain(err, ai.model) }));
  return send(res, 200, out);
}

async function handleSocial(req, res, url) {
  const route = url.pathname.slice('/api/social/'.length);
  if (route === 'status' && req.method === 'GET') return send(res, 200, { ...posts.status(), allowed: allowed(req) });
  if (!allowed(req)) return send(res, 403, { error: { code: 'locked', message: locked('Publishing is') } });
  const reply = promise => promise.then(data => send(res, 200, data), err => send(res, err.code ? 400 : 500, { error: { code: err.code || 'server', message: err.message } }));
  if (route === 'channels' && req.method === 'GET') return reply(posts.channels(url.searchParams.get('refresh') === '1').then(channels => ({ channels })));
  if (route === 'publish' && req.method === 'POST') {
    const body = await readJson(req);
    const target = ['webhook', 'accounts'].includes(body && body.target) ? body.target : 'buffer';
    return reply(Promise.resolve().then(() => posts.publish(social.clean(body && body.post, target), target)));
  }
  if (route === 'jobs' && req.method === 'GET') return send(res, 200, { jobs: posts.jobs(String(url.searchParams.get('ids') || '').split(',').filter(Boolean)) });
  const cancel = route.match(/^jobs\/([\w-]+)\/cancel$/);
  if (cancel && req.method === 'POST') return reply(Promise.resolve().then(() => ({ job: posts.cancel(cancel[1]) })));
  if (route === 'test-webhook' && req.method === 'POST') return reply(posts.testHook());
  if (route === 'insights' && req.method === 'GET') return reply(posts.insights({ days: url.searchParams.get('days'), tz: url.searchParams.get('tz') || undefined, refresh: url.searchParams.get('refresh') === '1' }));
  return send(res, 404, { error: { code: 'not_found', message: 'Not found' } });
}

// Coded errors from the platforms become a 400 (or 502 when trying again later might work).
const replyWith = (res, work) => Promise.resolve().then(work).then(
  data => send(res, 200, data),
  err => send(res, err.code ? (err.retry ? 502 : err.code === 'not_found' ? 404 : 400) : 500, { error: { code: err.code || 'server', message: err.message } }),
);
const SERVICE_PLATFORM = { twitter: 'x' };
const redirectFor = id => `${BASE_URL}/oauth/callback/${id}`;
const webhookInfo = () => ({ url: `${BASE_URL}/webhooks/meta`, verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || accounts.webhookToken(), publicUrl: !!process.env.PUBLIC_URL, appSecret: !!process.env.META_APP_SECRET });

async function handleAccounts(req, res, url) {
  if (!allowed(req)) return send(res, 403, { error: { code: 'locked', message: locked('Accounts are') } });
  const route = url.pathname.slice('/api/accounts'.length);
  if (route === '' && req.method === 'GET') {
    const status = posts.status();
    const channels = status.buffer ? await posts.channels(url.searchParams.get('refresh') === '1').catch(() => null) : [];
    return send(res, 200, {
      accounts: accounts.list().map(accounts.view),
      buffer: (channels || []).map(c => ({ id: 'buffer:' + c.id, via: 'buffer', provider: SERVICE_PLATFORM[c.service] || c.service, kind: 'channel', name: c.displayName || c.name, avatar: c.avatar || '', enabled: true, can: { publish: true, inbox: false }, status: c.isDisconnected || c.isLocked ? 'error' : 'ok', error: c.isDisconnected ? 'Disconnected in Buffer. Reconnect it there.' : c.isLocked ? 'Locked in Buffer (over your plan).' : '' })),
      bufferError: status.buffer && !channels ? "Couldn't load your Buffer channels right now." : '',
      bufferConnected: status.buffer,
      providers: providers.catalog(process.env, { webhook: webhookInfo() }),
      redirect: `${BASE_URL}/oauth/callback/`,
    });
  }
  const connect = route.match(/^\/connect\/(\w+)$/);
  if (connect && req.method === 'POST') {
    const body = await readJson(req);
    return replyWith(res, async () => {
      const mod = providers.MODULES[connect[1]];
      if (!mod || !mod.connect) throw Object.assign(new Error('That platform connects with a sign-in, not a form.'), { code: 'bad_input' });
      const found = await mod.connect(pctx, body || {}, id => accounts.get(id));
      return { accounts: accounts.upsert(found).map(accounts.view) };
    });
  }
  const start = route.match(/^\/oauth\/(\w+)$/);
  if (start && req.method === 'POST') {
    return replyWith(res, () => {
      const mod = providers.MODULES[start[1]];
      if (!mod || !mod.oauth) throw Object.assign(new Error("That platform doesn't use a sign-in link."), { code: 'bad_input' });
      const info = providers.catalog(process.env, { webhook: {} }).find(p => p.id === start[1]) || {};
      if (!mod.oauth.ready(process.env)) throw Object.assign(new Error(`Add ${info.env || 'the app keys'} to the server's .env, restart it, then connect.`), { code: 'not_set_up' });
      const s = oauth.begin(start[1]);
      return { url: mod.oauth.authorize(pctx, { state: s.state, challenge: s.challenge, redirect: redirectFor(start[1]) }) };
    });
  }
  const one = route.match(/^\/(acc_\w+)(\/test)?$/);
  if (one && !one[2] && req.method === 'PATCH') {
    const body = await readJson(req);
    const acc = accounts.update(one[1], body || {});
    return acc ? send(res, 200, { account: accounts.view(acc) }) : send(res, 404, { error: { code: 'not_found', message: 'That account was not found.' } });
  }
  if (one && !one[2] && req.method === 'DELETE') {
    if (!accounts.remove(one[1])) return send(res, 404, { error: { code: 'not_found', message: 'That account was not found.' } });
    inbox.forget(one[1]);
    return send(res, 200, { ok: true });
  }
  if (one && one[2] && req.method === 'POST') {
    return replyWith(res, async () => {
      const acc = accounts.get(one[1]);
      if (!acc) throw Object.assign(new Error('That account was not found.'), { code: 'not_found' });
      const live = await providers.fresh(pctx, accounts, acc).catch(err => { accounts.mark(acc.id, err.message); throw err; });
      await providers.BY_PLATFORM[acc.provider].check(pctx, live).catch(err => { accounts.mark(acc.id, err.message); throw err; });
      accounts.mark(acc.id, '');
      return { account: accounts.view(accounts.get(acc.id)) };
    });
  }
  return send(res, 404, { error: { code: 'not_found', message: 'Not found' } });
}

// The platform sends the browser back here after sign-in; the app then shows what was connected.
async function handleCallback(req, res, url) {
  const id = url.pathname.slice('/oauth/callback/'.length);
  const back = q => { res.writeHead(302, { location: `/?${new URLSearchParams(q)}#accounts`, 'cache-control': 'no-store' }); res.end(); };
  if (!allowed(req)) return back({ connect_error: locked('Connecting accounts is') });
  const pending = oauth.finish(id, url.searchParams.get('state'));
  if (!pending) return back({ connect_error: 'That sign-in link has expired or was already used. Start again from Accounts.' });
  const denied = url.searchParams.get('error_description') || url.searchParams.get('error_message') || url.searchParams.get('error');
  if (denied) return back({ connect_error: `The sign-in was cancelled or refused: ${denied}` });
  const mod = providers.MODULES[id];
  const found = await mod.oauth.exchange(pctx, { code: url.searchParams.get('code'), verifier: pending.verifier, redirect: redirectFor(id) }).catch(err => ({ error: err }));
  if (found.error) return back({ connect_error: found.error.message });
  return back({ connected: id, count: accounts.upsert(found).length });
}

async function handleInbox(req, res, url) {
  if (!allowed(req)) return send(res, 403, { error: { code: 'locked', message: locked('The inbox is') } });
  const route = url.pathname.slice('/api/inbox'.length);
  if (route === '' && req.method === 'GET') return send(res, 200, { conversations: inbox.list(), unread: inbox.unread() });
  if (route === '/sync' && req.method === 'POST') return replyWith(res, async () => ({ added: await inbox.pollAll(true), conversations: inbox.list(), unread: inbox.unread() }));
  const m = route.match(/^\/c\/([^/]+)(\/reply|\/read)?$/);
  if (!m) return send(res, 404, { error: { code: 'not_found', message: 'Not found' } });
  const key = (() => { try { return decodeURIComponent(m[1]); } catch { return ''; } })();
  if (!m[2] && req.method === 'GET') { const c = inbox.get(key); return c ? send(res, 200, { conversation: c }) : send(res, 404, { error: { code: 'not_found', message: 'That conversation was not found.' } }); }
  if (m[2] === '/read' && req.method === 'POST') return replyWith(res, () => ({ conversation: inbox.read(key) }));
  if (m[2] === '/reply' && req.method === 'POST') { const body = await readJson(req); return replyWith(res, async () => ({ conversation: await inbox.reply(key, body || {}) })); }
  return send(res, 404, { error: { code: 'not_found', message: 'Not found' } });
}

// Meta webhooks (WhatsApp, and optionally Messenger and Instagram). Meta signs each call with the app
// secret; unsigned or wrongly signed calls are refused.
async function handleWebhook(req, res, url) {
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === webhookInfo().verifyToken;
    res.writeHead(ok ? 200 : 403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(ok ? String(url.searchParams.get('hub.challenge') || '') : 'The verify token does not match.');
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const raw = await readBody(req, true).catch(() => null);
  if (!raw) return send(res, 400, { error: 'Bad request body' });
  const sig = Buffer.from(String(req.headers['x-hub-signature-256'] || ''));
  const secrets = [process.env.META_APP_SECRET, ...accounts.list(a => a.provider === 'whatsapp').map(a => a.secret && a.secret.appSecret)].filter(Boolean);
  const valid = secrets.some(sec => { const want = Buffer.from('sha256=' + crypto.createHmac('sha256', sec).update(raw).digest('hex')); return want.length === sig.length && crypto.timingSafeEqual(want, sig); });
  if (!valid) return send(res, 401, { error: secrets.length ? 'Bad signature' : 'Set META_APP_SECRET (or the app secret on the WhatsApp account) so webhook calls can be checked.' });
  const body = (() => { try { return JSON.parse(raw.toString('utf8')); } catch { return null; } })();
  send(res, 200, { ok: true });
  if (body) inbox.webhook(body).catch(err => console.error('Webhook handling failed: ' + err.message));
}

async function handleImages(req, res) {
  if (!allowed(req)) return send(res, 401, { error: { code: 'locked', message: locked('Images are') } });
  const body = await readJson(req);
  if (!body) return send(res, 400, { error: { code: 'bad_request', message: 'Bad request body' } });
  const media = await images.generate(body).catch(err => ({ error: err }));
  if (media.error) return send(res, media.error.code ? 400 : 500, { error: { code: media.error.code || 'server', message: media.error.message } });
  return send(res, 200, { media });
}

async function handleAutopilot(req, res, url) {
  const route = url.pathname.slice('/api/autopilot'.length);
  if (route === '' && req.method === 'GET') return send(res, 200, allowed(req) ? { allowed: true, ...pilot.status() } : { allowed: false });
  if (!allowed(req)) return send(res, 403, { error: { code: 'locked', message: locked('Autopilot is') } });
  const reply = fn => Promise.resolve().then(fn).then(data => send(res, 200, data), err => send(res, err.code ? 400 : 500, { error: { code: err.code || 'server', message: err.message } }));
  if (route === '' && req.method === 'PUT') { const body = await readJson(req); return reply(() => pilot.update(body)); }
  if (route === '/context' && req.method === 'POST') { const body = await readJson(req); return reply(() => pilot.setContext(body)); }
  if (route === '/run' && req.method === 'POST') return reply(() => pilot.runNow());
  if (route === '/inbox' && req.method === 'GET') return send(res, 200, { drafts: pilot.take() });
  if (route === '/inbox/ack' && req.method === 'POST') { const body = await readJson(req); return reply(() => pilot.ack(Array.isArray(body && body.ids) ? body.ids.map(String) : [])); }
  return send(res, 404, { error: { code: 'not_found', message: 'Not found' } });
}

// Images made for posts, served publicly so Buffer and the networks can fetch them.
function serveMedia(req, res, name) {
  const file = images.file(name);
  if (!file) return send(res, 404, { error: 'Not found' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
    res.end(data);
  });
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, { error: 'Bad path' }); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // Single-page app: unknown paths fall back to the app shell.
      if (!path.extname(rel) && rel !== '/index.html') return serveStatic(req, res, '/index.html');
      return send(res, 404, { error: 'Not found' });
    }
    // Always revalidate, so an update reaches phones on the next load; unchanged files cost a 304.
    const etag = `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
    const headers = { 'cache-control': 'no-cache', etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    fs.readFile(file, (readErr, data) => {
      if (readErr) return send(res, 500, { error: 'Could not read file' });
      res.writeHead(200, { ...headers, 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  // ?token=… sets a cookie so the token isn't needed on every visit.
  if (ACCESS_TOKEN && url.searchParams.get('token') === ACCESS_TOKEN) {
    res.setHeader('set-cookie', `soulvee_token=${encodeURIComponent(ACCESS_TOKEN)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  }
  try {
    if (url.pathname === '/api/health') {
      const reason = aiBlock(req, url);
      return send(res, 200, { ok: true, ai: !reason, reason: reason || undefined, model: ai.model, social: posts.status(), images: images.status() });
    }
    if (url.pathname === '/api/claude' && req.method === 'POST') return await handleClaude(req, res);
    if (url.pathname === '/api/ai-test' && req.method === 'POST') return await handleAiTest(req, res);
    if (url.pathname.startsWith('/api/social/')) return await handleSocial(req, res, url);
    if (url.pathname === '/api/images/generate' && req.method === 'POST') return await handleImages(req, res);
    if (url.pathname === '/api/autopilot' || url.pathname.startsWith('/api/autopilot/')) return await handleAutopilot(req, res, url);
    if (url.pathname === '/api/accounts' || url.pathname.startsWith('/api/accounts/')) return await handleAccounts(req, res, url);
    if (url.pathname === '/api/inbox' || url.pathname.startsWith('/api/inbox/')) return await handleInbox(req, res, url);
    if (url.pathname.startsWith('/oauth/callback/') && req.method === 'GET') return await handleCallback(req, res, url);
    if (url.pathname === '/webhooks/meta') return await handleWebhook(req, res, url);
    if (url.pathname.startsWith('/media/') && (req.method === 'GET' || req.method === 'HEAD')) return serveMedia(req, res, url.pathname.slice('/media/'.length));
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: { message: e.message } });
    if (res.headersSent && !res.writableEnded) res.end();
  }
});

posts.start();
pilot.start();
inbox.start();
server.listen(PORT, HOST, () => {
  const s = posts.status();
  console.log(`Soulvee OS running on http://localhost:${PORT}`);
  console.log(ai.client ? `AI on (model ${ai.model})${ACCESS_TOKEN ? ', token-protected' : ''}` : 'AI off: set ANTHROPIC_API_KEY to enable the agent, content generator, offer builder and lessons');
  console.log(`Publishing: ${[s.buffer && 'Buffer', s.webhook && `webhook${s.signed ? ' (signed)' : ''}`].filter(Boolean).join(' + ') || 'off (copy and post by hand)'}`);
  const img = images.status();
  console.log(img.ready ? `Images on (${img.model}, hosted ${img.hosting === 'cloudinary' ? 'on Cloudinary' : img.hosting === 'server' ? 'at PUBLIC_URL/media' : 'on this server only'})` : 'Images off: set OPENAI_API_KEY to make post images');
  const ap = pilot.status();
  if (ap.enabled) console.log(`Autopilot on: next run ${ap.nextRun}`);
  const linked = accounts.list();
  if (linked.length) console.log(`Accounts: ${linked.length} connected (${linked.filter(a => a.can && a.can.inbox).length} with an inbox)`);
  if (!ACCESS_TOKEN && (ai.client || img.ready || s.buffer || s.webhook || linked.length)) console.log('AI, images and publishing only work on this computer. Set SOULVEE_ACCESS_TOKEN to use them from other devices or a public host.');
});
