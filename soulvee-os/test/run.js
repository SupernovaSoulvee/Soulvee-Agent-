#!/usr/bin/env node
// Runs Soulvee OS's automatic checks.
//   npm test               the server checks: no browser needed
//   npm run test:browser   every check, including the ones that click through the app in a real browser
//   node test/run.js crm   only the suites you name (see SUITES below)
//
// Each suite gets fresh stand-ins (pretend Claude, Buffer, OpenAI, Cloudinary, Facebook and the other
// platforms, in test/stand-ins) and a fresh Soulvee OS server with an empty data folder. The servers
// never read your .env and only talk to the stand-ins, so the tests can't spend your money or touch
// your real accounts and data. Each suite's list of checks, screenshots and server logs is saved in
// test/output/<suite>.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const APP = path.join(__dirname, '..');
const OUTPUT = path.join(__dirname, 'output');
const STAND_INS = path.join(__dirname, 'stand-ins');
const SAMPLE = path.join(STAND_INS, 'sample.jpg');
const LIMIT = 8 * 60 * 1000; // a suite still running after 8 minutes is stopped

// The ports the tests use. They stay clear of 8787, Soulvee OS's usual port, so the tests can run while
// your own copy is open. The suites and stand-ins use the same numbers: change them there too.
// (8791 is used by the server suite to check the settings-file switch.)
const PORT = { main: 8790, plain: 8785, locked: 8786, settings: 8791, claude: 8799, buffer: 8797, hook: 8796, media: 8794, platforms: 8792 };
const local = port => `http://127.0.0.1:${port}`;
const M = local(PORT.platforms);

// Each stand-in: its file, what it's given, and the ports it answers on.
const STAND_IN_LIST = [
  ['claude.js', [String(PORT.claude)], [PORT.claude]],
  ['social.js', [], [PORT.buffer, PORT.hook]],
  ['media.js', [SAMPLE], [PORT.media]],
  ['platforms.js', [String(PORT.platforms), SAMPLE], [PORT.platforms]],
];

// The servers under test. Every key is made up, and every address points at a stand-in.
const SERVERS = {
  main: {
    port: PORT.main,
    env: {
      ANTHROPIC_BASE_URL: local(PORT.claude), ANTHROPIC_API_KEY: 'sk-ant-test-key',
      BUFFER_API_KEY: 'buf_test_key', BUFFER_API_URL: local(PORT.buffer) + '/',
      SOCIAL_WEBHOOK_URL: local(PORT.hook) + '/hook', SOCIAL_WEBHOOK_SECRET: 's3cret',
      OPENAI_API_KEY: 'sk-openai-test', SOULVEE_IMAGE_API_URL: local(PORT.media) + '/v1',
      CLOUDINARY_URL: 'cloudinary://cloudkey:cloudsecret@democloud', CLOUDINARY_API_URL: local(PORT.media),
      TELEGRAM_API_URL: `${M}/telegram`,
      META_GRAPH_URL: `${M}/graph`, META_DIALOG_URL: `${M}/facebook`, META_APP_ID: 'metaapp', META_APP_SECRET: 'metasecret',
      THREADS_API_URL: `${M}/threads`, THREADS_AUTH_URL: `${M}/threads/oauth/authorize`, THREADS_APP_ID: 'thapp', THREADS_APP_SECRET: 'thsecret',
      X_API_URL: `${M}/x`, X_AUTH_URL: `${M}/x/i/oauth2/authorize`, X_CLIENT_ID: 'xclient', X_CLIENT_SECRET: 'xsecret',
      LINKEDIN_API_URL: `${M}/linkedin`, LINKEDIN_AUTH_URL: `${M}/linkedin/oauth/v2`, LINKEDIN_CLIENT_ID: 'liclient', LINKEDIN_CLIENT_SECRET: 'lisecret',
      LINKEDIN_SCOPES: 'openid,profile,w_member_social,w_organization_social,rw_organization_admin',
      GOOGLE_API_URL: `${M}/google`, GOOGLE_AUTH_URL: `${M}/google/auth`, GOOGLE_TOKEN_URL: `${M}/google/token`, GOOGLE_CLIENT_ID: 'gclient', GOOGLE_CLIENT_SECRET: 'gsecret',
      REDDIT_API_URL: `${M}/reddit`, REDDIT_AUTH_URL: `${M}/reddit-auth`,
      // Faster timers, so scheduled posts, inbox checks and media processing happen within seconds.
      SOULVEE_SCHEDULER_MS: '1000', SOULVEE_INBOX_MS: '1000', SOULVEE_SLOW_POLL_MS: '1000', SOULVEE_MEDIA_POLL_MS: '50',
    },
  },
  // No AI key: the app still works, and explains why AI is off.
  plain: { port: PORT.plain, env: {} },
  // AI locked with an access token, and a key the Claude stand-in rejects.
  locked: { port: PORT.locked, env: { ANTHROPIC_BASE_URL: local(PORT.claude), ANTHROPIC_API_KEY: 'sk-ant-rejected-key', SOULVEE_ACCESS_TOKEN: 'abc123' } },
};

