// Server-side test of connected accounts, publishing to them, the inbox and webhooks, against the
// platform stand-ins (stand-ins/platforms.js on 8792). Server under test: http://localhost:8790.
// Run it with: node test/run.js accounts-api
const crypto = require('node:crypto');
const BASE = 'http://localhost:8790';
const M = 'http://127.0.0.1:8792';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  — ' + extra : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (method, path, body, headers = {}) => { const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const mock = async (path, body) => (await fetch(M + path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json();
const mockLog = () => mock('/__log');
const TG = '123456789:NOT-A-REAL-TOKEN_soulvee-os-tests-only';
const WA_TOKEN = 'WA-TOKEN-' + 'x'.repeat(30);

// Follows a sign-in the way a browser would: Soulvee OS → platform sign-in → back to Soulvee OS.
async function signIn(provider) {
  const start = await api('POST', `/api/accounts/oauth/${provider}`);
  if (!start.body || !start.body.url) return { error: JSON.stringify(start.body) };
  const auth = await fetch(start.body.url, { redirect: 'manual' });
  const back = auth.headers.get('location') || '';
  const done = await fetch(back, { redirect: 'manual' });
  return { url: start.body.url, back, final: done.headers.get('location') || '' };
}

(async () => {
  await mock('/__reset', {});
  const list = async () => (await api('GET', '/api/accounts')).body;

  /* --- Telegram --- */
  let r = await api('POST', '/api/accounts/connect/telegram', { token: 'not-a-token' });
  check('A malformed bot token is refused with a hint', r.status === 400 && /BotFather/.test(r.body.error.message));
  r = await api('POST', '/api/accounts/connect/telegram', { token: TG, chats: '@notadmin' });
  check('A channel where the bot is not an admin is explained', r.status === 400 && /admin of "Not Admin Channel"/.test(r.body.error.message), JSON.stringify(r.body));
  r = await api('POST', '/api/accounts/connect/telegram', { token: TG, chats: '@soulveemusic, https://t.me/soulveeplus' });
  const tg = r.body.accounts || [];
  check('One bot connects with two channels', r.status === 200 && tg.length === 3 && tg.filter(a => a.kind === 'channel').length === 2 && tg[0].kind === 'bot', JSON.stringify(tg.map(a => [a.kind, a.name])));
  const tgBot = tg.find(a => a.kind === 'bot');
  const tgMusic = tg.find(a => a.name === 'Soulvee Music');
  r = await api('POST', '/api/accounts/connect/telegram', { via: tgBot.id, chats: '@soulveeplus' });
  check('Adding a channel to a connected bot reuses its token and keeps the same accounts', r.status === 200 && (await list()).accounts.filter(a => a.provider === 'telegram').length === 3);

  /* --- Meta: pasted token, OAuth --- */
  r = await api('POST', '/api/accounts/connect/meta', { token: 'PASTED-USER-TOKEN-0123456789' });
  const meta = r.body.accounts || [];
  check('One Meta sign-in brings in three Pages and two Instagram accounts', meta.filter(a => a.provider === 'facebook').length === 3 && meta.filter(a => a.provider === 'instagram').length === 2, JSON.stringify(meta.map(a => a.name)));
  const page1 = meta.find(a => a.externalId === 'p1');
  const ig1 = meta.find(a => a.externalId === 'ig1');
  check('Instagram accounts know their linked Page', ig1 && ig1.meta.pageId === 'p1' && ig1.handle === '@djsoulvee');
  r = await api('POST', '/api/accounts/connect/meta', { token: 'PAGE2-LONG-TOKEN-0123456789' });
  check('A pasted Page token connects that one Page, keeping its id', r.status === 200 && r.body.accounts.length === 1 && r.body.accounts[0].id === meta.find(a => a.externalId === 'p2').id);
  let flow = await signIn('meta');
  check('Facebook sign-in returns to Accounts with what was connected', /\?connected=meta&count=5#accounts$/.test(flow.final), flow.final || flow.error);
  check('The Facebook sign-in asks for Page and Instagram permissions', /pages_manage_posts/.test(decodeURIComponent(flow.url)) && /instagram_content_publish/.test(decodeURIComponent(flow.url)) && flow.url.includes(encodeURIComponent('http://localhost:8790/oauth/callback/meta')));
  check('Reconnecting does not duplicate accounts', (await list()).accounts.filter(a => ['facebook', 'instagram'].includes(a.provider)).length === 5);

  /* --- Threads, X, LinkedIn, Gmail sign-ins --- */
  flow = await signIn('threads');
  check('Threads sign-in connects the profile', /connected=threads&count=1/.test(flow.final), flow.final || flow.error);
  flow = await signIn('x');
  check('X sign-in uses PKCE and connects the profile', /code_challenge=/.test(flow.url) && /connected=x&count=1/.test(flow.final), flow.final || flow.error);
  flow = await signIn('linkedin');
  check('LinkedIn sign-in connects the profile and the company page', /connected=linkedin&count=2/.test(flow.final), flow.final || flow.error);
  flow = await signIn('gmail');
  check('Gmail sign-in connects the mailbox', /connected=gmail&count=1/.test(flow.final), flow.final || flow.error);
  await sleep(1600);
  check('Gmail: the short-lived sign-in is refreshed before mail is checked', (await mockLog()).some(c => c.path === '/google/token' && c.body.grant_type === 'refresh_token') && (await mockLog()).some(c => c.path === '/google/gmail/v1/users/me/messages'));
  const replay = await fetch(flow.back, { redirect: 'manual' });
  check('A sign-in link cannot be used twice', /connect_error=/.test(replay.headers.get('location') || ''));
  const stolen = await fetch(BASE + '/oauth/callback/x?code=abc&state=forged', { redirect: 'manual' });
  check('A forged sign-in return is refused', /connect_error=/.test(stolen.headers.get('location') || ''));

  /* --- WhatsApp, Reddit, Signal --- */
  r = await api('POST', '/api/accounts/connect/whatsapp', { token: WA_TOKEN, phoneNumberId: '+234 803 000 0000', appSecret: 'wa-app-secret' });
  check('Typing the phone number instead of its ID is explained', r.status === 400 && /phone number ID/.test(r.body.error.message));
  r = await api('POST', '/api/accounts/connect/whatsapp', { token: WA_TOKEN, phoneNumberId: '106540352242922', appSecret: 'wa-app-secret' });
  const wa = (r.body.accounts || [])[0];
  check('A WhatsApp number connects', wa && wa.name === 'Soulveetainment' && wa.handle === '+234 803 000 0000', JSON.stringify(r.body));
  r = await api('POST', '/api/accounts/connect/reddit', { clientId: 'rdclient', clientSecret: 'rdsecret', username: 'u/djsoulvee', password: 'wrong' });
  check('Wrong Reddit details are explained', r.status === 400 && /rejected those details/.test(r.body.error.message));
  r = await api('POST', '/api/accounts/connect/reddit', { clientId: 'rdclient', clientSecret: 'rdsecret', username: 'u/djsoulvee', password: 'right-password', subreddit: 'r/afrobeats' });
  const rd = (r.body.accounts || [])[0];
  check('A Reddit account connects with a default subreddit', rd && rd.name === 'u/djsoulvee' && rd.options.subreddit === 'afrobeats', JSON.stringify(r.body));
  r = await api('POST', '/api/accounts/connect/signal', { url: M + '/signal', number: '+234 803 111 0000' });
  const sig = (r.body.accounts || [])[0];
  check('A Signal number on the bridge connects', sig && sig.externalId === '+2348031110000', JSON.stringify(r.body));
  r = await api('POST', '/api/accounts/connect/signal', { url: M + '/signal', number: '+2348099999999' });
  check('A number not on the bridge is explained', r.status === 400 && /isn't registered/.test(r.body.error.message));

  /* --- Secrets stay on the server --- */
  const all = await list();
  const text = JSON.stringify(all);
  const leak = text.match(/PAGE1|PAGE2-LONG|X-ACCESS|X-REFRESH|TH-LONG|LI-TOKEN|G-ACCESS|G-REFRESH|RD-TOKEN|right-password|rdsecret|wa-app-secret|WA-TOKEN|NOT-A-REAL-TOKEN/);
  check('No token, password or secret is sent to the browser', !leak && all.accounts.every(a => !('secret' in a)), leak ? leak[0] : '');
  const linked = all.accounts;
  const by = (prov, kind) => linked.find(a => a.provider === prov && (!kind || a.kind === kind));
  const th = by('threads'); const x = by('x'); const liMe = by('linkedin', 'profile'); const liOrg = by('linkedin', 'organization'); const gm = by('gmail');
  check('The accounts list explains each platform and the webhook address', all.providers.length === 10 && all.providers.find(p => p.id === 'whatsapp').webhook.url === BASE + '/webhooks/meta' && all.providers.find(p => p.id === 'tiktok').viaBuffer);
  check('Buffer channels appear alongside, ready to post to', all.buffer.length >= 1 && all.buffer.every(b => b.id.startsWith('buffer:')), JSON.stringify(all.buffer.slice(0, 2)));

  /* --- Publish now to many accounts --- */
  await mock('/__reset', {});
  const media = [{ type: 'image', url: M + '/media/flyer.jpg' }];
  const post = { id: 'post1', brand: 'dj', title: 'Friday night', text: 'Friday night at Quilox (11pm) — #afrobeats #lagos', media, platforms: ['instagram'], targets: [page1.id, ig1.id, th.id, x.id, liMe.id, liOrg.id, tgMusic.id, rd.id] };
  r = await api('POST', '/api/social/publish', { post, target: 'accounts' });
  const res = (r.body && r.body.results) || [];
  check('Posting now reaches all eight accounts', res.length === 8 && res.every(x => x.status === 'sent'), JSON.stringify(res.length ? res.map(x => [x.provider, x.status, x.error]) : r.body));
  check('Each result links to the live post', res.find(x => x.provider === 'instagram').url.startsWith('https://www.instagram.com/p/') && res.find(x => x.provider === 'x').url.startsWith('https://x.com/djsoulvee/status/') && res.find(x => x.provider === 'telegram').url.startsWith('https://t.me/soulveemusic/') && res.find(x => x.provider === 'threads').url.includes('threads.net'));
  const L = await mockLog();
  const calls = p => L.filter(c => c.path.includes(p));
  const feed = calls('/p1/feed')[0].body;
  check('Facebook: the photo is uploaded unpublished, then attached to one Page post', calls('/p1/photos').length === 1 && calls('/p1/photos')[0].body.published === false && calls('/p1/photos')[0].body.url === media[0].url && Array.isArray(feed.attached_media) && feed.attached_media.length === 1 && /^photo\d+$/.test(feed.attached_media[0].media_fbid) && feed.message === post.text, JSON.stringify(feed));
  check('X: the short-lived sign-in was refreshed before posting', L.some(c => c.path === '/x/2/oauth2/token' && c.body.grant_type === 'refresh_token' && c.body.refresh_token === 'X-REFRESH'));
  check('Instagram: container, then publish, then permalink', calls('/ig1/media')[0].body.image_url === media[0].url && calls('/ig1/media')[0].body.caption === post.text && calls('/ig1/media_publish').length === 1);
  check('Threads: an image container, then publish', calls('/th1/threads')[0].body.media_type === 'IMAGE' && calls('/th1/threads_publish').length === 1);
  check('X: the image is uploaded as multipart, then attached to the post', /bytes>$/.test(calls('/x/2/media/upload')[0].body.media) && calls('/x/2/media/upload')[0].body.media_category === 'tweet_image' && calls('/x/2/tweets')[0].body.media.media_ids.length === 1);
  const liPosts = calls('/linkedin/rest/posts');
  check('LinkedIn: image uploaded, post sent with a version header, as person and company', calls('/linkedin/upload/').length === 2 && liPosts.length === 2 && liPosts.every(c => /^\d{6}$/.test(c.headers['linkedin-version'])) && liPosts.some(c => c.body.author === 'urn:li:organization:555'));
  check('LinkedIn: brackets are escaped and hashtags stay clickable', liPosts[0].body.commentary === 'Friday night at Quilox \\(11pm\\) — {hashtag|\\#|afrobeats} {hashtag|\\#|lagos}', liPosts[0].body.commentary);
  check('Telegram: a photo with the caption', calls('/sendPhoto')[0].body.caption === post.text && calls('/sendPhoto')[0].body.chat_id === -1001111);
  check('Reddit: a link post to the default subreddit with the title', calls('/reddit/api/submit')[0].body.sr === 'afrobeats' && calls('/reddit/api/submit')[0].body.title === 'Friday night' && calls('/reddit/api/submit')[0].body.kind === 'link');

  /* --- Problems that waiting won't fix fail at once; scheduled posts go out on time --- */
  r = await api('POST', '/api/social/publish', { post: { ...post, id: 'long', text: 'x'.repeat(300), media: [], targets: [x.id] }, target: 'accounts' });
  check('Too long for X fails straight away without retrying', r.body.results[0].status === 'failed' && /280/.test(r.body.results[0].error) && r.body.results[0].attempts === 1);
  r = await api('POST', '/api/social/publish', { post: { ...post, id: 'ig-text', media: [], targets: [ig1.id] }, target: 'accounts' });
  check('Instagram without an image says so', r.body.results[0].status === 'failed' && /needs an image or video/.test(r.body.results[0].error));
  r = await api('POST', '/api/social/publish', { post: { ...post, id: 'sub', media: [], subreddit: 'nosuchsub', targets: [rd.id] }, target: 'accounts' });
  check("A subreddit Reddit doesn't know is reported", r.body.results[0].status === 'failed' && /doesn't exist/.test(r.body.results[0].error));
  const soon = new Date(Date.now() + 2500).toISOString();
  r = await api('POST', '/api/social/publish', { post: { ...post, id: 'sched', text: 'Scheduled for Telegram', media: [], scheduledAt: soon, targets: [tgMusic.id] }, target: 'accounts' });
  const job = r.body.results[0];
  check('A scheduled post is queued, not sent', job.status === 'scheduled' && job.runAt === soon);
  await sleep(4500);
  const jobs = (await api('GET', '/api/social/jobs?ids=' + job.id)).body.jobs;
  check('The queued post goes out at its time', jobs[0].status === 'sent' && jobs[0].url.startsWith('https://t.me/soulveemusic/'), JSON.stringify(jobs));

  /* --- Tokens are refreshed before they run out --- */
  const fs = require('node:fs');
  const file = require('node:path').join(process.env.SOULVEE_TEST_DATA, 'accounts.json'); // the runner says where the server keeps its data
  // Windows doesn't use these permission bits, so the two file checks run on Mac and Linux only.
  const unix = process.platform !== 'win32';
  if (unix) check('Accounts file is readable only by its owner', (fs.statSync(file).mode & 0o777) === 0o600, (fs.statSync(file).mode & 0o777).toString(8));
  r = await api('PATCH', '/api/accounts/' + x.id, { label: 'DJ on X', brands: ['dj', 'nonsense'] });
  check('An account can be labelled and given brands (unknown brands dropped)', r.body.account.label === 'DJ on X' && JSON.stringify(r.body.account.brands) === '["dj"]');

  /* --- Inbox: first check brings in what's there quietly, then new messages count as unread --- */
  await api('POST', '/api/inbox/sync');
  await mock('/__push/telegram', { fromId: 4242, first: 'Kemi', last: 'Ade', username: 'kemi_ade', text: 'Hi, are you free on 20 Dec?' });
  await mock('/__push/messenger', { convo: 't_100', page: 'p1', participant: { id: 'psid-9', name: 'Bayo Events' }, text: 'Price for a 4-hour set?' });
  await mock('/__push/instagram', { convo: 'ig_200', page: 'p1', ig: 'ig1', participant: { id: 'igsid-5', username: 'lola.weds' }, text: 'Love your mixes! Wedding in March?' });
  await mock('/__push/reddit', { author: 'beatfan', subject: 'Collab', body: 'Want to collab on a remix?' });
  await mock('/__push/gmail', { from: 'Ada Obi <ada@obi.test>', subject: 'Corporate party', body: 'Can you send your rate card?' });
  await mock('/__push/signal', { from: '+2348055551234', name: 'Tunde', text: 'Signal check — call me' });
  r = await api('POST', '/api/inbox/sync');
  const convos = r.body.conversations;
  const find = p => convos.find(c => c.provider === p);
  check('Messages from six platforms land in one inbox', ['telegram', 'facebook', 'instagram', 'reddit', 'gmail', 'signal'].every(p => find(p)), JSON.stringify(convos.map(c => c.provider)));
  check('Each conversation knows who it is with', find('telegram').peer.name === 'Kemi Ade' && find('telegram').peer.handle === '@kemi_ade' && find('facebook').peer.name === 'Bayo Events' && find('instagram').peer.handle === '@lola.weds' && find('gmail').peer.email === 'ada@obi.test' && find('signal').peer.phone === '+2348055551234');
  check('New messages count as unread', r.body.unread >= 6 && convos.every(c => c.unread >= 1));
  check('Gmail keeps the subject and drops the quoted earlier email', find('gmail').subject === 'Corporate party' && find('gmail').lastText === 'Can you send your rate card?', find('gmail').lastText);
  r = await api('POST', '/api/inbox/sync');
  check('Checking again adds nothing twice', r.body.added === 0 && r.body.unread === convos.reduce((a, c) => a + c.unread, 0));

  /* --- Replies go out through the right account --- */
  await mock('/__reset', {});
  const reply = async (c, text, extra = {}) => api('POST', `/api/inbox/c/${encodeURIComponent(c.key)}/reply`, { text, ...extra });
  r = await reply(find('telegram'), 'Yes! Sending details now.');
  check('Telegram reply', r.status === 200 && r.body.conversation.unread === 0 && r.body.conversation.messages.slice(-1)[0].dir === 'out');
  r = await reply(find('facebook'), 'A 4-hour set is ₦1.2M.');
  check('Messenger reply as a RESPONSE to the customer', r.status === 200);
  r = await reply(find('instagram'), 'Thank you! DM me the date.');
  check('Instagram reply through the Page', r.status === 200);
  r = await reply(find('reddit'), "Let's do it.");
  check('Reddit reply to the private message', r.status === 200);
  r = await reply(find('gmail'), 'Rate card attached in the next email.');
  check('Gmail reply', r.status === 200, JSON.stringify(r.body));
  r = await reply(find('signal'), 'Calling you now.');
  check('Signal reply through the bridge', r.status === 200);
  const L2 = await mockLog();
  const c2 = p => L2.filter(c => c.path.includes(p));
  check('Telegram reply goes to the chat', c2('/sendMessage')[0].body.chat_id === '4242');
  check('Messenger reply is tagged as a response', c2('/p1/messages').some(c => c.body.recipient.id === 'psid-9' && c.body.messaging_type === 'RESPONSE'));
  check('Instagram reply goes to the Instagram user', c2('/p1/messages').some(c => c.body.recipient.id === 'igsid-5'));
  check('Reddit reply answers the message by its id', /^t4_/.test(c2('/reddit/api/comment')[0].body.thing_id));
  check('Signal reply sends from the connected number', c2('/signal/v2/send')[0].body.number === '+2348031110000' && c2('/signal/v2/send')[0].body.recipients[0] === '+2348055551234');
  const mail = (await mock('/__sent-mail'))[0];
  check('The Gmail reply stays in the thread', mail && /In-Reply-To: <msg\d+@mail.gmail.com>/.test(mail.raw) && /To: ada@obi.test/.test(mail.raw) && /Rate card attached/.test(mail.raw), mail && mail.raw.slice(0, 300));

  /* --- WhatsApp webhook --- */
  const info = (await list()).providers.find(p => p.id === 'whatsapp').webhook;
  const verify = await fetch(`${BASE}/webhooks/meta?hub.mode=subscribe&hub.verify_token=${info.verifyToken}&hub.challenge=8675309`);
  check("Meta's webhook check is answered with the challenge", verify.status === 200 && (await verify.text()) === '8675309');
  const wrong = await fetch(`${BASE}/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
  check('A wrong verify token is refused', wrong.status === 403);
  const delivery = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '2348030000000', phone_number_id: '106540352242922' }, contacts: [{ profile: { name: 'Ngozi' }, wa_id: '2348061234567' }], messages: [{ from: '2348061234567', id: 'wamid.IN1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Hello, I want to book for my birthday' } }] } }] }] });
  const forged = await fetch(BASE + '/webhooks/meta', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) }, body: delivery });
  check('A webhook call with a bad signature is refused', forged.status === 401);
  const signed = await fetch(BASE + '/webhooks/meta', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'metasecret').update(delivery).digest('hex') }, body: delivery });
  await sleep(300);
  const inbox = (await api('GET', '/api/inbox')).body;
  const waConvo = inbox.conversations.find(c => c.provider === 'whatsapp');
  check('A signed WhatsApp message lands in the inbox', signed.status === 200 && waConvo && waConvo.peer.name === 'Ngozi' && waConvo.peer.phone === '+2348061234567' && waConvo.unread === 1);
  const signed2 = await fetch(BASE + '/webhooks/meta', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'wa-app-secret').update(delivery).digest('hex') }, body: delivery });
  await sleep(200);
  check("The account's own app secret also works, and a repeated delivery isn't added twice", signed2.status === 200 && (await api('GET', '/api/inbox')).body.conversations.find(c => c.provider === 'whatsapp').count === 1);
  r = await reply(waConvo, 'Happy birthday! What date?');
  check('WhatsApp reply', r.status === 200);
  const late = { ...waConvo, key: waConvo.key.replace('2348061234567', '2348000000999') };
  const lateDelivery = delivery.replace(/2348061234567/g, '2348000000999').replace('wamid.IN1', 'wamid.IN2');
  await fetch(BASE + '/webhooks/meta', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'metasecret').update(lateDelivery).digest('hex') }, body: lateDelivery });
  await sleep(200);
  r = await reply(late, 'Are you still interested?');
  check('Outside the 24-hour window WhatsApp asks for a template, in plain words', r.status === 400 && /approved template/.test(r.body.error.message), JSON.stringify(r.body));
  r = await reply(late, '', { template: { name: 'follow_up', language: 'en' } });
  check('A template message can be sent instead', r.status === 200 && r.body.conversation.messages.slice(-1)[0].text === 'Template: follow_up');
  const status = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba1', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '106540352242922' }, statuses: [{ id: r.body.conversation.messages.slice(-1)[0].id, status: 'read', timestamp: '1', recipient_id: '2348000000999' }] } }] }] });
  await fetch(BASE + '/webhooks/meta', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'metasecret').update(status).digest('hex') }, body: status });
  await sleep(200);
  const readBack = (await api('GET', `/api/inbox/c/${encodeURIComponent(late.key)}`)).body.conversation;
  check('Delivery updates mark the message as read', readBack.messages.slice(-1)[0].status === 'read');

  /* --- Switching off, removing, and locks --- */
  r = await api('PATCH', '/api/accounts/' + tgMusic.id, { enabled: false });
  r = await api('POST', '/api/social/publish', { post: { ...post, id: 'off', media: [], targets: [tgMusic.id] }, target: 'accounts' });
  check('A switched-off account is not posted to', r.body.results[0].ok === false && /switched off/.test(r.body.results[0].message));
  r = await api('POST', `/api/accounts/${sig.id}/test`);
  check('Test checks an account is still connected', r.status === 200 && r.body.account.status === 'ok');
  r = await api('DELETE', '/api/accounts/' + sig.id);
  check('Removing an account forgets its conversations', r.status === 200 && !(await api('GET', '/api/inbox')).body.conversations.some(c => c.provider === 'signal'));
  const remote = { 'x-forwarded-for': '203.0.113.7' };
  check('Accounts and the inbox are locked to other devices without a token', (await api('GET', '/api/accounts', undefined, remote)).status === 403 && (await api('GET', '/api/inbox', undefined, remote)).status === 403 && (await api('POST', '/api/accounts/connect/telegram', { token: TG }, remote)).status === 403);
  const cb = await fetch(BASE + '/oauth/callback/x?code=a&state=b', { redirect: 'manual', headers: remote });
  check('A sign-in return from another device is refused', /connect_error=/.test(cb.headers.get('location') || ''));
  const inboxFile = file.replace('accounts.json', 'inbox.json');
  if (unix) check('The inbox file is readable only by its owner', (fs.statSync(inboxFile).mode & 0o777) === 0o600);

  const failed = results.filter(x => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
