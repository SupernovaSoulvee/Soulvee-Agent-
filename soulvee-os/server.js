#!/usr/bin/env node
// Soulvee OS server: serves the app and proxies AI requests to Claude so the
// API key stays on the server. No dependencies; needs Node 18+.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.SOULVEE_MODEL || 'claude-sonnet-5-5';
const ACCESS_TOKEN = process.env.SOULVEE_ACCESS_TOKEN || ''; // optional: protects /api/claude when hosted publicly
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 2 * 1024 * 1024;

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
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authorised(req) {
  if (!ACCESS_TOKEN) return true;
  const cookie = req.headers.cookie || '';
  return req.headers['x-soulvee-token'] === ACCESS_TOKEN || cookie.split(/;\s*/).includes('soulvee_token=' + encodeURIComponent(ACCESS_TOKEN));
}

async function handleClaude(req, res) {
  if (!API_KEY) return send(res, 503, { error: { message: 'AI is off: set ANTHROPIC_API_KEY on the server.' } });
  if (!authorised(req)) return send(res, 401, { error: { message: 'AI is locked: open the app once with ?token=YOUR_TOKEN.' } });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: { message: 'Bad request body' } }); }
  if (!Array.isArray(body.messages) || !body.messages.length) return send(res, 400, { error: { message: 'messages required' } });

  const payload = {
    model: MODEL,
    max_tokens: Math.min(Number(body.max_tokens) || 2048, 8192),
    messages: body.messages,
  };
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools;
  if (typeof body.system === 'string') payload.system = body.system;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(text);
  } catch (e) {
    send(res, 502, { error: { message: 'Could not reach Claude: ' + e.message } });
  }
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return send(res, 400, { error: 'Bad path' }); }
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

// Why AI is unavailable for this request, or '' when it can be used.
function aiBlock(req, url) {
  if (!API_KEY) return 'no_key';
  if (!authorised(req) && url.searchParams.get('token') !== ACCESS_TOKEN) return 'locked';
  return '';
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
      return send(res, 200, { ok: true, ai: !reason, reason: reason || undefined, model: MODEL }, { 'cache-control': 'no-store' });
    }
    if (url.pathname === '/api/claude' && req.method === 'POST') return await handleClaude(req, res);
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    serveStatic(req, res, url.pathname);
  } catch (e) {
    send(res, 500, { error: { message: e.message } });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Soulvee OS running on http://localhost:${PORT}`);
  console.log(API_KEY ? `AI on (model ${MODEL})${ACCESS_TOKEN ? ', token-protected' : ''}` : 'AI off: set ANTHROPIC_API_KEY to enable the agent, offer builder and lessons');
});
