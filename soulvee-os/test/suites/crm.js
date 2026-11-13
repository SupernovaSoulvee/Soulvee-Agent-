// CRM test for Soulvee OS: contacts, follow-ups, timeline, links to deals and invoices,
// CSV import/export, the AI summary and the agent's CRM tools.
// Server under test: http://localhost:8790 (with the Claude stand-in on 8799). Run it with: node test/run.js crm
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const BASE = 'http://localhost:8790';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  — ' + extra : '')); };
const json = async url => (await fetch(url)).json();
const script = items => fetch('http://127.0.0.1:8799/__script', { method: 'POST', body: JSON.stringify(items) });
const claudeLog = () => json('http://127.0.0.1:8799/__requests');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const F = (scope, text) => {
  const pg = typeof scope.page === 'function' ? scope.page() : scope;
  return scope.locator('label').filter({ has: pg.locator('span', { hasText: new RegExp('^' + esc(text) + '$') }) }).locator('input, select, textarea').first();
};
const shared = {};
const db = () => shared.page.evaluate(() => JSON.parse(localStorage.getItem('soulvee-os:v1')));
const col = async name => Object.values(((await db()).collections || {})[name] || {});

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  shared.page = page;
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  const dialog = page.locator('div[role=dialog]');
  const tab = name => page.locator('nav button', { hasText: name }).click();
  const sub = name => page.locator('main button', { hasText: new RegExp('^' + esc(name) + '( · \\d+)?$') }).first().click();
  const main = () => page.locator('main').innerText();
  const toast = async () => { const t = page.locator('div.fixed.bottom-5'); await t.waitFor({ timeout: 4000 }); return t.innerText(); };

  await page.goto(BASE + '/#crm', { waitUntil: 'load' });
  await page.waitForSelector('text=No contacts yet');
  check('CRM opens on People with a helpful empty state', (await main()).includes('import a CSV'));

  /* --- 1. Add a contact --- */
  await page.getByRole('button', { name: '+ Contact' }).click();
  await F(dialog, 'Name').fill('Tolu Adeyemi');
  await F(dialog, 'Company').fill('Eko Hotels');
  await F(dialog, 'Role').fill('Events manager');
  await F(dialog, 'Email').fill('Tolu@EkoHotels.test');
  await F(dialog, 'Phone').fill('0803 123 4567');
  await F(dialog, 'Instagram').fill('@tolu.events');
  await dialog.getByRole('button', { name: '+ X, TikTok, Threads, LinkedIn, Reddit and Signal' }).click();
  await F(dialog, 'X').fill('https://x.com/toluevents');
  await dialog.getByRole('button', { name: 'DJ Soulvee', exact: true }).click();
  await F(dialog, 'Tags').fill('wedding, corporate, wedding');
  await dialog.getByRole('button', { name: 'Save contact' }).click();
  await page.waitForSelector('div[role=dialog] >> text=Follow-ups');
  check('Saving a new contact opens it', (await dialog.innerText()).includes('Events manager · Eko Hotels'));
  const wa = await dialog.locator('a', { hasText: 'WhatsApp' }).getAttribute('href');
  check('WhatsApp link turns 0803… into 234803…', wa === 'https://wa.me/2348031234567', wa);
  check('Profile links for Instagram and X', await dialog.locator('a', { hasText: 'Instagram' }).getAttribute('href') === 'https://instagram.com/tolu.events' && await dialog.locator('a', { hasText: /^X$/ }).getAttribute('href') === 'https://x.com/toluevents');
  const saved = (await col('contacts'))[0];
  check('Tags are de-duplicated and brands saved', JSON.stringify(saved.tags) === '["wedding","corporate"]' && JSON.stringify(saved.brands) === '["dj"]', JSON.stringify([saved.tags, saved.brands]));

  /* --- 2. Follow-up and activity --- */
  const today = await page.evaluate(() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); });
  await dialog.getByLabel('New follow-up').fill('Send the wedding package');
  await dialog.getByLabel('Follow-up date').fill(today);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(150);
  await dialog.getByLabel('Activity type').selectOption('call');
  await dialog.getByLabel('What happened').fill('Called: wants a quote for 12 December');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const panel = await dialog.innerText();
  check('Follow-up shows in the contact', panel.includes('Send the wedding package'));
  check('Logged call shows on the timeline', panel.includes('Call') && panel.includes('Called: wants a quote for 12 December'));
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();

  /* --- 3. List, search and filters --- */
  const card = page.locator('main button', { hasText: 'Tolu Adeyemi' });
  check('Contact card shows the next follow-up', (await card.innerText()).includes('Next: Send the wedding package'));
  await page.getByLabel('Search contacts').fill('0803123');
  check('Search finds a contact by part of the phone number', await card.count() === 1);
  await page.getByLabel('Search contacts').fill('nobody here');
  check('A search with no match says so', (await main()).includes('Nobody matches'));
  await page.getByLabel('Search contacts').fill('');
  await page.locator('main button', { hasText: /^Customer$/ }).click();
  check('Stage filter hides a lead', await card.count() === 0);
  await page.locator('main button', { hasText: /^All$/ }).click();

  /* --- 4. Due follow-ups on Command, ticking one off --- */
  await tab('Command');
  const move = page.locator('main button', { hasText: 'Follow up: Send the wedding package' });
  check('Command lists follow-ups due today', (await move.innerText()).includes('Tolu Adeyemi') && (await move.innerText()).includes('due today'));
  await move.click();
  await page.waitForSelector('text=Follow-ups and reminders');
  check('A follow-up on Command opens CRM → Tasks', (await main()).toLowerCase().includes('today · 1'));
  check('The Tasks tab counts follow-ups due', (await main()).includes('Tasks · 1'));
  await page.getByLabel('Done: Send the wedding package').check();
  await page.waitForTimeout(200);
  check('Ticking a task moves it to Done recently', (await main()).toLowerCase().includes('done recently') && (await main()).includes('Nothing to follow up'));
  await page.locator('main button', { hasText: 'Tolu Adeyemi' }).first().click();
  check('A finished task appears on the timeline', (await dialog.innerText()).includes('Done') && (await dialog.innerText()).includes('Send the wedding package'));
  await page.keyboard.press('Escape');

  /* --- 5. Deals link to contacts --- */
  await sub('Pipeline');
  await page.getByRole('button', { name: '+ Deal' }).click();
  await F(dialog, 'Client').fill('Lagos Wedding Co');
  await F(dialog, 'Client email').fill('hello@lagoswedding.test');
  await F(dialog, 'Value (₦)').fill('800000');
  await dialog.getByRole('button', { name: 'Save deal' }).click();
  await page.waitForTimeout(200);
  let contacts = await col('contacts');
  const lwc = contacts.find(c => c.name === 'Lagos Wedding Co');
  const lwcDeal = (await col('deals')).find(d => d.client === 'Lagos Wedding Co');
  check('A deal for a new client adds them to contacts', !!lwc && lwc.email === 'hello@lagoswedding.test' && lwc.stage === 'lead');
  check('The deal is linked to that contact', lwcDeal && lwcDeal.contactId === lwc.id);
  await page.getByRole('button', { name: '+ Deal' }).click();
  await F(dialog, 'Client').fill('Eko Hotels — Christmas party');
  await F(dialog, 'Client email').fill('tolu@ekohotels.test');
  await F(dialog, 'Value (₦)').fill('1500000');
  await dialog.getByRole('button', { name: 'Save deal' }).click();
  await page.waitForTimeout(200);
  contacts = await col('contacts');
  const party = (await col('deals')).find(d => d.client.startsWith('Eko Hotels'));
  check('A deal with a known email links to the existing contact, without a duplicate', contacts.length === 2 && party.contactId === saved.id, contacts.map(c => c.name).join(','));
  const partyCard = page.locator('div.rounded-2xl', { has: page.locator('p.font-semibold', { hasText: 'Eko Hotels — Christmas party' }) }).last();
  check('A pipeline card names the contact when it differs from the client', (await partyCard.innerText()).includes('Tolu Adeyemi'));
  await partyCard.getByRole('button', { name: 'Contact' }).click();
  check('The contact button opens the contact, with open deals counted', (await dialog.innerText()).includes('₦1.5M') && (await dialog.innerText()).includes('Eko Hotels — Christmas party'));
  await page.keyboard.press('Escape');

  /* --- 6. Paid invoice makes a lead a customer --- */
  await partyCard.getByRole('button', { name: 'Won → Invoice' }).click();
  await dialog.getByRole('button', { name: 'Save invoice' }).click();
  await page.waitForTimeout(150);
  await tab('Money');
  const inv = page.locator('div.rounded-2xl', { has: page.locator('p', { hasText: /^INV-SMC-EKOHOTEL/ }) }).last();
  await inv.getByRole('button', { name: 'Mark sent' }).click();
  await inv.getByRole('button', { name: 'Mark paid' }).click();
  await F(dialog, 'Amount received').fill('600000');
  await dialog.getByRole('button', { name: 'Record part payment' }).click();
  await page.waitForTimeout(200);
  await tab('CRM');
  await sub('People');
  const tolu = page.locator('main button', { hasText: 'Tolu Adeyemi' });
  const toluText = await tolu.innerText();
  check('A contact who has paid shows as a customer, with paid and owed amounts', toluText.includes('Customer') && toluText.includes('₦600K') && toluText.includes('owed'), toluText.replace(/\n/g, ' | '));
  await tolu.click();
  const toluPanel = await dialog.innerText();
  check('The timeline lists the deal, invoice and payment', toluPanel.includes('Invoice') && toluPanel.includes('Payment') && toluPanel.includes('₦600,000 received by Moniepoint'));
  check('The invoice shows its balance in the contact', toluPanel.includes('due'));

  /* --- 7. AI summary --- */
  await script([{ blocks: [{ type: 'text', text: 'Tolu has paid ₦600,000 of the Christmas party invoice. Next: chase the balance on Friday.' }], stop_reason: 'end_turn' }]);
  await dialog.getByRole('button', { name: '✦ Summary and next step' }).click();
  await page.waitForSelector('text=chase the balance on Friday');
  const sent = (await claudeLog()).slice(-1)[0].body;
  const prompt = sent.messages[0].content;
  const promptText = typeof prompt === 'string' ? prompt : prompt.map(p => p.text).join('');
  check('The summary prompt carries the real numbers and timeline', promptText.includes('paid ₦600,000') && promptText.includes('Called: wants a quote for 12 December') && promptText.includes('Eko Hotels — Christmas party'));
  await page.keyboard.press('Escape');

  /* --- 8. CSV import --- */
  const csv = [
    'First Name,Last Name,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Value,Organization Name,Labels,Notes',
    'Ada,Obi,* Home,ada@obi.test,+234 805 000 1111,Obi Events,Wedding ::: VIP,"Met at the ""Lekki"" show, loves highlife"',
    'Tolu,Adeyemi,,tolu@ekohotels.test,,,Repeat,',
    'Ada,Obi,,ada@obi.test,,,,',
    'Chidi,,,,08099990000,,,',
  ].join('\n');
  fs.writeFileSync(OUT + '/contacts.csv', csv);
  await page.getByRole('button', { name: 'Import' }).click();
  await dialog.getByLabel('CSV file').setInputFiles(OUT + '/contacts.csv');
  await page.waitForSelector('text=to update');
  const plan = await dialog.innerText();
  check('Import preview counts new, updated and repeated rows', plan.includes('2 new') && plan.includes('1 to update') && plan.includes('1 already up to date or repeated'), plan.replace(/\n/g, ' | '));
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  check('Import confirms what changed', (await toast()).includes('Imported 2 new contacts, updated 1'));
  contacts = await col('contacts');
  const ada = contacts.find(c => c.name === 'Ada Obi');
  check('Google Contacts columns map to name, email, phone, company, tags and notes', ada && ada.email === 'ada@obi.test' && ada.phone === '+234 805 000 1111' && ada.company === 'Obi Events' && JSON.stringify(ada.tags) === '["Wedding","VIP"]' && ada.notes.includes('"Lekki"'), JSON.stringify(ada));
  check('A matched contact gains the new tag without losing details', JSON.stringify(contacts.find(c => c.id === saved.id).tags) === '["wedding","corporate","Repeat"]');
  check('A row with only a phone becomes a contact', contacts.some(c => c.name === 'Chidi' && c.phone === '08099990000'));

  /* --- 9. CSV export --- */
  await page.evaluate(id => { const s = JSON.parse(localStorage.getItem('soulvee-os:v1')); s.collections.contacts[id].notes = '=HYPERLINK("http://evil.test")'; localStorage.setItem('soulvee-os:v1', JSON.stringify(s)); window.dispatchEvent(new StorageEvent('storage', { key: 'soulvee-os:v1' })); }, ada.id);
  await page.waitForTimeout(200);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  const out = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
  const lines = out.split('\r\n');
  check('Export has a header row and one row per contact', lines[0].startsWith('name,company,role,email,phone,whatsapp') && lines.length === contacts.length + 1, lines.length + ' lines');
  check('A formula in a cell is neutralised; phone numbers are left as they are', out.includes(`"'=HYPERLINK(""http://evil.test"")"`) && out.includes('+234 805 000 1111'));
  fs.writeFileSync(OUT + '/export.csv', out);
  await page.getByRole('button', { name: 'Import' }).click();
  await dialog.getByLabel('CSV file').setInputFiles(OUT + '/export.csv');
  await page.waitForSelector('text=to update');
  const again = await dialog.innerText();
  check('Re-importing the export finds nothing new', again.includes('0 new') && again.includes('0 to update') && await dialog.getByRole('button', { name: 'Import', exact: true }).isDisabled(), again.replace(/\n/g, ' | '));
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  /* --- 10. Clients from older deals and invoices --- */
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('soulvee-os:v1')); s.collections.deals.legacy = { id: 'legacy', client: 'Old Client Ltd', email: 'old@client.test', brand: 'smc', stage: 'won', value: 300000, createdAt: '2026-01-05T10:00:00.000Z' }; localStorage.setItem('soulvee-os:v1', JSON.stringify(s)); window.dispatchEvent(new StorageEvent('storage', { key: 'soulvee-os:v1' })); });
  await page.waitForSelector("text=isn't in your contacts yet");
  await page.getByRole('button', { name: 'Add it' }).click();
  await page.waitForTimeout(200);
  const old = (await col('contacts')).find(c => c.name === 'Old Client Ltd');
  check('A client from an older won deal is added as a customer', old && old.stage === 'customer' && old.email === 'old@client.test');
  check('The banner goes once every client is a contact', !(await main()).includes("in your contacts yet"));

  /* --- 11. The agent's CRM tools --- */
  await tab('AI Agent');
  await script([
    { blocks: [{ type: 'tool_use', name: 'search_contacts', input: { query: 'eko' } }, { type: 'tool_use', name: 'get_contact', input: { contact: 'tolu' } }], stop_reason: 'tool_use' },
    { blocks: [{ type: 'tool_use', name: 'create_task', input: { title: 'Chase Christmas party balance', contact: 'Tolu Adeyemi', due: '2026-12-01', priority: 'high' } }, { type: 'tool_use', name: 'log_activity', input: { contact: 'ada@obi.test', type: 'message', text: 'Sent the highlife set list' } }, { type: 'tool_use', name: 'create_contact', input: { name: 'ada obi' } }], stop_reason: 'tool_use' },
    { blocks: [{ type: 'text', text: 'Done: task added for Tolu, message logged for Ada.' }], stop_reason: 'end_turn' },
  ]);
  await page.locator('form textarea').fill('Who at Eko owes us money? Add a follow-up and log the Ada message.');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=task added for Tolu');
  const reqs = await claudeLog();
  const turn2 = reqs[reqs.length - 2].body.messages.slice(-1)[0].content;
  const found = JSON.parse(turn2.find(b => b.type === 'tool_result' && b.content.includes('Tolu')).content);
  check('search_contacts finds contacts by company', Array.isArray(found) && found.some(c => c.name === 'Tolu Adeyemi' && c.owed > 0), JSON.stringify(found).slice(0, 200));
  const detail = JSON.parse(turn2[1].content);
  check('get_contact returns deals, invoices with balances and the timeline', detail.name === 'Tolu Adeyemi' && detail.invoices.length === 1 && detail.invoices[0].balance > 0 && detail.timeline.some(t => t.what === 'Call'), JSON.stringify(detail).slice(0, 200));
  const turn3 = reqs[reqs.length - 1].body.messages.slice(-1)[0].content;
  check('create_contact refuses a duplicate', turn3[2].content.includes('already in the CRM'));
  const tasks = await col('tasks');
  check('create_task adds a linked, high-priority task', tasks.some(t => t.title === 'Chase Christmas party balance' && t.contactId === saved.id && t.priority === 'high' && t.due === '2026-12-01'));
  check('log_activity logs on the contact found by email', (await col('activities')).some(a => a.contactId === ada.id && a.type === 'message' && a.text === 'Sent the highlife set list'));
  check('The agent says what it did', (await main()).includes('Added task: Chase Christmas party balance') && (await main()).includes('Logged message for Ada Obi'));

  /* --- 12. Old links, delete, phone layout --- */
  await page.goto(BASE + '/#pipeline', { waitUntil: 'load' });
  await page.waitForSelector('text=Every gig, consult and product sale on one board.');
  check('Old #pipeline links open CRM → Pipeline', (await page.locator('nav [data-active="true"]').innerText()).includes('CRM'));
  await sub('People');
  await page.locator('main button', { hasText: 'Ada Obi' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(250);
  check('Deleting a contact removes their activities and tasks', !(await col('contacts')).some(c => c.id === ada.id) && !(await col('activities')).some(a => a.contactId === ada.id));
  check('Deals stay when a contact is deleted', (await col('deals')).length === 3);
  await page.screenshot({ path: OUT + '/crm-people.png' });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(BASE + '/', { waitUntil: 'load' });
  await pp.evaluate(s => localStorage.setItem('soulvee-os:v1', s), await page.evaluate(() => localStorage.getItem('soulvee-os:v1')));
  await pp.goto(BASE + '/#crm', { waitUntil: 'load' });
  await pp.reload({ waitUntil: 'load' });
  await pp.waitForSelector('text=Tolu Adeyemi');
  await pp.screenshot({ path: OUT + '/crm-mobile.png' });
  check('CRM fits a phone screen', !(await pp.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > screen.width + 1)));
  await pp.locator('main button', { hasText: 'Tolu Adeyemi' }).click();
  await pp.waitForTimeout(200);
  await pp.screenshot({ path: OUT + '/crm-contact-mobile.png' });
  const box = await pp.evaluate(() => { const d = document.querySelector('div[role=dialog] > div').getBoundingClientRect(); return { left: d.left, right: d.right, width: innerWidth, inner: document.querySelector('div[role=dialog] > div').scrollWidth - document.querySelector('div[role=dialog] > div').clientWidth }; });
  check('A contact fits a phone screen', box.left >= 0 && box.right <= box.width + 0.5 && box.inner <= 1, JSON.stringify(box));
  await phone.close();

  check('No console or page errors', errs.length === 0, errs.join(' || '));
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async e => { console.error(e); if (shared.page) await shared.page.screenshot({ path: OUT + '/crash.png' }).catch(() => {}); process.exit(2); });
