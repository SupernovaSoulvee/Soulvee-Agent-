// End-to-end test of Soulvee OS AI + social publishing, using local stand-ins for
// Claude (stand-ins/claude.js on 8799), Buffer (8797) and a Make/Zapier webhook (8796).
// Server under test: http://localhost:8790. Run it with: node test/run.js ai-social
const { chromium } = require('playwright');
const OUT = process.argv[2];
const BASE = 'http://localhost:8790';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  — ' + extra : '')); };
const json = async url => (await fetch(url)).json();
const script = items => fetch('http://127.0.0.1:8799/__script', { method: 'POST', body: JSON.stringify(items) });
const claudeLog = () => json('http://127.0.0.1:8799/__requests');
const bufferLog = () => json('http://127.0.0.1:8797/__log');
const hookLog = () => json('http://127.0.0.1:8796/__log');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const statusOf = title => shared.page.evaluate(t => (Object.values(JSON.parse(localStorage.getItem('soulvee-os:v1')).collections.content || {}).find(p => p.title === t) || {}).status, title);
const until = async (fn, ms = 5000) => { for (let t = 0; t < ms; t += 100) { if (await fn()) return true; await sleep(100); } return false; };
const shared = {};
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const F = (scope, text) => {
  const pg = typeof scope.page === 'function' ? scope.page() : scope;
  return scope.locator('label').filter({ has: pg.locator('span', { hasText: new RegExp('^' + esc(text) + '$') }) }).locator('input, select, textarea').first();
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  shared.page = page;
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  const dialog = page.locator('div[role=dialog]');
  const tab = name => page.locator('nav button', { hasText: name }).click();
  const card = title => page.locator('div.rounded-2xl', { has: page.locator('p.font-semibold', { hasText: title }) }).last();
  const main = () => page.locator('main').innerText();
  const box = page.locator('form textarea');
  // Wait until the previous answer has finished (Send replaces Stop) before asking again.
  const ask = async text => { await page.locator('form button', { hasText: /^Send$/ }).waitFor(); await box.fill(text); await page.keyboard.press('Enter'); };
  const lastBubble = page.locator('div.whitespace-pre-wrap.rounded-2xl').last();

  await page.goto(BASE + '/#assistant', { waitUntil: 'load' });
  await box.waitFor();

  /* --- 1. Streaming chat with a system prompt --- */
  const long = 'Here is your H2 picture. Collected so far is nothing yet, so chase the open proposals first and send two follow-ups today.';
  await script([{ blocks: [{ type: 'text', text: long }], stop_reason: 'end_turn', delayMs: 60 }]);
  await box.click();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second line');
  check('Shift+Enter adds a new line in the chat box', await box.inputValue() === 'Hello\nsecond line');
  await page.keyboard.press('Enter');
  const seen = new Set();
  for (let i = 0; i < 80; i++) { const t = await lastBubble.innerText().catch(() => ''); seen.add(t.length); if (t.includes('follow-ups today')) break; await sleep(40); }
  const lengths = [...seen].filter(n => n > 15 && n < long.length);
  check('Answer streams in as it is written', lengths.length >= 2, 'partial lengths seen: ' + lengths.slice(0, 6).join(','));
  await page.waitForSelector('text=send two follow-ups today.');
  let log = await claudeLog();
  let req = log[log.length - 1].body;
  check('Chat sends the instructions as a system prompt', /operations sub-agent/.test(req.system || '') && req.messages[0].content === 'Hello\nsecond line', JSON.stringify(req.messages[0]).slice(0, 80));
  check('Chat uses Claude Opus 5.5 with medium effort, streaming, caching and refusal fallbacks', req.model === 'claude-opus-5-5' && req.output_config.effort === 'medium' && req.stream === true && req.cache_control && req.fallbacks === 'default' && log[log.length - 1].headers['anthropic-beta'].includes('server-side-fallback-2026-07-01'));
  check('Agent tools include the content tools, with eager input streaming', ['list_content', 'create_content_drafts'].every(n => req.tools.some(t => t.name === n && t.eager_input_streaming === true)));

  /* --- 2. Two invoices in one agent turn --- */
  await script([
    { blocks: [{ type: 'thinking' }, { type: 'tool_use', name: 'create_draft_invoice', input: { client: 'Alpha', brand: 'smc', items: [{ desc: 'Setup', amount: 100000 }] } }, { type: 'tool_use', name: 'create_draft_invoice', input: { client: 'Beta', brand: 'smc', items: [{ desc: 'Setup', amount: 200000 }] } }], stop_reason: 'tool_use' },
    { blocks: [{ type: 'text', text: 'Drafted both invoices.' }], stop_reason: 'end_turn' },
  ]);
  await ask('Draft invoices for Alpha and Beta');
  await page.waitForSelector('text=Drafted both invoices.');
  log = await claudeLog();
  const second = log[log.length - 1].body.messages;
  check('Tool results go back with the thinking block intact', second[second.length - 2].role === 'assistant' && second[second.length - 2].content[0].type === 'thinking' && second[second.length - 1].content.every(b => b.type === 'tool_result' && !b.is_error));

  /* --- 3. A garbled streamed tool call is retried automatically --- */
  await script([
    { blocks: [{ type: 'tool_use', name: 'create_deal', raw: '}}{{garbled' }], stop_reason: 'tool_use' },
    { blocks: [{ type: 'tool_use', name: 'create_deal', input: { client: 'Retry Hotel', brand: 'dj', value: 500000 } }], stop_reason: 'tool_use' },
    { blocks: [{ type: 'text', text: 'Deal added after a retry.' }], stop_reason: 'end_turn' },
  ]);
  await ask('Add Retry Hotel as a DJ deal');
  await page.waitForSelector('text=Deal added after a retry.');
  log = await claudeLog();
  check('Garbled tool call: the same turn is asked again', JSON.stringify(log[log.length - 3].body.messages) === JSON.stringify(log[log.length - 2].body.messages));

  /* --- 4. Invalid tool input is sent back instead of run --- */
  await script([
    { blocks: [{ type: 'tool_use', name: 'create_deal', input: { client: 'No Brand Ltd' } }], stop_reason: 'tool_use' },
    { blocks: [{ type: 'text', text: 'I need the brand first.' }], stop_reason: 'end_turn' },
  ]);
  await ask('Add No Brand Ltd');
  await page.waitForSelector('text=I need the brand first.');
  log = await claudeLog();
  const res4 = log[log.length - 1].body.messages.slice(-1)[0].content[0];
  check('Tool input missing a required field is returned as an error, not run', res4.is_error === true && res4.content.includes('INVALID_JSON') && res4.content.includes('brand is required'));

  /* --- 5. Refusal --- */
  await script([{ blocks: [{ type: 'text', text: 'Partial answer that must not be shown' }], stop_reason: 'refusal' }]);
  await ask('Something the classifier declines');
  await page.waitForSelector('text=Claude declined this request');
  check('A refusal shows a clear message and hides the partial answer', !(await main()).includes('must not be shown'));

  /* --- 6. Errors from Claude are explained --- */
  await script([{ status: 401, error: { type: 'authentication_error', message: 'invalid x-api-key' } }]);
  await ask('ping');
  await page.waitForSelector('text=Claude rejected the API key');
  check('A bad API key is explained in the chat', true);

  /* --- 7. The agent drafts posts into Content --- */
  await script([
    { blocks: [{ type: 'tool_use', name: 'create_content_drafts', input: { posts: [{ brand: 'dj', title: 'Friday vibes', caption: 'Friday vibes at the club!', hashtags: ['afrobeats', 'lagosnightlife'], platforms: ['instagram'], day: 1, time: '19:00' }] } }], stop_reason: 'tool_use' },
    { blocks: [{ type: 'text', text: 'Added one draft to Content.' }], stop_reason: 'end_turn' },
  ]);
  await ask('Draft a Friday post for DJ Soulvee');
  await page.waitForSelector('text=Added one draft to Content.');
  check('Agent action is listed', (await main()).includes('Added 1 post draft to Content'));

  /* --- 8. Skill converter with structured output, then Promote --- */
  await tab('Skills');
  await F(page, 'Skill').fill('MCP servers');
  await script([{ blocks: [{ type: 'text', text: JSON.stringify({ name: 'MCP Build', pitch: 'We connect your tools to Claude.', model: 'project', tiers: [{ name: 'Starter', price: 250000, deliverables: ['1 server'] }], channels: ['LinkedIn'], firstMove: 'DM 5 restaurants' }) }], stop_reason: 'end_turn' }]);
  await page.getByRole('button', { name: 'Convert to offer' }).click();
  await page.waitForSelector('text=Save to catalogue');
  await page.getByRole('button', { name: 'Save to catalogue' }).click();
  log = await claudeLog();
  req = log[log.length - 1].body;
  check('Skill converter asks for JSON with a schema (structured outputs)', req.output_config.format && req.output_config.format.type === 'json_schema' && req.output_config.format.schema.required.includes('tiers'));
  await page.getByRole('button', { name: 'Promote' }).click();
  await page.waitForSelector('text=AI content generator');
  check('Promote opens Content with the offer filled in', await F(page, 'Goal or topic').inputValue() === 'Promote MCP Build' && (await F(page, 'Promote an offer (optional)').inputValue()) !== '');

  /* --- 9. Content generator --- */
  await F(page, 'Brand').selectOption('dj');
  await F(page, 'Goal or topic').fill('Fill December wedding bookings');
  const posts = { posts: [
    { title: 'Wedding teaser', caption: 'Your wedding deserves a dance floor that never empties.', hashtags: ['lagosweddings', '#afrobeats'], platforms: ['instagram'], format: 'image', visual: 'DJ booth with gold lights', script: '', day: 2, time: '19:30' },
    { title: 'Quick X post', caption: 'December dates are filling up. Book DJ Soulvee now.', hashtags: ['lagos'], platforms: ['x'], format: 'text', visual: '', script: '', day: 3, time: '12:00' },
    { title: 'Reel: crowd moment', caption: 'POV: the bride hears her song.', hashtags: ['weddingdj'], platforms: ['tiktok', 'instagram'], format: 'reel', visual: 'Crowd shot', script: '0-2s hook, 2-6s crowd, 6-10s CTA', day: 4, time: '20:00' },
  ] };
  await script([{ blocks: [{ type: 'text', text: JSON.stringify(posts) }], stop_reason: 'end_turn' }]);
  await page.getByRole('button', { name: 'Generate posts' }).click();
  await page.waitForSelector('text=3 drafts added');
  log = await claudeLog();
  req = log[log.length - 1].body;
  check('Generator uses structured outputs with the post schema', req.output_config.format.type === 'json_schema' && req.output_config.format.schema.properties.posts.items.required.includes('caption') && /Promote this offer: MCP Build|Fill December/.test(req.messages[0].content));
  const planText = await main();
  check('Generated drafts appear in the content plan with dates', ['Wedding teaser', 'Quick X post', 'Reel: crowd moment', 'Friday vibes'].every(t => planText.includes(t)) && planText.includes('#lagosweddings #afrobeats'));
  await page.screenshot({ path: OUT + '/content-plan.png' });

  /* --- 10. Edit a post: media, counters, polish with AI --- */
  await card('Wedding teaser').getByRole('button', { name: 'Edit' }).click();
  await dialog.getByRole('button', { name: '+ Add media' }).click();
  await dialog.locator('input[placeholder^="https://res.cloudinary.com"]').fill('https://res.cloudinary.com/demo/image/upload/sample.jpg');
  check('Caption counter shows the Instagram limit', (await dialog.innerText()).includes('/2200'));
  await script([{ blocks: [{ type: 'text', text: 'Your wedding. Your song. A dance floor that never empties. Book now. #lagosweddings' }], stop_reason: 'end_turn' }]);
  await dialog.getByRole('button', { name: 'Polish with AI' }).click();
  await page.waitForFunction(() => document.querySelector('div[role=dialog] textarea').value.startsWith('Your wedding. Your song.'));
  log = await claudeLog();
  check('Polish uses low effort', log[log.length - 1].body.output_config.effort === 'low');
  await dialog.getByRole('button', { name: 'Save post' }).click();

  /* --- 11. Approve and schedule through Buffer --- */
  await card('Wedding teaser').getByRole('button', { name: 'Approve' }).click();
  await card('Wedding teaser').getByRole('button', { name: 'Publish…' }).click();
  const dlgText = await dialog.innerText();
  check('Publish dialog lists the accounts on the post\'s platforms, Buffer channels included', dlgText.includes('DJ Soulvee IG') && dlgText.includes('via Buffer') && !dlgText.includes('DJ Soulvee X') && dlgText.includes('other account'));
  await dialog.getByRole('button', { name: 'Schedule for 1 account' }).click();
  await page.waitForSelector('text=Scheduled for 1 account');
  check('Post is marked scheduled in Buffer', (await card('Wedding teaser').innerText()).includes('DJ Soulvee IG · Instagram: scheduled in Buffer for'));
  const blog = await bufferLog();
  const created = blog.filter(r => String(r.query).includes('SoulveeCreatePost'));
  const inp = created[created.length - 1].variables.input;
  check('Buffer gets a correct createPost (auth, schedule, image, Instagram metadata, AI flag)', created[created.length - 1].auth === 'Bearer buf_test_key' && inp.mode === 'customScheduled' && !!inp.dueAt && inp.assets[0].image.url.includes('cloudinary') && inp.metadata.instagram.type === 'post' && inp.metadata.instagram.shouldShareToFeed === true && inp.aiAssisted === true && inp.schedulingType === 'automatic', JSON.stringify(inp).slice(0, 200));
  check('Chosen channels are remembered for the brand', await page.evaluate(() => JSON.parse(localStorage.getItem('soulvee-os:v1')).docs['settings/main'].social.brandChannels.dj.includes('ch_ig')));

  /* --- 12. Instagram without media is stopped before Buffer --- */
  await card('Friday vibes').getByRole('button', { name: 'Approve' }).click();
  await card('Friday vibes').getByRole('button', { name: 'Publish…' }).click();
  const before = (await bufferLog()).length;
  await dialog.getByRole('button', { name: /Schedule for 1 account|Post now to 1 account/ }).click();
  await dialog.locator('p', { hasText: '✕ DJ Soulvee IG' }).waitFor();
  check('Instagram post without media is refused with a clear reason, without calling Buffer', (await bufferLog()).length === before);
  await page.keyboard.press('Escape');
  check('Failed post is marked failed', await until(async () => (await card('Friday vibes').innerText()).toLowerCase().includes('failed')));

  /* --- 13. Partial failure across channels --- */
  await page.getByRole('button', { name: '+ Post' }).click();
  await F(dialog, 'Brand').selectOption('smc');
  await F(dialog, 'Title (for you, not posted)').fill('SMC tip');
  await dialog.getByRole('button', { name: 'Instagram' }).click();
  await dialog.getByRole('button', { name: 'TikTok' }).click();
  await dialog.getByRole('button', { name: 'LinkedIn' }).click();
  await dialog.getByRole('button', { name: 'X', exact: true }).click();
  await F(dialog, 'Caption').fill('Lagos hotels: automate your bookings and save 10 hours a week. DM us.');
  await dialog.getByRole('button', { name: 'Save post' }).click();
  await card('SMC tip').getByRole('button', { name: 'Approve' }).click();
  await card('SMC tip').getByRole('button', { name: 'Publish…' }).click();
  await dialog.getByRole('button', { name: 'Post now to 2 accounts' }).click();
  await page.waitForSelector('text=Queue limit reached');
  const partial = await dialog.innerText();
  check('Per-channel results: one sent, one refused with Buffer\'s reason', partial.includes('✓ DJ Soulvee X') && partial.includes('✕ SMC LinkedIn') && partial.includes('Queue limit reached'));
  await page.keyboard.press('Escape');
  check('A partly sent post needs attention and shows each account', await until(async () => { const t = await card('SMC tip').innerText(); return t.toLowerCase().includes('failed') && t.includes('✓ DJ Soulvee X') && t.includes('✕ SMC LinkedIn') && t.includes('Queue limit reached'); }));
  await card('SMC tip').getByRole('button', { name: 'Try again' }).click();
  check('Trying again ticks only the account that failed', await dialog.getByLabel('SMC LinkedIn on LinkedIn').isChecked() && !(await dialog.getByLabel('DJ Soulvee X on X').isChecked()));
  await page.keyboard.press('Escape');

  /* --- 14. Webhook: send now, delivered and signed --- */
  await card('Quick X post').getByRole('button', { name: 'Approve' }).click();
  await card('Quick X post').getByRole('button', { name: 'Publish…' }).click();
  await dialog.getByRole('button', { name: 'Webhook', exact: true }).click();
  await dialog.locator('input[type=radio]').last().check();
  await dialog.getByRole('button', { name: 'Send to webhook now' }).click();
  await page.waitForSelector('text=Sent to your webhook');
  let delivered = false;
  for (let i = 0; i < 40 && !delivered; i++) { await sleep(500); delivered = (await statusOf('Quick X post')) === 'posted'; }
  const hooks = await hookLog();
  const hit = hooks.find(h => h.event === 'post.publish' && h.body.post.title === 'Quick X post');
  check('Webhook receives the post with a valid signature', !!hit && hit.signatureValid && hit.body.post.platforms[0] === 'x' && hit.body.post.text.includes('Book DJ Soulvee'));
  check('Post turns "posted" once the webhook accepted it', delivered);

  /* --- 15. Webhook: schedule for later, then cancel --- */
  await card('Reel: crowd moment').getByRole('button', { name: 'Approve' }).click();
  await card('Reel: crowd moment').getByRole('button', { name: 'Publish…' }).click();
  await dialog.getByRole('button', { name: 'Webhook', exact: true }).click();
  await dialog.getByRole('button', { name: 'Queue for webhook' }).click();
  await page.waitForSelector('text=Queued — Soulvee OS sends it at the scheduled time');
  check('Scheduled webhook post shows when it will send', (await card('Reel: crowd moment').innerText()).includes('Webhook · sends'));
  await card('Reel: crowd moment').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForSelector('text=Scheduled post cancelled');
  check('Cancelling puts the post back to approved', (await card('Reel: crowd moment').innerText()).toLowerCase().includes('approved'));

  /* --- 16. Post by hand --- */
  await card('Reel: crowd moment').getByRole('button', { name: 'Publish…' }).click();
  await dialog.getByRole('button', { name: 'Post by hand' }).click();
  const tiktokLink = await dialog.locator('a', { hasText: 'Open TikTok' }).getAttribute('href');
  check('Post by hand offers platform links', tiktokLink === 'https://www.tiktok.com/upload');
  await dialog.getByRole('button', { name: "I've posted it" }).click();
  await page.locator('main button', { hasText: /^Posted$/ }).click();
  check('Posted filter shows it', (await main()).includes('Reel: crowd moment'));
  await card('Reel: crowd moment').getByRole('button', { name: 'Reuse' }).click();
  await page.locator('main button', { hasText: /^To do$/ }).click();
  check('Reuse makes a fresh draft', (await main()).includes('Reel: crowd moment (again)'));

  /* --- 17. Invoice PDF --- */
  await tab('Money');
  const invCard = page.locator('div.rounded-2xl', { has: page.locator('p', { hasText: /^INV-SMC-ALPHA-002$/ }) }).last();
  const [popup] = await Promise.all([page.waitForEvent('popup'), invCard.getByRole('button', { name: 'PDF' }).click()]);
  await popup.waitForLoadState();
  const pdfText = await popup.locator('body').innerText();
  check('Invoice PDF view has the number, client and total', pdfText.includes('INV-SMC-ALPHA-002') && pdfText.includes('Alpha') && pdfText.includes('₦100,000'));
  await popup.screenshot({ path: OUT + '/invoice-pdf.png' });
  await popup.close();

  /* --- 18. Setup: AI test, Buffer channels, webhook test --- */
  await tab('Setup');
  await page.getByRole('button', { name: 'Test AI' }).click();
  await page.waitForSelector('text=Working — claude-opus-5-5 replied');
  check('Test AI confirms the connection', true);
  await page.waitForSelector('text=Default Buffer channels for each brand');
  const setupText = await main();
  check('Setup shows Buffer connected, webhook signed, and every channel', setupText.includes('Connected') && setupText.includes('On · signed') && setupText.includes('Old FB Page'));
  await page.locator('input[aria-label="SMC LinkedIn for SMC"]').check();
  await page.waitForTimeout(200);
  check('Brand channel defaults save', await page.evaluate(() => JSON.parse(localStorage.getItem('soulvee-os:v1')).docs['settings/main'].social.brandChannels.smc.includes('ch_li')));
  await page.getByRole('button', { name: 'Send a test post to the webhook' }).click();
  await page.waitForSelector('text=Test post sent');
  check('Webhook test post arrives', (await hookLog()).some(h => h.event === 'test' && h.signatureValid));
  await page.screenshot({ path: OUT + '/setup-connected.png', fullPage: false });

  /* --- 19. Phone layout of the content plan --- */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(BASE + '/', { waitUntil: 'load' });
  await pp.evaluate(s => localStorage.setItem('soulvee-os:v1', s), await page.evaluate(() => localStorage.getItem('soulvee-os:v1')));
  await pp.goto(BASE + '/#content', { waitUntil: 'load' });
  await pp.reload({ waitUntil: 'load' });
  await pp.waitForSelector('text=Content plan');
  await pp.screenshot({ path: OUT + '/content-mobile.png' });
  check('Content tab fits a phone screen', !(await pp.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > screen.width + 1)));
  await phone.close();

  /* --- 20. Without SOULVEE_ACCESS_TOKEN, AI, images and publishing only work on this computer --- */
  const REMOTE = 'http://192.0.2.2:8790'; // this machine's network address, so requests arrive as another device
  const callsBefore = (await claudeLog()).length;
  const post = (url, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  const viaProxy = await post(BASE + '/api/claude', { 'x-forwarded-for': '203.0.113.9' });
  const viaProxyBody = await viaProxy.json().catch(() => ({}));
  check('A request forwarded by a proxy on this computer is turned away from Claude', viaProxy.status === 401 && /only available on the computer running Soulvee OS/.test(viaProxyBody.error && viaProxyBody.error.message), viaProxy.status + ' ' + JSON.stringify(viaProxyBody));
  const remoteHealth = await json(REMOTE + '/api/health');
  check('Health tells another device why AI is off', remoteHealth.ai === false && remoteHealth.reason === 'local_only', JSON.stringify(remoteHealth));
  const remoteCodes = [(await post(REMOTE + '/api/claude')).status, (await post(REMOTE + '/api/ai-test')).status, (await post(REMOTE + '/api/images/generate')).status];
  check('Another device cannot use Claude, Test AI or images', remoteCodes.every(c => c === 401), remoteCodes.join(','));
  const pubCodes = [(await json(REMOTE + '/api/social/status')).allowed, (await fetch(REMOTE + '/api/social/channels')).status, (await json(REMOTE + '/api/autopilot')).allowed, (await post(REMOTE + '/api/autopilot/run')).status];
  check('Another device cannot publish or run the autopilot', pubCodes.join(',') === 'false,403,false,403', pubCodes.join(','));
  check('Turned-away requests never reach Claude', (await claudeLog()).length === callsBefore);
  check('This computer still has AI', (await json(BASE + '/api/health')).ai === true);
  const rp = await browser.newPage();
  await rp.goto(REMOTE + '/#assistant', { waitUntil: 'load' });
  await rp.waitForSelector('text=AI only works on the computer running Soulvee OS');
  check('The AI tab on another device explains how to turn it on', (await rp.locator('main').innerText()).includes('set SOULVEE_ACCESS_TOKEN on the server'));
  await rp.close();

  check('No console or page errors', errs.length === 0, errs.join(' || '));
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async e => { console.error(e); if (shared.page) await shared.page.screenshot({ path: OUT + '/crash.png' }).catch(() => {}); process.exit(2); });
