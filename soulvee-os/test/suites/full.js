// Full browser test for Soulvee OS. Servers under test: http://localhost:8785, with no AI key, and
// http://localhost:8786, where AI is locked with an access token and has a key the Claude stand-in
// rejects. Both stay clear of 8787, so the tests can run while your own copy is open.
// Run it with: node test/run.js full
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const BASE = 'http://localhost:8785';
const LOCKED = 'http://localhost:8786';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  — ' + extra : '')); };

function watchErrors(page, errs) {
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/fonts\.(googleapis|gstatic)\.com|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL|net::ERR_/i.test(t)) return; // blocked font CDN / offline test
    errs.push('console: ' + t);
  });
}
const dialog = page => page.locator('div[role=dialog]');
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The form control inside <label><span>Text</span>…</label>, matched on the exact label text.
const F = (scope, text) => {
  const pg = typeof scope.page === 'function' ? scope.page() : scope; // the `has` locator must be relative to the label
  return scope.locator('label').filter({ has: pg.locator('span', { hasText: new RegExp('^' + esc(text) + '$') }) }).locator('input, select, textarea').first();
};
async function tab(page, name) { await page.locator('nav button', { hasText: name }).click(); }
async function pipeline(page) { await tab(page, 'CRM'); await page.locator('main button', { hasText: /^Pipeline$/ }).click(); }
async function toastText(page) { const t = page.locator('div.fixed.bottom-5'); await t.waitFor({ timeout: 4000 }); return t.innerText(); }

