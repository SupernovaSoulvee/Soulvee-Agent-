// Stand-ins for OpenAI's image API and Cloudinary's upload API (port 8794).
//   POST /v1/images/generations            (Authorization: Bearer sk-openai-test) -> base64 JPEG
//   POST /v1_1/democloud/image/upload       signed with cloudkey / cloudsecret     -> secure_url on this mock
//   GET  /img/<public_id>.jpg               the uploaded bytes
//   GET  /__log                             requests received
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const jpg = fs.readFileSync(process.argv[2]);
const log = [];
const stored = {};
const read = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__log') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(log)); return; }
  if (url.pathname.startsWith('/img/')) { const id = decodeURIComponent(url.pathname.slice(5).replace(/\.jpg$/, '')); if (!stored[id]) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(stored[id]); return; }
  const raw = await read(req);
  if (url.pathname === '/v1/images/generations') {
    const body = JSON.parse(raw || '{}');
    log.push({ kind: 'openai', auth: req.headers.authorization, model: body.model, size: body.size, quality: body.quality, format: body.output_format, prompt: body.prompt });
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer sk-openai-test') { res.writeHead(401); res.end(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } })); return; }
    if (/BLOCKME/.test(body.prompt)) { res.writeHead(400); res.end(JSON.stringify({ error: { message: 'Your request was rejected by the safety system.', code: 'moderation_blocked' } })); return; }
    res.end(JSON.stringify({ created: Math.floor(Date.now() / 1000), data: [{ b64_json: jpg.toString('base64') }] }));
    return;
  }
  const m = url.pathname.match(/^\/v1_1\/([\w-]+)\/image\/upload$/);
  if (m) {
    const form = new URLSearchParams(raw);
    const params = {}; for (const [k, v] of form) params[k] = v;
    const signed = Object.keys(params).filter(k => !['file', 'api_key', 'signature', 'resource_type', 'cloud_name'].includes(k)).sort().map(k => `${k}=${params[k]}`).join('&');
    const valid = params.api_key === 'cloudkey' && params.signature === crypto.createHash('sha1').update(signed + 'cloudsecret').digest('hex');
    log.push({ kind: 'cloudinary', cloud: m[1], valid, folder: params.folder, public_id: params.public_id, fileStart: String(params.file || '').slice(0, 23) });
    res.setHeader('content-type', 'application/json');
    if (!valid) { res.writeHead(401); res.end(JSON.stringify({ error: { message: 'Invalid Signature' } })); return; }
    const id = `${params.folder}/${params.public_id}`;
    stored[id] = Buffer.from(String(params.file).replace(/^data:image\/\w+;base64,/, ''), 'base64');
    res.end(JSON.stringify({ public_id: id, secure_url: `http://127.0.0.1:8794/img/${encodeURIComponent(id)}.jpg`, width: 96, height: 96, format: 'jpg' }));
    return;
  }
  res.writeHead(404); res.end('{}');
}).listen(8794, '127.0.0.1', () => console.log('mock media on 8794'));
