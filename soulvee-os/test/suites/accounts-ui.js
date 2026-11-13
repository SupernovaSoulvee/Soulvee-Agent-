// Browser test of Accounts, publishing to several pages and profiles, and the Inbox, against the
// platform stand-ins (stand-ins/platforms.js on 8792) and the Claude stand-in (8799).
// Server under test: http://localhost:8790. Run it with: node test/run.js accounts-ui
const { chromium } = require('playwright');
const crypto = require('node:crypto');
const OUT = process.argv[2];
const BASE = 'http://localhost:8790';
const M = 'http://127.0.0.1:8792';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  — ' + extra : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { for (let t = 0; t < ms; t += 150) { if (await fn()) return true; await sleep(150); } return false; };
const mock = async (path, body) => (await fetch(M + path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json();
const script = items => fetch('http://127.0.0.1:8799/__script', { method: 'POST', body: JSON.stringify(items) });
const claudeLog = async () => (await fetch('http://127.0.0.1:8799/__requests')).json();
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const F = (scope, text) => {
  const pg = typeof scope.page === 'function' ? scope.page() : scope;
  return scope.locator('label').filter({ has: pg.locator('span', { hasText: new RegExp('^' + esc(text) + '$') }) }).locator('input, select, textarea').first();
};
const shared = {};
const sign = body => 'sha256=' + crypto.createHmac('sha256', 'metasecret').update(body).digest('hex');
const whatsapp = (from, name, text, secondsAgo = 0) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '2348030000000', phone_number_id: '106540352242922' }, contacts: [{ profile: { name }, wa_id: from }], messages: [{ from, id: 'wamid.' + crypto.randomUUID(), timestamp: String(Math.floor(Date.now() / 1000) - secondsAgo), type: 'text', text: { body: text } }] } }] }] });
const deliver = async body => fetch(BASE + '/webhooks/meta', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) }, body });

