// End-to-end test of the autopilot, automatic images and the Buffer learning loop.
// Stand-ins: Claude (8799), Buffer + webhook (8797/8796), OpenAI images + Cloudinary (8794).
// Server under test: http://localhost:8790. Run it with: node test/run.js growth
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
const mediaLog = () => json('http://127.0.0.1:8794/__log');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; };
const reply = obj => ({ blocks: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' });
const shared = {};
const posts = list => ({ posts: list.map((p, i) => ({ title: p.title, caption: p.caption || 'Caption ' + i, hashtags: ['lagos'], platforms: p.platforms || ['instagram'], format: p.format || 'image', visual: p.visual === undefined ? 'Gold DJ booth, violet light' : p.visual, script: '', day: p.day || 2, time: p.time || '19:00' })) });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  shared.page = page;
  const errs = [];
  const expected400 = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error' || /fonts\.(googleapis|gstatic)|net::ERR_/.test(m.text())) return;
    // The declined image brief (step 3) is a deliberate 400; Chrome logs it.
    if (/status of 400/.test(m.text())) return expected400.push(m.text());
    errs.push('console: ' + m.text());
  });
  page.on('dialog', d => d.accept());
  const dialog = page.locator('div[role=dialog]');
  const main = () => page.locator('main').innerText();
  const card = title => page.locator('div.rounded-2xl', { has: page.locator('p.font-semibold', { hasText: title }) }).last();
  const toastText = async () => { const t = page.locator('div.fixed.bottom-5'); return (await t.count()) ? t.first().innerText({ timeout: 500 }).catch(() => '') : ''; };
  const toastSeen = async (text, ms = 15000) => until(async () => (await toastText()).includes(text), ms);
  const has = async (title, test) => until(async () => { const p = (await content()).find(x => x.title === title); return !!p && (!test || test(p)); }, 20000);
  const content = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('soulvee-os:v1')).collections.content || {}));

  await page.goto(BASE + '/#content', { waitUntil: 'load' });
  await page.waitForSelector('text=⟳ Autopilot');

  /* --- 1. Read results from Buffer --- */
  await page.getByRole('button', { name: 'Read results from Buffer' }).click();
  check('Results read from Buffer', await toastSeen('Results read from 3 Buffer posts'));
  const resText = await page.locator('div.rounded-2xl', { hasText: "What's working" }).last().innerText();
  check('Results show engagement by platform and the top posts', resText.includes('Instagram 7%') && resText.includes('POV: the bride hears her song'));

  /* --- 2. Generator learns from results and makes images --- */
  check('Generator offers "Use what\'s working"', await page.locator('label', { hasText: "Use what's working (3 posts)" }).locator('input').isChecked());
  await page.locator('label', { hasText: 'Make an image for each post' }).first().locator('input').check();
  await script([reply(posts([{ title: 'Gold night', visual: 'Gold DJ booth, violet light, text "SAT 22 NOV"' }, { title: 'Text only post', platforms: ['x'], format: 'text', visual: '' }]))]);
  await page.getByRole('button', { name: 'Generate posts' }).click();
  check('Drafts created', await has('Gold night') && await has('Text only post'));
  check('Images made for posts that have a brief', await has('Gold night', p => p.media.length === 1));
  let log = await claudeLog();
  check('Generator prompt includes the Buffer learnings', log[log.length - 1].body.messages[0].content.includes('Results from the last 60 days on Buffer'));
  let media = await mediaLog();
  const lastAi = media.filter(m => m.kind === 'openai').slice(-1)[0];
  check('Image request: brand look, brief, JPEG, square for Instagram', lastAi && lastAi.prompt.includes('violet and magenta neon') && lastAi.prompt.includes('SAT 22 NOV') && lastAi.format === 'jpeg' && lastAi.size === '1024x1024');
  check('Image uploaded to Cloudinary with a valid signature', media.filter(m => m.kind === 'cloudinary').every(m => m.valid));
  const gold = (await content()).find(p => p.title === 'Gold night');
  check('Draft gets the hosted image link', gold && gold.media.length === 1 && gold.media[0].url.startsWith('http://127.0.0.1:8794/img/'));
  check('Card shows the image', await card('Gold night').locator('img').count() === 1);
  check('Post without a brief gets no image', ((await content()).find(p => p.title === 'Text only post') || {}).media.length === 0);

  /* --- 3. Make an image from the editor, and from a card --- */
  await page.getByRole('button', { name: '+ Post' }).click();
  await dialog.locator('label', { has: page.locator('span', { hasText: /^Title \(for you, not posted\)$/ }) }).locator('input').fill('Merch drop');
  await dialog.locator('label', { has: page.locator('span', { hasText: /^Brand$/ }) }).locator('select').selectOption('emporium');
  await dialog.locator('label', { has: page.locator('span', { hasText: /^Caption$/ }) }).locator('textarea').fill('New zodiac tees are here.');
  await dialog.locator('label', { has: page.locator('span', { hasText: /^Visual brief$/ }) }).locator('textarea').fill('Folded zodiac T-shirts on teal fabric');
  await dialog.getByRole('button', { name: '✦ Make image from brief' }).click();
  check('Editor adds the image to the post', await until(async () => (await dialog.locator('img').count()) === 1, 10000));
  media = await mediaLog();
  check('Editor image uses the Emporium look', media.filter(m => m.kind === 'openai').slice(-1)[0].prompt.includes('gold and teal'));
  await dialog.getByRole('button', { name: 'Save post' }).click();
  await script([reply(posts([{ title: 'Needs a picture', visual: 'Lagos skyline at dusk' }]))]);
  await page.locator('label', { hasText: 'Make an image for each post' }).first().locator('input').uncheck();
  await page.getByRole('button', { name: 'Generate posts' }).click();
  await has('Needs a picture');
  await card('Needs a picture').getByRole('button', { name: 'Make image' }).click();
  check('Card "Make image" attaches an image', await until(async () => ((await content()).find(p => p.title === 'Needs a picture') || { media: [] }).media.length === 1, 10000));
  // A declined brief is explained
  await card('Text only post').getByRole('button', { name: 'Edit' }).click();
  await dialog.locator('label', { has: page.locator('span', { hasText: /^Visual brief$/ }) }).locator('textarea').fill('BLOCKME');
  await dialog.getByRole('button', { name: '✦ Make image from brief' }).click();
  check('A declined image brief is explained', await toastSeen('The image service declined this brief'));
  await page.keyboard.press('Escape');

  /* --- 4. Publish with the image, then learn from its results --- */
  await card('Gold night').getByRole('button', { name: 'Approve' }).click();
  await card('Gold night').getByRole('button', { name: 'Publish…' }).click();
  await dialog.getByRole('button', { name: /Schedule for 1 account/ }).click();
  await has('Gold night', p => p.status === 'scheduled');
  const created = (await bufferLog()).filter(r => String(r.query).includes('SoulveeCreatePost')).slice(-1)[0];
  check('Buffer gets the hosted image', created.variables.input.assets[0].image.url.startsWith('http://127.0.0.1:8794/img/'));
  await page.getByRole('button', { name: 'Refresh' }).first().click();
  check('Refreshed results include the new post', await has('Gold night', p => !!p.metrics));
  const goldAfter = (await content()).find(p => p.title === 'Gold night');
  check('The post gets its numbers and turns "posted"', goldAfter.status === 'posted' && goldAfter.metrics && goldAfter.metrics.reactions >= 60 && goldAfter.metrics.seen === 1000);
  await page.locator('main button', { hasText: /^Posted$/ }).click();
  check('Card shows the results line', (await card('Gold night').innerText()).includes('1K reached'));
  await page.locator('main button', { hasText: /^To do$/ }).click();

  /* --- 5. Autopilot: set up, switch on, run now --- */
  const plan = page.locator('[data-plan="0"]');
  await plan.locator('select[aria-label="Posts per week"]').selectOption('3');
  await plan.locator('input[aria-label="Plan goal"]').fill('Fill December wedding bookings');
  await plan.locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: '+ Add a brand' }).click();
  const plan2 = page.locator('[data-plan="1"]');
  await plan2.locator('select[aria-label="Plan brand"]').selectOption('smc');
  await plan2.locator('select[aria-label="Posts per week"]').selectOption('3');
  await page.getByRole('button', { name: 'Turn on' }).click();
  check('Autopilot turns on and shows the next run', await toastSeen('Autopilot is on — next run'));
  let st = await json(BASE + '/api/autopilot');
  check('Server saved the plans and schedule', st.enabled && st.plans.length === 2 && st.plans[0].count === 3 && st.plans[0].images === true && st.plans[0].goal.includes('December') && !!st.nextRun);
  check('Autopilot got the offers and recent titles', !!st.contextAt);
  await script([
    reply(posts([{ title: 'AP wedding 1' }, { title: 'AP wedding 2', format: 'reel', platforms: ['instagram', 'tiktok'] }, { title: 'AP wedding 3' }])),
    reply(posts([{ title: 'AP hotels 1', platforms: ['linkedin'], format: 'text', visual: '' }, { title: 'AP hotels 2', platforms: ['linkedin'], format: 'text', visual: '' }])),
  ]);
  await page.getByRole('button', { name: 'Run now' }).click();
  check('Run now imports the drafts when it finishes', await until(async () => (await content()).filter(p => p.autopilot).length === 5, 30000));
  const ap = (await content()).filter(p => p.autopilot);
  check('Autopilot drafts are all drafts, in next week, with images on the DJ plan only', ap.length === 5 && ap.every(p => p.status === 'draft' && Date.parse(p.scheduledAt) > Date.now()) && ap.filter(p => p.brand === 'dj').every(p => p.media.length === 1) && ap.filter(p => p.brand === 'smc').every(p => p.media.length === 0), ap.map(p => p.title + ':' + p.media.length).join(', '));
  log = await claudeLog();
  const apPrompt = log[log.length - 2].body.messages[0].content;
  check('Autopilot prompt: next-week days, goal and Buffer learnings', apPrompt.includes('from day 1 to day 7') && apPrompt.includes('Fill December wedding bookings') && apPrompt.includes('Results from the last 60 days'));
  check('Server inbox is empty after import', (await json(BASE + '/api/autopilot')).inbox === 0);
  check('Content tab shows a badge with drafts to review', (await page.locator('nav button', { hasText: 'Content' }).innerText()).includes('5'));
  check('Cards are labelled Autopilot', (await card('AP wedding 1').innerText()).includes('Autopilot'));
  check('"Drafts ready" ping reaches the webhook, signed', (await hookLog()).some(h => h.event === 'autopilot.ready' && h.signatureValid && h.body.post.drafts === 5));
  await card('AP wedding 1').getByRole('button', { name: 'Approve' }).click();
  check('Approving lowers the badge', await until(async () => (await page.locator('nav button', { hasText: 'Content' }).innerText()).includes('4')));
  const apText = await page.locator('div.rounded-2xl', { hasText: '⟳ Autopilot' }).last().innerText();
  check('Status shows the last run', apText.includes('5 drafts, 3 with images (run by hand)'));
  check('Next run shown on Lagos time (17:00 on Sunday)', apText.includes('Next run: Sun') && apText.includes('17:00 (Africa/Lagos time)'), (apText.match(/Next run:[^\n]*/) || [''])[0]);
  await page.screenshot({ path: OUT + '/autopilot.png' });

  /* --- 6. Autopilot fires on its schedule --- */
  const tz = 'Africa/Lagos';
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  let hh = +p.hour % 24; let mm = +p.minute + 1;
  if (+p.second > 50) mm += 1; // leave time to save before that minute starts
  if (mm >= 60) { mm -= 60; hh = (hh + 1) % 24; }
  const time = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  const cfg = await json(BASE + '/api/autopilot');
  await script([reply(posts([{ title: 'Scheduled DJ post' }])), reply(posts([{ title: 'Scheduled SMC post', platforms: ['linkedin'], format: 'text', visual: '' }]))]);
  const saved = await (await fetch(BASE + '/api/autopilot', { method: 'PUT', body: JSON.stringify({ ...cfg, enabled: true, day, time, timezone: tz, plans: cfg.plans.map(pl => ({ ...pl, count: 1 })) }) })).json();
  check('Schedule set for the coming minute', saved.nextRun && Date.parse(saved.nextRun) - Date.now() < 125000, saved.nextRun);
  const fired = await until(async () => { const s = await json(BASE + '/api/autopilot'); return s.lastResult && s.lastResult.trigger === 'schedule' && !s.running; }, 150000);
  check('Autopilot runs by itself at the scheduled time', fired);
  st = await json(BASE + '/api/autopilot');
  check('After a scheduled run, the next one is a week later', Date.parse(st.nextRun) - Date.now() > 6 * 864e5, st.nextRun);
  await page.reload({ waitUntil: 'load' });
  check('Opening the app imports the scheduled drafts', await until(async () => (await content()).some(x => x.title === 'Scheduled DJ post'), 15000));

  /* --- 7. The agent can read what's working --- */
  await page.locator('nav button', { hasText: 'AI Agent' }).click();
  await script([
    { blocks: [{ type: 'tool_use', name: 'get_social_results', input: {} }], stop_reason: 'tool_use' },
    { blocks: [{ type: 'text', text: 'Instagram reels are your strongest format.' }], stop_reason: 'end_turn' },
  ]);
  await page.locator('form textarea').fill('What is working on my socials?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Instagram reels are your strongest format.');
  log = await claudeLog();
  const toolResult = log[log.length - 1].body.messages.slice(-1)[0].content[0];
  check('Agent tool returns the Buffer learnings', !toolResult.is_error && toolResult.content.includes('Results from the last 60 days'));

  /* --- 8. Setup shows images and autopilot --- */
  await page.locator('nav button', { hasText: 'Setup' }).click();
  await page.waitForSelector('text=On · Cloudinary');
  check('Setup shows images on Cloudinary and autopilot on', (await main()).includes('On · Cloudinary') && /Autopilot\s*On · next/.test(await main()));

  check('No console or page errors (one expected 400 from the declined brief)', errs.length === 0 && expected400.length === 1, errs.join(' || ') + ' | 400s: ' + expected400.length);
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async e => { console.error(e); if (shared.page) await shared.page.screenshot({ path: OUT + '/crash.png' }).catch(() => {}); process.exit(2); });
