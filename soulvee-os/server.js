#!/usr/bin/env node
// Soulvee OS server: serves the app, streams Claude for the AI features (the API key stays
// on the server) and publishes social posts through Buffer or a Make/Zapier/n8n webhook.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

loadEnv(path.join(__dirname, '.env'));

const claude = require('./lib/claude');
const social = require('./lib/social');
const imaging = require('./lib/images');
const autopilot = require('./lib/autopilot');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const ACCESS_TOKEN = process.env.SOULVEE_ACCESS_TOKEN || ''; // protects AI and publishing when hosted publicly
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.SOULVEE_DATA_DIR || path.join(__dirname, 'data'));
const MAX_BODY = 2 * 1024 * 1024;

const ai = claude.create(process.env);
const posts = social.create(process.env, DATA_DIR);
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req).catch(() => null);
  if (text === null) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

function authorised(req) {
  if (!ACCESS_TOKEN) return true;
  const cookie = req.headers.cookie || '';
  return req.headers['x-soulvee-token'] === ACCESS_TOKEN || cookie.split(/;\s*/).includes('soulvee_token=' + encodeURIComponent(ACCESS_TOKEN));
}

function loopback(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Publishing reaches your real social accounts, so without SOULVEE_ACCESS_TOKEN it is only
// allowed from this computer. Hosted publicly, set the token.
function canPublish(req) {
  return ACCESS_TOKEN ? authorised(req) : loopback(req);
}

// Why AI is unavailable for this request, or '' when it can be used.
function aiBlock(req, url) {
  if (!ai.client) return 'no_key';
  if (!authorised(req) && url.searchParams.get('token') !== ACCESS_TOKEN) return 'locked';
  return '';
}

async function handleClaude(req, res) {
  if (!ai.client) return send(res, 503, { error: { code: 'no_key', message: 'AI is off: set ANTHROPIC_API_KEY on the server.' } });
  if (!authorised(req)) return send(res, 401, { error: { code: 'locked', message: 'AI is locked: open the app once with ?token=YOUR_TOKEN.' } });
  const body = await readJson(req);
  const problem = claude.check(body);
  if (problem) return send(res, 400, { error: { code: 'bad_request', message: problem } });
  return claude.stream(ai, res, body);
}

async function handleAiTest(req, res) {
  if (!ai.client) return send(res, 200, { ok: false, code: 'no_key', message: 'AI is off: set ANTHROPIC_API_KEY on the server, then restart it.' });
  if (!authorised(req)) return send(res, 401, { ok: false, code: 'locked', message: 'AI is locked: open the app once with ?token=YOUR_TOKEN.' });
  const out = await claude.test(ai).catch(err => ({ ok: false, ...claude.explain(err, ai.model) }));
  return send(res, 200, out);
}

async function handleSocial(req, res, url) {
  const route = url.pathname.slice('/api/social/'.length);
  if (route === 'status' && req.method === 'GET') return send(res, 200, { ...posts.status(), allowed: canPublish(req) });
  if (!canPublish(req)) return send(res, 403, { error: { code: 'locked', message: ACCESS_TOKEN ? 'Publishing is locked: open the app once with ?token=YOUR_TOKEN.' : 'Publishing only works from the computer running Soulvee OS until SOULVEE_ACCESS_TOKEN is set.' } });
  const reply = promise => promise.then(data => send(res, 200, data), err => send(res, err.code ? 400 : 500, { error: { code: err.code || 'server', message: err.message } }));
  if (route === 'channels' && req.method === 'GET') return reply(posts.channels(url.searchParams.get('refresh') === '1').then(channels => ({ channels })));
  if (route === 'publish' && req.method === 'POST') {
    const body = await readJson(req);
    const target = body && body.target === 'webhook' ? 'webhook' : 'buffer';
    return reply(Promise.resolve().then(() => posts.publish(social.clean(body && body.post, target), target)));
  }
  if (route === 'jobs' && req.method === 'GET') return send(res, 200, { jobs: posts.jobs(String(url.searchParams.get('ids') || '').split(',').filter(Boolean)) });
  const cancel = route.match(/^jobs\/([\w-]+)\/cancel$/);
  if (cancel && req.method === 'POST') return reply(Promise.resolve().then(() => ({ job: posts.cancel(cancel[1]) })));
  if (route === 'test-webhook' && req.method === 'POST') return reply(posts.testHook());
  if (route === 'insights' && req.method === 'GET') return reply(posts.insights({ days: url.searchParams.get('days'), tz: url.searchParams.get('tz') || undefined, refresh: url.searchParams.get('refresh') === '1' }));
  return send(res, 404, { error: { code: 'not_found', message: 'Not found' } });
}

async function handleImages(req, res) {
  if (!authorised(req)) return send(res, 401, { error: { code: 'locked', message: 'Images are locked: open the app once with ?token=YOUR_TOKEN.' } });
  const body = await readJson(req);
  if (!body) return send(res, 400, { error: { code: 'bad_request', message: 'Bad request body' } });
  const media = await images.generate(body).catch(err => ({ error: err }));
  if (media.error) return send(res, media.error.code ? 400 : 500, { error: { code: media.error.code || 'server', message: media.error.message } });
  return send(res, 200, { media });
}

async function handleAutopilot(req, res, url) {
  const route = url.pathname.slice('/api/autopilot'.length);
  if (route === '' && req.method === 'GET') return send(res, 200, canPublish(req) ? { allowed: true, ...pilot.status() } : { allowed: false });
  if (!canPublish(req)) return send(res, 403, { error: { code: 'locked', message: ACCESS_TOKEN ? 'Autopilot is locked: open the app once with ?token=YOUR_TOKEN.' : 'Autopilot can only be changed from the computer running Soulvee OS until SOULVEE_ACCESS_TOKEN is set.' } });
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
server.listen(PORT, HOST, () => {
  const s = posts.status();
  console.log(`Soulvee OS running on http://localhost:${PORT}`);
  console.log(ai.client ? `AI on (model ${ai.model})${ACCESS_TOKEN ? ', token-protected' : ''}` : 'AI off: set ANTHROPIC_API_KEY to enable the agent, content generator, offer builder and lessons');
  console.log(`Publishing: ${[s.buffer && 'Buffer', s.webhook && `webhook${s.signed ? ' (signed)' : ''}`].filter(Boolean).join(' + ') || 'off (copy and post by hand)'}`);
  const img = images.status();
  console.log(img.ready ? `Images on (${img.model}, hosted ${img.hosting === 'cloudinary' ? 'on Cloudinary' : img.hosting === 'server' ? 'at PUBLIC_URL/media' : 'on this server only'})` : 'Images off: set OPENAI_API_KEY to make post images');
  const ap = pilot.status();
  if (ap.enabled) console.log(`Autopilot on: next run ${ap.nextRun}`);
  if ((s.buffer || s.webhook) && !ACCESS_TOKEN) console.log('Publishing is limited to this computer. Set SOULVEE_ACCESS_TOKEN before hosting Soulvee OS publicly.');
});