// The suites, quickest first. Browser suites need Playwright.
const SUITES = [
  { name: 'server', browser: false, servers: ['main', 'locked'], about: 'the guardrails: device lock, access token, signed webhooks, private files' },
  { name: 'accounts-api', browser: false, servers: ['main'], about: 'connected accounts, publishing to them, the inbox and webhooks' },
  { name: 'growth', browser: true, servers: ['main'], about: 'autopilot, images from briefs and learning from Buffer results' },
  { name: 'ai-social', browser: true, servers: ['main'], about: 'AI features, Content Studio and publishing' },
  { name: 'crm', browser: true, servers: ['main'], about: 'contacts, follow-ups, timeline and CSV import and export' },
  { name: 'accounts-ui', browser: true, servers: ['main'], about: 'the Accounts and Inbox tabs, on desktop and phone' },
  { name: 'full', browser: true, servers: ['plain', 'locked'], about: 'deals, invoices and payments, Setup, backup and restore, the AI lock and offline use' },
];

// Only what programs need to start is passed on. Keys in your terminal's settings never reach the tests.
const KEEP = new Set(['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA', 'XDG_CACHE_HOME', 'PLAYWRIGHT_BROWSERS_PATH', 'NODE_PATH', 'LANG', 'TZ']);
const BASE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => KEEP.has(k.toUpperCase())));

const NO_PLAYWRIGHT = `The browser checks need Playwright, a tool that drives a real browser. Install it once:
  npm install
  npx playwright install chromium      (downloads a test browser, about 150 MB)
Then run npm run test:browser again. npm test runs the server checks without it.`;

const running = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const seconds = ms => Math.round(ms / 1000) + 's';

// Whether something answers on a port.
const answers = port => new Promise(resolve => {
  const socket = net.connect(port, '127.0.0.1');
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

async function waitFor(port, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await answers(port)) return true;
  return false;
}

// Starts a Node program in the background, writing what it prints to a log file.
function start(file, args, env, logFile) {
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [file, ...args], { cwd: APP, env, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  running.add(child);
  child.once('exit', () => running.delete(child));
  return child;
}

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => { clearTimeout(force); resolve(); });
    child.kill();
  });
}

// Runs one suite file, printing a dot for each check that passes and an F for each that fails.
function runFile(file, args, env, logFile) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [file, ...args], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
    running.add(child);
    const log = fs.createWriteStream(logFile);
    let text = '';
    let partial = '';
    const take = chunk => {
      text += chunk;
      log.write(chunk);
      const lines = (partial + chunk).split('\n');
      partial = lines.pop();
      for (const line of lines) {
        if (line.startsWith('PASS ')) process.stdout.write('.');
        if (line.startsWith('FAIL ')) process.stdout.write('F');
      }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => { text += `\nStopped: still running after ${LIMIT / 60000} minutes.\n`; child.kill('SIGKILL'); }, LIMIT);
    child.on('close', code => {
      clearTimeout(timer);
      running.delete(child);
      log.end();
      resolve({ code, text });
    });
  });
}

