// Quick server checks: the guardrails that protect your money, your accounts and your data. No browser
// needed. Servers under test: http://localhost:8790 (AI on, no access token, so only this computer may
// use it) and http://localhost:8786 (locked with the access token abc123, and an AI key the Claude
// stand-in rejects). Run it with: node test/run.js server
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAIN = 'http://localhost:8790';
const LOCKED = 'http://localhost:8786';
const CLAUDE = 'http://127.0.0.1:8799';
const HOOK = 'http://127.0.0.1:8796';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  — ' + extra : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A request from another device. Anything that came through a proxy or tunnel counts as one.
const REMOTE = { 'x-forwarded-for': '203.0.113.7' };
const call = async (base, method, route, { body, headers = {} } = {}) => {
  const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  const json = (() => { try { return JSON.parse(text); } catch { return null; } })();
  return { status: res.status, headers: res.headers, text, json };
};
const claudeCalls = async () => (await (await fetch(CLAUDE + '/__requests')).json()).length;
const hello = { messages: [{ role: 'user', content: 'Hello from the server checks' }] };
const children = [];
process.on('exit', () => children.forEach(c => c.kill()));

(async () => {
  /* --- The app itself --- */
  let r = await call(MAIN, 'GET', '/');
  check('The app page loads', r.status === 200 && /text\/html/.test(r.headers.get('content-type')) && r.text.includes('Soulvee'));
  check('Pages carry the nosniff safety header', r.headers.get('x-content-type-options') === 'nosniff');
  r = await call(MAIN, 'GET', '/crm');
  check('Any page address opens the app', r.status === 200 && r.text.includes('Soulvee'));
  r = await call(MAIN, 'GET', '/missing.js');
  check('A missing file is "not found"', r.status === 404);
  for (const probe of ['/..%2fserver.js', '/..%2f..%2fsoulvee-os%2fpackage.json', '/%2e%2e/package.json', '/data/accounts.json']) {
    r = await call(MAIN, 'GET', probe);
    check(`Files outside the app folder can't be read: ${probe}`, r.status !== 200 && !r.text.includes('loadEnv') && !r.text.includes('"dependencies"'), 'status ' + r.status);
  }

  /* --- AI: on, streamed from Claude, with the key kept on the server --- */
  r = await call(MAIN, 'GET', '/api/health');
  check('The health check says AI is on', r.json && r.json.ok === true && r.json.ai === true, r.text.slice(0, 120));
  check('The AI key is never sent to the browser', !r.text.includes('sk-ant-test-key') && !(await call(MAIN, 'GET', '/')).text.includes('sk-ant-test-key'));
  r = await call(MAIN, 'POST', '/api/claude', { body: hello });
  check('AI answers stream back as they are written', r.status === 200 && /text\/event-stream/.test(r.headers.get('content-type')) && r.text.includes('Mock reply to'), r.text.slice(0, 160));
  r = await call(MAIN, 'POST', '/api/claude', { body: { messages: [] } });
  check('A malformed AI request is refused with a reason', r.status === 400 && r.json && r.json.error.message === 'messages required');

  /* --- Without an access token, only this computer may spend credit or reach your accounts --- */
  const before = await claudeCalls();
  r = await call(MAIN, 'GET', '/api/health', { headers: REMOTE });
  check('Another device is told AI only works on this computer', r.json && r.json.ai === false && r.json.reason === 'local_only');
  r = await call(MAIN, 'POST', '/api/claude', { body: hello, headers: REMOTE });
  check('Another device cannot use AI', r.status === 401 && r.json && r.json.error.code === 'locked' && /computer running Soulvee OS/.test(r.json.error.message));
  r = await call(MAIN, 'POST', '/api/ai-test', { headers: REMOTE });
  check('Another device cannot run the AI test', r.status === 401);
  r = await call(MAIN, 'POST', '/api/images/generate', { body: { brief: 'A DJ booth at sunset' }, headers: REMOTE });
  check('Another device cannot make images', r.status === 401);
  r = await call(MAIN, 'POST', '/api/social/publish', { body: { target: 'webhook', post: { text: 'Hello' } }, headers: REMOTE });
  check('Another device cannot publish', r.status === 403);
  r = await call(MAIN, 'GET', '/api/accounts', { headers: REMOTE });
  check('Another device cannot see connected accounts', r.status === 403);
  r = await call(MAIN, 'GET', '/api/inbox', { headers: REMOTE });
  check('Another device cannot read the inbox', r.status === 403);
  r = await call(MAIN, 'GET', '/api/autopilot', { headers: REMOTE });
  check('Another device learns nothing about the autopilot', r.status === 200 && r.json && r.json.allowed === false && Object.keys(r.json).length === 1);
  r = await call(MAIN, 'GET', '/api/social/status', { headers: REMOTE });
  check('Publishing status tells another device it may not publish', r.json && r.json.allowed === false);
  check('None of those refused requests reached Claude', (await claudeCalls()) === before);

  /* --- With an access token, every device needs it --- */
  r = await call(LOCKED, 'GET', '/api/health');
  check('Without the token, the server says AI is locked', r.json && r.json.ai === false && r.json.reason === 'locked');
  r = await call(LOCKED, 'POST', '/api/claude', { body: hello });
  check('Without the token, AI is refused, with how to unlock it', r.status === 401 && r.json && /\?token=YOUR_TOKEN/.test(r.json.error.message));
  r = await call(LOCKED, 'GET', '/?token=wrong');
  check('A wrong token unlocks nothing', !r.headers.get('set-cookie'));
  r = await call(LOCKED, 'GET', '/?token=abc123');
  const cookie = r.headers.get('set-cookie') || '';
  check('Opening the app with ?token= remembers the device', /soulvee_token=abc123/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie), cookie);
  const remembered = { cookie: 'soulvee_token=abc123' };
  r = await call(LOCKED, 'GET', '/api/social/status', { headers: remembered });
  check('A remembered device may publish', r.json && r.json.allowed === true);
  r = await call(LOCKED, 'GET', '/api/social/status', { headers: { cookie: 'soulvee_token=nope' } });
  check('A wrong remembered token is refused', r.json && r.json.allowed === false);
  r = await call(LOCKED, 'GET', '/api/social/status', { headers: { ...REMOTE, 'x-soulvee-token': 'abc123' } });
  check('The token works through a proxy or tunnel too', r.json && r.json.allowed === true);
  r = await call(LOCKED, 'POST', '/api/ai-test', { headers: remembered });
  check('A rejected AI key is explained in plain English', r.json && r.json.ok === false && r.json.code === 'auth' && /rejected the API key/.test(r.json.message), r.text.slice(0, 160));

  /* --- Meta webhooks: only correctly signed calls get in --- */
  const sign = text => 'sha256=' + crypto.createHmac('sha256', 'metasecret').update(text).digest('hex');
  const delivery = JSON.stringify({ object: 'page', entry: [] });
  r = await call(MAIN, 'POST', '/webhooks/meta', { body: delivery });
  check('An unsigned webhook call is refused', r.status === 401);
  r = await call(MAIN, 'POST', '/webhooks/meta', { body: delivery, headers: { 'x-hub-signature-256': sign(delivery + ' ') } });
  check('A webhook call signed for different content is refused', r.status === 401);
  r = await call(MAIN, 'POST', '/webhooks/meta', { body: delivery, headers: { 'x-hub-signature-256': sign(delivery) } });
  check('A correctly signed webhook call is accepted', r.status === 200);

  /* --- Posts sent to your Make, Zapier or n8n webhook are signed --- */
  r = await call(MAIN, 'POST', '/api/social/publish', { body: { target: 'webhook', post: { title: 'Server check', text: 'Testing the signed webhook', platforms: ['instagram'] } } });
  check('A post can be sent to the webhook', r.status === 200, r.text.slice(0, 160));
  // The scheduler sends it within a second or two of the request.
  let hooks = [];
  for (let i = 0; i < 50 && !hooks.length; i++) { await sleep(200); hooks = await (await fetch(HOOK + '/__log')).json(); }
  check('Every webhook call carries a valid signature', hooks.length > 0 && hooks.every(h => h.signatureValid), JSON.stringify(hooks.map(h => h.signatureValid)));

  /* --- The settings file --- */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soulvee-settings-'));
  const file = path.join(dir, 'settings.env');
  fs.writeFileSync(file, 'PORT=8791\nANTHROPIC_API_KEY=sk-ant-from-the-file\nANTHROPIC_BASE_URL=http://127.0.0.1:8799\n');
  children.push(spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], { env: { ...process.env, SOULVEE_ENV_FILE: file, SOULVEE_DATA_DIR: path.join(dir, 'data') }, stdio: 'ignore' }));
  let health = null;
  for (let i = 0; i < 100 && !health; i++) {
    await sleep(100);
    health = await fetch('http://localhost:8791/api/health').then(x => x.json(), () => null);
  }
  check('SOULVEE_ENV_FILE chooses the settings file the server reads', health && health.ai === true, JSON.stringify(health));
  children.forEach(c => c.kill());
  await sleep(300);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

  const failed = results.filter(x => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