(async () => {
  await mock('/__reset', {});
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  shared.page = page;
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR_|avatar\//.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  const dialog = page.locator('div[role=dialog]');
  const tab = name => page.locator('nav button', { hasText: name }).click();
  const main = () => page.locator('main').innerText();
  const toastSeen = async text => until(async () => (await page.locator('div.fixed.bottom-5').allInnerTexts()).some(t => t.includes(text)), 5000);
  const acct = name => page.locator('div.rounded-2xl', { has: page.locator('p.font-semibold', { hasText: new RegExp('^' + esc(name) + '$') }) }).last();
  const provider = name => page.locator('div.rounded-2xl', { has: page.locator('p.font-semibold', { hasText: new RegExp('^' + esc(name) + '$') }) }).last();

  /* --- 1. Accounts start with Buffer's channels and every platform to connect --- */
  await page.goto(BASE + '/#accounts', { waitUntil: 'load' });
  await page.waitForSelector('text=Connect');
  const first = await main();
  check('Buffer channels show under their platforms, marked via Buffer', first.includes('DJ Soulvee IG') && first.includes('via Buffer'));
  check('Every platform can be connected from here', ['Facebook Pages & Instagram', 'Threads', 'X', 'LinkedIn', 'Telegram', 'WhatsApp Business', 'Reddit', 'Gmail', 'Signal', 'TikTok'].every(n => first.includes(n)));
  check('TikTok explains it goes through Buffer', first.includes("TikTok's own API only lets audited apps post publicly"));
  check('WhatsApp shows the webhook address and verify token to give Meta', first.includes(BASE + '/webhooks/meta') && first.includes('Verify token'));

  /* --- 2. Telegram: a bot and two channels from one form --- */
  await provider('Telegram').getByRole('button', { name: 'Connect' }).click();
  await F(dialog, 'Bot token').fill('123456789:NOT-A-REAL-TOKEN_soulvee-os-tests-only');
  await F(dialog, 'Channels or groups').fill('@soulveemusic, @soulveeplus');
  check('Secret fields are hidden as you type', await F(dialog, 'Bot token').getAttribute('type') === 'password');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  check('Telegram connects the bot and both channels', await toastSeen('Connected 3 accounts'));
  await page.waitForSelector('text=Soulvee Plus');
  check('Channels and the bot are listed under Telegram', (await main()).includes('Soulvee Music') && (await main()).includes('@soulvee_bot'));

  /* --- 3. Facebook sign-in brings in three Pages and two Instagram accounts --- */
  await Promise.all([page.waitForURL(/connected=meta/, { waitUntil: 'commit' }), provider('Facebook Pages & Instagram').getByRole('button', { name: 'Sign in with Facebook' }).click()]);
  await page.waitForLoadState('load');
  check('After signing in, the app says what was connected', await toastSeen('Connected 5 accounts'));
  check('The address bar is tidied after sign-in', !page.url().includes('connected='), page.url());
  await page.waitForSelector("text=Soulvee's Emporium");
  const afterFb = await main();
  check('Three Facebook Pages and two Instagram accounts are listed', afterFb.includes('Soulveetainment Media Consults') && afterFb.includes('@djsoulvee') && afterFb.includes('@soulveesemporium') && afterFb.includes('linked to DJ Soulvee'));

  /* --- 4. X sign-in, WhatsApp number --- */
  await Promise.all([page.waitForURL(/connected=x/, { waitUntil: 'commit' }), provider('X').getByRole('button', { name: 'Sign in with X' }).click()]);
  await page.waitForLoadState('load');
  check('X connects through its sign-in', await toastSeen('Connected 1 account'));
  await provider('WhatsApp Business').getByRole('button', { name: 'Connect' }).click();
  await F(dialog, 'Access token').fill('WA-TOKEN-' + 'x'.repeat(30));
  await F(dialog, 'Phone number ID').fill('106540352242922');
  await F(dialog, 'App secret').fill('wa-app-secret');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  check('WhatsApp number connects', await toastSeen('Connected 1 account'));

  /* --- 5. Brands, switching off --- */
  const setBrand = async (card, brand) => {
    await card.getByRole('button', { name: /^Brands/ }).click();
    await dialog.getByRole('button', { name: brand, exact: true }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(250);
  };
  await page.waitForSelector('text=DJ Soulvee');
  // The Page, the Instagram account and the X profile are all called "DJ Soulvee": the Page comes first.
  const fbPage = page.locator('div.rounded-2xl', { has: page.locator('p.font-semibold', { hasText: /^DJ Soulvee$/ }) }).first();
  const igCard = page.locator('div.rounded-2xl', { has: page.locator('p', { hasText: 'linked to DJ Soulvee' }) }).last();
  await setBrand(fbPage, 'DJ Soulvee');
  await setBrand(igCard, 'DJ Soulvee');
  await setBrand(acct('Soulvee Music'), 'DJ Soulvee');
  const saved = await page.evaluate(() => fetch('/api/accounts').then(r => r.json()));
  const brandsOf = ext => (saved.accounts.find(a => String(a.externalId) === ext) || {}).brands || [];
  check('Accounts can be given a brand', brandsOf('p1').includes('dj') && brandsOf('ig1').includes('dj') && brandsOf('-1001111').includes('dj') && !brandsOf('p3').includes('dj') && (await fbPage.innerText()).includes('DJ Soulvee'), JSON.stringify(['p1', 'ig1', '-1001111', 'p3'].map(brandsOf)));
  await acct('Soulveetainment Media Consults').getByRole('button', { name: 'Switch off' }).click();
  await page.waitForTimeout(250);
  check('An account can be switched off', (await acct('Soulveetainment Media Consults').innerText()).toLowerCase().includes('switched off'));
  await page.screenshot({ path: OUT + '/accounts.png', fullPage: true });

  /* --- 6. Publish one post to the right Page, Instagram account and channel --- */
  await tab('Content');
  await page.getByRole('button', { name: '+ Post' }).click();
  await F(dialog, 'Brand').selectOption('dj');
  await F(dialog, 'Title (for you, not posted)').fill('Quilox Friday');
  await dialog.getByRole('button', { name: 'TikTok' }).click();
  await dialog.getByRole('button', { name: 'Facebook' }).click();
  await dialog.getByRole('button', { name: 'Telegram' }).click();
  await F(dialog, 'Caption').fill('Friday at Quilox: DJ Soulvee on the decks from 11pm.');
  await dialog.getByRole('button', { name: '+ Add media' }).click();
  await dialog.locator('input[placeholder^="https://"]').last().fill(M + '/media/flyer.jpg');
  await dialog.getByRole('button', { name: 'Save post' }).click();
  const post = page.locator('div.rounded-2xl', { has: page.locator('p.font-semibold', { hasText: 'Quilox Friday' }) }).last();
  await post.getByRole('button', { name: 'Approve' }).click();
  await post.getByRole('button', { name: 'Publish…' }).click();
  const pick = label => dialog.getByLabel(label);
  check("The brand's Page, Instagram account and channel are ticked; other Pages are not", await pick('DJ Soulvee on Facebook').isChecked() && await pick('DJ Soulvee on Instagram').isChecked() && await pick('Soulvee Music on Telegram').isChecked() && !(await pick("Soulvee's Emporium on Facebook").isChecked()) && !(await pick('Soulvee Plus on Telegram').isChecked()) && !(await pick('DJ Soulvee IG on Instagram').isChecked()));
  check('A switched-off Page is not offered', !(await dialog.innerText()).includes('Soulveetainment Media Consults'));
  await dialog.getByRole('button', { name: 'Post now to 3 accounts' }).click();
  check('Posting to three accounts confirms', await toastSeen('Posted to 3 accounts'));
  await page.locator('main button', { hasText: /^Posted$/ }).click();
  const posted = await post.innerText();
  check('The post shows each account with a link to the live post', posted.includes('✓ DJ Soulvee · Facebook: posted') && posted.includes('✓ Soulvee Music · Telegram: posted') && posted.includes('Instagram: posted') && (await post.locator('a', { hasText: 'view' }).count()) === 3, posted.replace(/\n/g, ' | '));
  const log = await mock('/__log');
  check('The Page post went to the DJ Page only', log.some(c => c.path.endsWith('/p1/feed')) && !log.some(c => c.path.endsWith('/p3/feed')));
  await page.locator('main button', { hasText: /^To do$/ }).click();

  /* --- 7. Schedule for later, then cancel --- */
  await page.getByRole('button', { name: '+ Post' }).click();
  await F(dialog, 'Brand').selectOption('dj');
  await F(dialog, 'Title (for you, not posted)').fill('Sunday set');
  await dialog.getByRole('button', { name: 'Instagram' }).click();
  await dialog.getByRole('button', { name: 'TikTok' }).click();
  await dialog.getByRole('button', { name: 'Telegram' }).click();
  await F(dialog, 'Caption').fill('Sunday chill set, live on Telegram.');
  const later = await page.evaluate(() => { const d = new Date(Date.now() + 3 * 3600e3); const p = n => String(n).padStart(2, '0'); return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` }; });
  await F(dialog, 'Date').fill(later.date);
  await F(dialog, 'Time').fill(later.time);
  await dialog.getByRole('button', { name: 'Save post' }).click();
  const sunday = page.locator('div.rounded-2xl', { has: page.locator('p.font-semibold', { hasText: 'Sunday set' }) }).last();
  await sunday.getByRole('button', { name: 'Approve' }).click();
  await sunday.getByRole('button', { name: 'Publish…' }).click();
  await dialog.getByRole('button', { name: 'Schedule for 1 account' }).click();
  check('A scheduled post is queued on the server', await toastSeen('Scheduled for 1 account'));
  check('The post says when it goes out', (await sunday.innerText()).includes('Soulvee Music · Telegram: goes out'));
  await sunday.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  check('Cancelling puts it back to approved', (await sunday.innerText()).toLowerCase().includes('approved') && (await sunday.innerText()).includes('Telegram: cancelled'));

  /* --- 8. Inbox: messages from Telegram, Messenger and WhatsApp --- */
  await sleep(1500);
  await mock('/__push/telegram', { fromId: 4242, first: 'Kemi', last: 'Ade', username: 'kemi_ade', text: 'Hi, are you free on 20 Dec?' });
  await mock('/__push/messenger', { convo: 't_100', page: 'p1', participant: { id: 'psid-9', name: 'Bayo Events' }, text: 'Price for a 4-hour set?' });
  await deliver(whatsapp('2348061234567', 'Ngozi', 'Hello, I want to book for my birthday'));
  await deliver(whatsapp('2348000000999', 'Femi', 'Are you available?', 26 * 3600));
  await sleep(2000);
  await tab('Inbox');
  await page.waitForSelector('text=Kemi Ade');
  await page.getByRole('button', { name: 'Check now' }).click();
  check('"Check now" checks every account straight away', await toastSeen('No new messages'));
  const box = await main();
  check('Messages from Telegram, Messenger and WhatsApp are in one list', box.includes('Kemi Ade') && box.includes('Bayo Events') && box.includes('Ngozi') && box.includes('Femi'));
  check('The Inbox tab shows how many are unread', await until(async () => /Inbox\s*4/.test(await page.locator('nav').innerText())), await page.locator('nav').innerText());
  await page.locator('main button', { hasText: 'Kemi Ade' }).click();
  await page.waitForSelector('text=are you free on 20 Dec');
  await page.getByLabel('Reply').fill("Yes, I'm free on the 20th! Where is the event?");
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForSelector("text=Where is the event?");
  check('A reply appears in the conversation', await until(async () => (await main()).includes("Yes, I'm free on the 20th!")));
  check('Opening a conversation marks it read', await until(async () => /Inbox\s*3/.test(await page.locator('nav').innerText())));
  check('The reply went to Kemi on Telegram', (await mock('/__log')).some(c => c.path.endsWith('/sendMessage') && c.body.chat_id === '4242'));

  /* --- 9. AI draft, add to contacts, link to a contact --- */
  await page.locator('main button', { hasText: 'Bayo Events' }).click();
  await page.waitForSelector('text=Price for a 4-hour set?');
  await script([{ blocks: [{ type: 'text', text: 'Hi Bayo! A 4-hour set starts from our Gold package. What date is the event?' }], stop_reason: 'end_turn' }]);
  await page.getByRole('button', { name: '✦ Draft reply' }).click();
  check('The AI drafts a reply into the box', await until(async () => (await page.getByLabel('Reply').inputValue()).includes('What date is the event?')));
  const promptText = (await claudeLog()).slice(-1)[0].body.messages[0].content;
  const promptStr = typeof promptText === 'string' ? promptText : promptText.map(b => b.text || '').join('');
  check('The draft uses the conversation and the offers', promptStr.includes('Price for a 4-hour set?') && promptStr.includes('Offers and prices') && promptStr.includes('Facebook conversation'), promptStr.slice(0, 160));
  await page.getByRole('button', { name: 'Add to contacts' }).click();
  check('A Messenger contact can be added', await toastSeen('Bayo Events added to your contacts'));
  await page.waitForSelector('text=Contact: Bayo Events');
  await page.locator('main button', { hasText: 'Ngozi' }).click();
  await page.getByRole('button', { name: 'Add to contacts' }).click();
  await page.waitForSelector('text=Contact: Ngozi');
  const ngozi = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('soulvee-os:v1')).collections.contacts).find(c => c.name === 'Ngozi'));
  check('A WhatsApp contact gets the phone and WhatsApp number', ngozi && ngozi.whatsapp === '+2348061234567' && ngozi.phone === '+2348061234567' && ngozi.source === 'WhatsApp');
  await page.getByRole('button', { name: 'Contact: Ngozi' }).click();
  await page.waitForSelector('div[role=dialog] >> text=Conversations');
  check('The contact opens in CRM with the WhatsApp conversation', (await dialog.innerText()).includes('Hello, I want to book for my birthday'));
  await dialog.locator('button', { hasText: 'Hello, I want to book' }).click();
  await page.getByPlaceholder('Reply on WhatsApp…').waitFor();
  check("The conversation opens from the contact's page", (await page.locator('nav [data-active="true"]').innerText()).includes('Inbox') && (await main()).includes('Contact: Ngozi'));

  /* --- 10. WhatsApp after 24 hours needs a template --- */
  await page.locator('main button', { hasText: 'Femi' }).click();
  await page.waitForSelector('text=only allows an approved template');
  await page.getByLabel('Template name').fill('follow_up');
  await page.getByRole('button', { name: 'Send template' }).click();
  await page.waitForSelector('text=Template: follow_up');
  check('After 24 hours, a WhatsApp template can be sent', (await mock('/__log')).some(c => c.path.endsWith('/106540352242922/messages') && c.body.type === 'template' && c.body.template.name === 'follow_up'));
  await page.screenshot({ path: OUT + '/inbox.png' });

  /* --- 11. The agent can read the inbox --- */
  await tab('AI Agent');
  await script([
    { blocks: [{ type: 'tool_use', name: 'list_conversations', input: { unreadOnly: false } }, { type: 'tool_use', name: 'read_conversation', input: { with: 'Ngozi' } }], stop_reason: 'tool_use' },
    { blocks: [{ type: 'text', text: 'Ngozi wants a birthday booking; reply with your packages.' }], stop_reason: 'end_turn' },
  ]);
  await page.locator('form textarea').fill('Who wrote to me today?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Ngozi wants a birthday booking');
  const reqs = await claudeLog();
  const turn = reqs[reqs.length - 1].body.messages.slice(-1)[0].content;
  const convos = JSON.parse(turn[0].content);
  const read = JSON.parse(turn[1].content);
  check('list_conversations returns who wrote, where, and the CRM contact', convos.some(c => c.with === 'Ngozi' && c.platform === 'WhatsApp' && c.contact === 'Ngozi') && convos.some(c => c.with === 'Kemi Ade' && c.platform === 'Telegram'));
  check('read_conversation returns the messages', read.with === 'Ngozi' && read.messages.some(m => m.text.includes('book for my birthday')));

  /* --- 12. Phone layout --- */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(BASE + '/#inbox', { waitUntil: 'load' });
  await pp.waitForSelector('text=Kemi Ade');
  const fits = () => pp.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= screen.width + 1);
  check('Inbox fits a phone screen', await fits());
  await pp.locator('main button', { hasText: 'Kemi Ade' }).click();
  await pp.waitForSelector('text=are you free on 20 Dec');
  await pp.screenshot({ path: OUT + '/inbox-mobile.png' });
  check('On a phone a conversation opens on its own, with a way back', await pp.getByRole('button', { name: 'Back to conversations' }).isVisible() && !(await pp.locator('main button', { hasText: 'Bayo Events' }).isVisible()) && await fits());
  await pp.getByRole('button', { name: 'Back to conversations' }).click();
  check('Back returns to the list', await pp.locator('main button', { hasText: 'Bayo Events' }).isVisible());
  await pp.goto(BASE + '/#accounts', { waitUntil: 'load' });
  await pp.waitForSelector('text=Soulvee Music');
  await pp.screenshot({ path: OUT + '/accounts-mobile.png' });
  check('Accounts fit a phone screen', await fits());
  await phone.close();

  check('No console or page errors', errs.length === 0, errs.join(' || '));
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async e => { console.error(e); if (shared.page) await shared.page.screenshot({ path: OUT + '/crash.png' }).catch(() => {}); process.exit(2); });