async function runSuite(suite) {
  const out = path.join(OUTPUT, suite.name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'soulvee-test-'));
  const kids = [];
  const ports = [];
  for (const [file, args, listens] of STAND_IN_LIST) {
    kids.push(start(path.join(STAND_INS, file), args, BASE_ENV, path.join(out, 'stand-ins.log')));
    ports.push(...listens);
  }
  for (const name of suite.servers) {
    const server = SERVERS[name];
    const env = { ...BASE_ENV, ...server.env, PORT: String(server.port), SOULVEE_DATA_DIR: path.join(data, name), SOULVEE_ENV_FILE: 'none' };
    kids.push(start(path.join(APP, 'server.js'), [], env, path.join(out, `server-${name}.log`)));
    ports.push(server.port);
  }
  const started = Date.now();
  let result = { code: null, text: '' };
  const missing = [];
  for (const port of ports) if (!(await waitFor(port))) missing.push(port);
  if (missing.length) result.text = `Nothing started on port ${missing.join(', ')}. The logs in ${path.relative(APP, out)} say why.\n`;
  if (!missing.length) result = await runFile(path.join(__dirname, 'suites', suite.name + '.js'), [out], { ...BASE_ENV, SOULVEE_TEST_DATA: path.join(data, 'main') }, path.join(out, 'checks.txt'));
  await Promise.all(kids.map(stop));
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const lines = result.text.split('\n');
  const tally = lines.map(l => l.match(/^(\d+)\/(\d+) passed$/)).filter(Boolean).pop();
  return {
    suite,
    took: Date.now() - started,
    passed: tally ? Number(tally[1]) : 0,
    total: tally ? Number(tally[2]) : 0,
    ok: result.code === 0 && !!tally,
    failures: lines.filter(l => l.startsWith('FAIL ')),
    // The end of the output when a suite stopped before finishing, which is where the error is.
    crash: tally ? '' : lines.filter(Boolean).slice(-8).join('\n'),
    noBrowser: /Executable doesn't exist|npx playwright install/.test(result.text),
    out,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const named = args.filter(a => !a.startsWith('-'));
  const unknown = named.filter(n => !SUITES.some(s => s.name === n));
  if (unknown.length) {
    console.log(`There's no suite called ${unknown.join(', ')}. The suites are: ${SUITES.map(s => s.name).join(', ')}.`);
    process.exit(1);
  }
  const everything = args.includes('--browser');
  const chosen = named.length ? SUITES.filter(s => named.includes(s.name)) : SUITES.filter(s => everything || !s.browser);
  if (chosen.some(s => s.browser)) {
    const found = (() => { try { return require.resolve('playwright', { paths: [APP] }); } catch { return ''; } })();
    if (!found) {
      console.log(NO_PLAYWRIGHT);
      process.exit(1);
    }
  }
  const busy = [];
  for (const port of Object.values(PORT)) if (await answers(port)) busy.push(port);
  if (busy.length) {
    console.log(`Something on this computer is already using port ${busy.join(', ')}, which the tests need.`);
    console.log('Close it (for example another test run, or a copy of Soulvee OS started on that port) and try again.');
    process.exit(1);
  }

  console.log(`Running ${chosen.length} suite${chosen.length > 1 ? 's' : ''}. Each starts its own server and stand-ins, so nothing real is touched.\n`);
  const results = [];
  for (const suite of chosen) {
    process.stdout.write(`${suite.name} (${suite.about}) `);
    const r = await runSuite(suite);
    results.push(r);
    console.log(r.ok ? ` ${r.passed} of ${r.total} passed in ${seconds(r.took)}` : r.total ? ` ${r.total - r.passed} of ${r.total} failed` : ' stopped before finishing');
    r.failures.slice(0, 10).forEach(f => console.log('  ' + f));
    if (r.crash && !r.noBrowser) console.log(r.crash.split('\n').map(l => '  | ' + l).join('\n'));
    if (r.noBrowser) console.log("  The test browser isn't downloaded yet. Run once: npx playwright install chromium");
    if (!r.ok) console.log(`  Details, screenshots and server logs: ${path.relative(APP, r.out)}`);
  }

  const total = results.reduce((a, r) => a + r.total, 0);
  const failed = results.filter(r => !r.ok);
  console.log('');
  if (!failed.length) console.log(`All ${total} checks passed.`);
  if (failed.length) console.log(`${failed.length} of ${results.length} suites had problems: ${failed.map(r => r.suite.name).join(', ')}.`);
  console.log('Every check is listed in plain English in test/output/<suite>/checks.txt.');
  if (!everything && !named.length) console.log('The browser checks were skipped. Run npm run test:browser to include them.');
  process.exit(failed.length ? 1 : 0);
}

// Ctrl+C stops every server and stand-in this run started.
process.on('SIGINT', async () => {
  await Promise.all([...running].map(stop));
  process.exit(130);
});

main();