(async () => {
  const browser = await chromium.launch();

  /* ============ 1. Core app, no AI ============ */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  watchErrors(page, errs);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('h1:has-text("Soulvee OS")');

  // Google tab is hidden standalone, Command quick action is not a dead end
  const navText = await page.locator('nav').innerText();
  check('Google tab hidden without connectors', !navText.includes('Google'), navText.replace(/\n/g, ' | '));
  check('A new, empty app shows no backup reminder', !(await page.locator('main').innerText()).includes('Back up your data'));
  check('Command shows "Log money" instead of Gmail radar', await page.locator('button:has-text("Log money")').count() === 1 && await page.locator('button:has-text("Gmail lead radar")').count() === 0);

  // --- Setup: rates, VAT 0, unsaved edits survive a theme toggle, theme survives save
  await tab(page, 'Setup');
  await F(page, 'VAT rate %').fill('0');
  await F(page, '₦ per 1 USD').fill('1500');
  await F(page, `H2 ${new Date().getFullYear()} target (₦)`).fill('10000000');
  await page.getByRole('button', { name: 'Save setup' }).click();
  check('Setup saves', (await toastText(page)).includes('Setup saved'));
  await F(page, 'Business name').fill('Soulvee Test Biz');
  await page.locator('header button[aria-label="Toggle day and night mode"]').click();
  await page.waitForTimeout(200);
  check('Unsaved Setup edit survives theme toggle', await F(page, 'Business name').inputValue() === 'Soulvee Test Biz');
  check('Theme switched to light', !(await page.evaluate(() => document.documentElement.classList.contains('dark'))));
  await page.getByRole('button', { name: 'Save setup' }).click();
  await page.waitForTimeout(200);
  check('Saving Setup keeps the light theme', !(await page.evaluate(() => document.documentElement.classList.contains('dark'))));
  await page.screenshot({ path: OUT + '/setup-light.png' });
  await page.locator('header button[aria-label="Toggle day and night mode"]').click();

  // --- Offers: create, Escape closes modal, drag-release on backdrop keeps it open
  await tab(page, 'Skills');
  await page.getByRole('button', { name: '+ Offer' }).click();
  await page.keyboard.press('Escape');
  check('Escape closes a modal', await dialog(page).count() === 0);
  await page.getByRole('button', { name: '+ Offer' }).click();
  const nameBox = F(page, 'Offer name');
  await nameBox.fill('DJ Wedding Package');
  const nb = await nameBox.boundingBox();
  await page.mouse.move(nb.x + 20, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 5 }); // drag out onto the backdrop
  await page.mouse.up();
  check('Drag-select ending on backdrop keeps the modal open', await dialog(page).count() === 1);
  await F(page, 'Brand').selectOption('dj');
  await page.locator('div[role=dialog] input[placeholder="Tier name"]').fill('Standard');
  await page.locator('div[role=dialog] input[placeholder="Price ₦"]').fill('1,500,000');
  await page.getByRole('button', { name: 'Save offer' }).click();
  check('Offer saved', await page.locator('p.font-semibold', { hasText: 'DJ Wedding Package' }).count() === 1);
  // Backdrop click (real click) still closes, and the overlay covers the header
  await page.getByRole('button', { name: '+ Offer' }).click();
  check('Modal overlay covers the whole screen, header included', await page.evaluate(() => { const r = document.querySelector('div[role=dialog]').getBoundingClientRect(); return r.top === 0 && r.height === innerHeight && !!document.elementFromPoint(5, 5).closest('div[role=dialog]'); }));
  await page.mouse.click(5, 5);
  check('Clicking the backdrop closes the modal', await dialog(page).count() === 0);

  // --- Deals: stage change refreshes default win chance; custom chance kept; brand change clears offer
  await page.getByRole('button', { name: 'Start deal' }).click();
  check('Start deal pre-selects the offer', await F(page, 'Offer').inputValue() !== '');
  await F(page, 'Brand').selectOption('smc');
  check('Changing brand clears an offer from another brand', await F(page, 'Offer').inputValue() === '');
  await F(page, 'Brand').selectOption('dj');
  await F(page, 'Offer').selectOption({ label: 'DJ Wedding Package' });
  await F(page, 'Client').fill('Eko Hotels');
  await F(page, 'Client email').fill('events@ekohotels.test');
  await page.getByRole('button', { name: 'Save deal' }).click();
  await pipeline(page);
  const ekoCard = page.locator('div.rounded-2xl', { has: page.locator('p.font-semibold', { hasText: 'Eko Hotels' }) }).last();
  check('New lead shows 10% chance', (await ekoCard.innerText()).includes('10% chance'));
  await ekoCard.getByRole('button', { name: 'Edit' }).click();
  await F(page, 'Stage').selectOption('proposal');
  await page.getByRole('button', { name: 'Save deal' }).click();
  await page.waitForTimeout(150);
  check('Stage change in Edit updates win chance to 50%', (await ekoCard.innerText()).includes('50% chance'));
  await ekoCard.getByRole('button', { name: 'Edit' }).click();
  await F(page, 'Win chance %').fill('40');
  await F(page, 'Stage').selectOption('negotiation');
  await page.getByRole('button', { name: 'Save deal' }).click();
  await page.waitForTimeout(150);
  check('A custom win chance is kept on stage change', (await ekoCard.innerText()).includes('40% chance'));

  // --- Follow-up without Gmail: copy + mailto
  await ekoCard.getByRole('button', { name: '✉ Follow up' }).click();
  const mailLink = dialog(page).locator('a', { hasText: 'Open in email app' });
  check('Follow-up offers "Open in email app"', await mailLink.count() === 1);
  check('Email link disabled while the body is empty', (await mailLink.getAttribute('aria-disabled')) === 'true');
  await F(dialog(page), 'Body').fill('Hi Eko team,\nJust checking in.');
  const href = await mailLink.getAttribute('href');
  check('mailto link has recipient, subject and body', href && href.startsWith('mailto:events@ekohotels.test?subject=') && href.includes('body=Hi%20Eko%20team%2C%0AJust%20checking%20in.'), href);
  await page.keyboard.press('Escape');

  // --- Book a call without the Calendar connector: Google Calendar link + .ics
  await ekoCard.getByRole('button', { name: '📅 Book' }).click();
  await F(dialog(page), 'Date').fill('2026-12-01');
  await F(dialog(page), 'Time').fill('11:00');
  const gcal = await dialog(page).locator('a', { hasText: 'Open in Google Calendar' }).getAttribute('href');
  const tzOffsetMin = await page.evaluate(() => new Date('2026-12-01T11:00:00').getTimezoneOffset());
  const startUtc = new Date(Date.UTC(2026, 11, 1, 11, 0) + tzOffsetMin * 60000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  check('Google Calendar link has title, times and guest', gcal && gcal.includes('action=TEMPLATE') && gcal.includes('dates=' + startUtc) && gcal.includes('add=events%40ekohotels.test'), gcal);
  const [ics] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Download .ics' }).click()]);
  const icsText = fs.readFileSync(await ics.path(), 'utf8');
  check('.ics file is a valid VEVENT', icsText.startsWith('BEGIN:VCALENDAR\r\n') && icsText.includes('DTSTART:' + startUtc) && icsText.includes('SUMMARY:DJ Soulvee × Eko Hotels') && icsText.trim().endsWith('END:VCALENDAR'));

  // --- Invoice from deal, VAT 0, WHT default, mark sent/paid, undo paid
  await ekoCard.getByRole('button', { name: 'Won → Invoice' }).click();
  const invText = await dialog(page).innerText();
  check('Invoice VAT is ₦0 when the VAT rate is 0', /VAT\s*\n?\s*₦0/.test(invText) && invText.includes('Charge VAT (0%)'));
  check('New invoice uses the typical WHT setting (5%)', await F(dialog(page), 'WHT the client deducts').inputValue() === '5');
  await dialog(page).getByRole('button', { name: 'Save invoice' }).click();
  await page.waitForTimeout(150);
  check('Won deal leaves the Open filter', await page.locator('main p.font-semibold', { hasText: 'Eko Hotels' }).count() === 0);
  await page.locator('main button', { hasText: /^Won$/ }).click();
  check('Saving the invoice marks the deal won', (await ekoCard.innerText()).includes('Won'));
  await tab(page, 'Money');
  const invCard = page.locator('div.rounded-2xl', { has: page.locator('p', { hasText: /^INV-SMC-EKOHOTEL-002$/ }) }).last();
  check('Invoice listed with expected number', await invCard.count() === 1);
  await invCard.getByRole('button', { name: 'Mark sent' }).click();
  await invCard.getByRole('button', { name: 'Mark paid' }).click();
  await F(dialog(page), 'Currency received').selectOption('USD');
  const usdAmt = await F(dialog(page), 'Amount received').inputValue();
  check('Switching to USD converts the untouched amount (1,425,000 ÷ 1,500 = 950)', usdAmt === '950', usdAmt);
  await F(dialog(page), 'Currency received').selectOption('NGN');
  check('Method defaults to a real payment method', await F(dialog(page), 'Method').inputValue() === 'Moniepoint');
  await dialog(page).getByRole('button', { name: 'Mark paid' }).click();
  await page.waitForTimeout(150);
  check('Invoice shows paid', (await invCard.innerText()).toLowerCase().includes('paid'));
  page.once('dialog', d => d.dismiss());
  await invCard.getByRole('button', { name: 'Undo paid' }).click();
  await page.waitForTimeout(150);
  check('Dismissing the undo prompt changes nothing', await invCard.getByRole('button', { name: 'Undo paid' }).count() === 1);
  page.once('dialog', d => d.accept());
  await invCard.getByRole('button', { name: 'Undo paid' }).click();
  await page.waitForTimeout(200);
  check('Undo paid reopens the invoice', await invCard.getByRole('button', { name: 'Mark paid' }).count() === 1);
  await page.locator('button', { hasText: 'Ledger' }).click();
  check('Undo paid removes the ledger payment', (await page.locator('main').innerText()).includes('Ledger is empty'));

  // --- Part payments keep the invoice open for the balance
  await page.locator('button', { hasText: 'Invoices' }).click();
  await invCard.getByRole('button', { name: 'Mark paid' }).click();
  await F(dialog(page), 'Amount received').fill('500000');
  const partText = await dialog(page).innerText();
  check('A smaller amount is recorded as a part payment', await dialog(page).getByRole('button', { name: 'Record part payment' }).count() === 1 && !(await dialog(page).getByLabel('Paid in full (closes the invoice)').isChecked()) && partText.includes('₦925,000 still due'), partText.replace(/\n/g, ' | '));
  await dialog(page).getByRole('button', { name: 'Record part payment' }).click();
  check('Part payment toast shows what is still due', (await toastText(page)).includes('₦925,000 still due'));
  const partCard = await invCard.innerText();
  check('Part-paid invoice stays open with the balance', partCard.includes('₦500,000 paid · ₦925,000 due') && await invCard.getByRole('button', { name: 'Mark paid' }).count() === 1 && await invCard.getByRole('button', { name: 'Delete' }).count() === 0, partCard.replace(/\n/g, ' | '));
  check('Outstanding counts only the balance', (await page.locator('main').innerText()).includes('₦925,000 outstanding'));
  await invCard.getByRole('button', { name: 'Invoice text' }).click();
  check('Invoice text shows the balance due', (await dialog(page).locator('textarea').inputValue()).includes('BALANCE DUE: ₦925,000'));
  await page.keyboard.press('Escape');
  await tab(page, 'Command');
  check('Command outstanding counts only the balance', (await page.locator('div.rounded-2xl', { hasText: 'Outstanding' }).first().innerText()).includes('₦925K'));
  await tab(page, 'Money');
  await invCard.getByRole('button', { name: 'Mark paid' }).click();
  check('Next payment defaults to the balance', await F(dialog(page), 'Amount received').inputValue() === '925000' && (await dialog(page).innerText()).includes('₦500,000 already received'));
  await dialog(page).getByRole('button', { name: 'Mark paid' }).click();
  await page.waitForTimeout(150);
  check('Paying the balance closes the invoice', await invCard.getByRole('button', { name: 'Undo paid' }).count() === 1);
  page.once('dialog', d => d.accept());
  await invCard.getByRole('button', { name: 'Undo paid' }).click();
  await page.waitForTimeout(200);
  check('Undo paid takes back only the last payment', (await invCard.innerText()).includes('₦500,000 paid · ₦925,000 due'));
  await page.locator('button', { hasText: 'Ledger' }).click();
  const ledgerText = await page.locator('main').innerText();
  check('The deposit stays in the ledger', ledgerText.includes('+₦500,000') && !ledgerText.includes('₦925,000'), ledgerText.replace(/\n/g, ' | '));
  page.once('dialog', d => d.accept());
  await page.locator('button[aria-label="Delete entry"]').click();
  await page.waitForTimeout(200);
  check('Deleting the deposit empties the ledger', (await page.locator('main').innerText()).includes('Ledger is empty'));
  await page.locator('button', { hasText: 'Invoices' }).click();
  check('...and leaves the invoice unpaid', await invCard.getByRole('button', { name: 'Delete' }).count() === 1 && !(await invCard.innerText()).includes('paid ·'));

  // --- Each invoice keeps its VAT rate when the rate in Setup changes
  await tab(page, 'Setup');
  await F(page, 'VAT rate %').fill('7.5');
  await page.getByRole('button', { name: 'Save setup' }).click();
  await page.waitForTimeout(150);
  await tab(page, 'Money');
  const keptCard = await invCard.innerText();
  check('Changing the VAT rate leaves an issued invoice alone', keptCard.includes('₦1,500,000') && !keptCard.includes('incl. VAT ₦112,500'), keptCard.replace(/\n/g, ' | '));
  await invCard.getByRole('button', { name: 'Edit' }).click();
  check("Editing it shows its own rate and offers today's", (await dialog(page).innerText()).includes('Charge VAT (0%)') && await dialog(page).getByRole('button', { name: "Use today's rate (7.5%)" }).count() === 1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '+ Invoice' }).click();
  check('A new invoice uses the new rate', (await dialog(page).innerText()).includes('Charge VAT (7.5%)'));
  await page.keyboard.press('Escape');
  await tab(page, 'Setup');
  await F(page, 'VAT rate %').fill('0');
  await page.getByRole('button', { name: 'Save setup' }).click();
  await page.waitForTimeout(150);
  await tab(page, 'Money');
  await page.locator('button', { hasText: 'Ledger' }).click();

  // --- Ledger: big expense -> negative net shows with a proper minus sign
  await page.getByRole('button', { name: '+ Entry' }).click();
  await F(dialog(page), 'Type').selectOption('expense');
  await F(dialog(page), 'Amount').fill('375000');
  await F(dialog(page), 'Note').fill('Sound hire');
  await dialog(page).getByRole('button', { name: 'Save entry' }).click();
  await page.waitForTimeout(150);
  await tab(page, 'Command');
  const netCard = await page.locator('div.rounded-2xl', { hasText: 'Net (after costs)' }).first().innerText();
  check('Negative net formats as −₦375K', netCard.includes('−₦375K'), netCard.replace(/\n/g, ' '));
  await page.screenshot({ path: OUT + '/command.png' });

  // --- Delete confirmations
  await tab(page, 'Money');
  await page.locator('button', { hasText: 'Ledger' }).click();
  page.once('dialog', d => d.dismiss());
  await page.locator('button[aria-label="Delete entry"]').click();
  await page.waitForTimeout(100);
  check('Cancelling a ledger delete keeps the entry', (await page.locator('main').innerText()).includes('Sound hire'));
  page.once('dialog', d => d.accept());
  await page.locator('button[aria-label="Delete entry"]').click();
  await page.waitForTimeout(150);
  check('Confirming a ledger delete removes it', !(await page.locator('main').innerText()).includes('Sound hire'));
  await tab(page, 'Skills');
  page.once('dialog', d => d.dismiss());
  await page.getByRole('button', { name: 'Delete' }).first().click();
  check('Cancelling an offer delete keeps it', await page.locator('p.font-semibold', { hasText: 'DJ Wedding Package' }).count() === 1);

  // --- Learn
  await tab(page, 'Learn');
  await page.getByRole('button', { name: '+ Track' }).click();
  await F(dialog(page), 'Skill to learn').fill('MCP servers');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Mark level done' }).click();
  check('Learning track levels up', (await page.locator('main').innerText()).includes('Level 1/5'));
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(100);
  check('Learning track deleted after confirm', (await page.locator('main').innerText()).includes('No learning tracks yet'));

  // --- AI off: clear reason
  await tab(page, 'AI Agent');
  check('AI-off message explains the missing key', (await page.locator('main').innerText()).includes('Set ANTHROPIC_API_KEY'));

  // --- Backup reminder: on Command while there's data and no backup in the last week
  await tab(page, 'Command');
  check('Command asks for a backup when there has never been one', (await page.locator('main').innerText()).includes("You haven't exported a backup yet"));

  // --- Backup: export, restore, bad file
  await tab(page, 'Setup');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()]);
  const backupPath = OUT + '/backup.json';
  fs.copyFileSync(await dl.path(), backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  check('Backup contains the deal and invoice', Object.keys(backup.collections.deals || {}).length === 1 && Object.keys(backup.collections.invoices || {}).length === 1);
  await tab(page, 'Command');
  check('After a backup, the reminder goes away', !(await page.locator('main').innerText()).includes('Back up your data'));
  await page.evaluate(() => localStorage.setItem('soulvee-os:lastBackup', new Date(Date.now() - 8 * 864e5).toISOString()));
  await tab(page, 'Setup');
  await tab(page, 'Command');
  check('A backup more than a week old brings the reminder back', (await page.locator('main').innerText()).includes('Last backup 8 days ago'));
  const [again] = await Promise.all([page.waitForEvent('download'), page.locator('main').getByRole('button', { name: 'Export backup' }).click()]);
  check("The reminder's own button exports a backup and clears the reminder", /^soulvee-os-backup-\d{4}-\d{2}-\d{2}\.json$/.test(again.suggestedFilename()) && !(await page.locator('main').innerText()).includes('Back up your data'), again.suggestedFilename());
  await tab(page, 'Setup');
  fs.writeFileSync(OUT + '/bad.json', '{"hello": 1}');
  page.once('dialog', d => d.accept());
  await page.locator('input[type=file]').setInputFiles(OUT + '/bad.json');
  check('Restoring a non-backup file is refused', (await toastText(page)).includes("isn't a Soulvee OS backup"));
  const restoreData = { ...backup, collections: { ...backup.collections, deals: {} } };
  fs.writeFileSync(OUT + '/restore.json', JSON.stringify(restoreData));
  page.once('dialog', d => d.accept());
  await page.locator('input[type=file]').setInputFiles(OUT + '/restore.json');
  check('Restoring a backup succeeds', (await toastText(page)).includes('Backup restored'));
  check('A restored device counts the file as its latest backup', (await page.evaluate(() => localStorage.getItem('soulvee-os:lastBackup'))) === backup.exportedAt);
  await pipeline(page);
  check('Restored data replaces current data', (await page.locator('main').innerText()).includes('No deals here'));

  // --- Storage full: change is rolled back and explained
  await page.evaluate(() => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'soulvee-os:v1') throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); }; });
  await page.getByRole('button', { name: '+ Deal' }).click();
  await F(dialog(page), 'Client').fill('Quota Test');
  await dialog(page).getByRole('button', { name: 'Save deal' }).click();
  check('Full storage shows a clear message', (await toastText(page)).includes('Storage is full'));
  check('Failed save keeps the form open', await dialog(page).count() === 1);
  await page.keyboard.press('Escape');
  check('Failed save is not shown as saved', !(await page.locator('main').innerText()).includes('Quota Test'));

  // --- Every tab renders
  for (const t of ['Command', 'Skills', 'CRM', 'Money', 'AI Agent', 'Learn', 'Setup']) await tab(page, t);
  check('No console or page errors in core run', errs.length === 0, errs.join(' || '));
  await ctx.close();

  /* ============ 3. Token-protected server ============ */
  const tctx = await browser.newContext();
  const tp = await tctx.newPage();
  const lockedErrs = [];
  // Only errors from the app count: web fonts load from Google, and a failed font (offline, or on a
  // network that blocks it) only names the font's address in the message's location.
  tp.on('console', m => { const where = (m.location() || {}).url || ''; if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text() + ' ' + where)) lockedErrs.push(m.text() + (where ? ' at ' + where : '')); });
  await tp.goto(LOCKED + '/#assistant', { waitUntil: 'load' });
  await tp.waitForSelector('h1:has-text("Soulvee OS")');
  check('Locked server explains how to unlock AI', (await tp.locator('main').innerText()).includes('?token=YOUR_TOKEN'));
  await tp.waitForTimeout(1200);
  check('A locked device makes no refused background calls', lockedErrs.length === 0, lockedErrs.join(' || '));
  await tctx.close();
  const tctx2 = await browser.newContext();
  const tp2 = await tctx2.newPage();
  await tp2.goto(LOCKED + '/?token=abc123#assistant', { waitUntil: 'load' });
  await tp2.waitForSelector('form textarea', { timeout: 5000 }).catch(() => {});
  check('Opening with ?token= unlocks AI', await tp2.locator('form textarea').count() === 1);
  check('Token is removed from the address bar', !tp2.url().includes('token='), tp2.url());
  // Real round trip to Claude with a bad key: the chat explains what to fix
  await tp2.locator('form textarea').fill('Hello');
  await tp2.keyboard.press('Enter');
  await tp2.waitForSelector('text=Claude rejected the API key', { timeout: 30000 }).catch(() => {});
  check('Bad API key gives a clear message in the chat', (await tp2.locator('main').innerText()).includes('Claude rejected the API key'));
  await tctx2.close();

  /* ============ 4. Offline + mobile ============ */
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const op = await octx.newPage();
  const oerrs = [];
  watchErrors(op, oerrs);
  await op.goto(BASE + '/', { waitUntil: 'load' });
  await op.evaluate(() => navigator.serviceWorker.ready);
  await op.reload({ waitUntil: 'load' }); // now controlled by the service worker
  await op.screenshot({ path: OUT + '/mobile.png' });
  const mobileOverflow = await op.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('Mobile layout has no horizontal overflow', !mobileOverflow);
  await octx.setOffline(true);
  await op.reload({ waitUntil: 'load' }).catch(() => {});
  const offlineOk = await op.locator('h1:has-text("Soulvee OS")').count();
  check('App opens offline (service worker)', offlineOk === 1);
  await op.locator('nav button', { hasText: 'AI Agent' }).click();
  check('Offline AI message is clear', (await op.locator('main').innerText()).includes("can't be reached"));
  await octx.close();

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
