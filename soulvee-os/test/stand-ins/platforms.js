// Stand-ins for the platform APIs Soulvee OS connects to, speaking each one's real request and
// response shapes: Telegram Bot API, Meta Graph (Pages, Instagram, Messenger, WhatsApp), Threads,
// X API v2 (OAuth 2.0 PKCE, media upload, posts), LinkedIn (OAuth, Images, Posts), Reddit (script
// app), Gmail API with Google OAuth, and the signal-cli-rest-api bridge.
//   GET  /__log            every request received
//   POST /__reset          clear the log and pushed messages
//   POST /__push/<kind>    add incoming messages: telegram | messenger | instagram | reddit | gmail | signal
// Started by test/run.js as: node stand-ins/platforms.js <port> <sample.jpg>
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const port = Number(process.argv[2] || 8792);
const jpg = fs.readFileSync(process.argv[3]);
const ME = `http://127.0.0.1:${port}`;

const log = [];
const s = { n: 0, tg: [], tgId: 100, convos: { messenger: {}, instagram: {} }, reddit: [], gmail: {}, signal: [], codes: {}, igStatus: {}, sentMail: [] };
const id = p => `${p}${++s.n}`;
const read = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const redirect = (res, to) => { res.writeHead(302, { location: to }); res.end(); };
const parseBody = (req, raw) => {
  const type = String(req.headers['content-type'] || '');
  const text = raw.toString('utf8');
  if (type.includes('application/json')) { try { return JSON.parse(text || '{}'); } catch { return { _bad: text }; } }
  if (type.includes('x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  if (type.includes('multipart/form-data')) {
    const fields = {};
    for (const part of text.split(/--[-\w]+/)) {
      const m = part.match(/name="([^"]+)"(?:; filename="[^"]*")?\r\n(?:Content-Type: ([^\r\n]+)\r\n)?\r\n([\s\S]*)\r\n$/);
      if (m) fields[m[1]] = m[2] ? `<${m[2]} ${Buffer.byteLength(m[3])} bytes>` : m[3];
    }
    return fields;
  }
  return text ? { _raw: text.slice(0, 200) } : {};
};
const bearer = req => String(req.headers.authorization || '').replace(/^bearer /i, '');

/* ---------- Telegram ---------- */
const TG_TOKEN = '123456789:NOT-A-REAL-TOKEN_soulvee-os-tests-only';
const CHATS = {
  '@soulveemusic': { id: -1001111, type: 'channel', title: 'Soulvee Music', username: 'soulveemusic', admin: true },
  '@soulveeplus': { id: -1002222, type: 'channel', title: 'Soulvee Plus', username: 'soulveeplus', admin: true },
  '@notadmin': { id: -1003333, type: 'channel', title: 'Not Admin Channel', username: 'notadmin', admin: false },
};
function telegram(res, token, method, b) {
  const ok = result => send(res, 200, { ok: true, result });
  const bad = (code, description) => send(res, code, { ok: false, error_code: code, description });
  if (token !== TG_TOKEN) return bad(401, 'Unauthorized');
  const chat = v => CHATS[String(v)] || Object.values(CHATS).find(c => String(c.id) === String(v));
  if (method === 'getMe') return ok({ id: 777, is_bot: true, first_name: 'Soulvee Bot', username: 'soulvee_bot' });
  if (method === 'getChat') { const c = chat(b.chat_id); return c ? ok({ id: c.id, type: c.type, title: c.title, username: c.username }) : bad(400, 'Bad Request: chat not found'); }
  if (method === 'getChatMember') { const c = chat(b.chat_id); return ok(c && c.admin ? { status: 'administrator', can_post_messages: true, user: { id: 777 } } : { status: 'member', user: { id: 777 } }); }
  if (['sendMessage', 'sendPhoto', 'sendVideo'].includes(method)) {
    if (method === 'sendMessage' && String(b.text || '').length > 4096) return bad(400, 'Bad Request: message is too long');
    return ok({ message_id: ++s.tgId, chat: { id: Number(b.chat_id) }, date: Math.floor(Date.now() / 1000), text: b.text, caption: b.caption });
  }
  if (method === 'sendMediaGroup') return ok((b.media || []).map(() => ({ message_id: ++s.tgId, chat: { id: Number(b.chat_id) }, date: Math.floor(Date.now() / 1000) })));
  if (method === 'getUpdates') return ok(s.tg.filter(u => !b.offset || u.update_id >= b.offset));
  return bad(404, 'Not Found: method not found');
}

/* ---------- Meta Graph (Pages, Instagram, Messenger, WhatsApp) ---------- */
const PAGES = [
  { id: 'p1', name: 'DJ Soulvee', access_token: 'PAGE1', picture: { data: { url: `${ME}/avatar/p1.jpg` } }, instagram_business_account: { id: 'ig1', username: 'djsoulvee', name: 'DJ Soulvee', profile_picture_url: `${ME}/avatar/ig1.jpg` } },
  { id: 'p2', name: 'Soulveetainment Media Consults', access_token: 'PAGE2', picture: { data: { url: `${ME}/avatar/p2.jpg` } } },
  { id: 'p3', name: "Soulvee's Emporium", access_token: 'PAGE3', picture: { data: { url: `${ME}/avatar/p3.jpg` } }, instagram_business_account: { id: 'ig3', username: 'soulveesemporium', name: "Soulvee's Emporium" } },
];
const PAGE_TOKEN = { p1: ['PAGE1'], p2: ['PAGE2', 'PAGE2-LONG-TOKEN-0123456789'], p3: ['PAGE3'], ig1: ['PAGE1'], ig3: ['PAGE3'] };
const WA = { pnid: '106540352242922', token: 'WA-TOKEN-' + 'x'.repeat(30) };
function graph(res, req, path, q, b) {
  const token = q.access_token || b.access_token || bearer(req);
  const err = (status, code, message, extra = {}) => send(res, status, { error: { message, type: 'OAuthException', code, fbtrace_id: 'trace', ...extra } });
  const [node, edge] = path.split('/');
  if (path === 'oauth/access_token') {
    if (q.grant_type === 'fb_exchange_token') return q.client_secret !== 'metasecret' ? err(400, 101, 'Error validating client secret.') : /USER/.test(q.fb_exchange_token) ? send(res, 200, { access_token: 'LONG-USER', token_type: 'bearer', expires_in: 5183944 }) : send(res, 200, { access_token: q.fb_exchange_token, token_type: 'bearer' });
    return s.codes[q.code] === 'meta' && q.client_secret === 'metasecret' ? send(res, 200, { access_token: 'SHORT-USER', token_type: 'bearer', expires_in: 5400 }) : err(400, 100, 'Invalid verification code format.');
  }
  if (path === 'me/accounts') return ['LONG-USER', 'SHORT-USER', 'PASTED-USER-TOKEN-0123456789'].includes(token) ? send(res, 200, { data: PAGES, paging: {} }) : token === 'PAGE2-LONG-TOKEN-0123456789' ? err(400, 100, '(#100) Tried accessing nonexisting field (accounts) on node type (Page)') : err(400, 190, 'Invalid OAuth access token - Cannot parse access token');
  if (path === 'me' && token === 'PAGE2-LONG-TOKEN-0123456789') return send(res, 200, { id: 'p2', name: 'Soulveetainment Media Consults', picture: PAGES[1].picture });
  // WhatsApp Cloud API
  if (node === WA.pnid && !edge) return token === WA.token ? send(res, 200, { display_phone_number: '+234 803 000 0000', verified_name: 'Soulveetainment', quality_rating: 'GREEN', id: WA.pnid }) : err(401, 190, 'Invalid OAuth access token.');
  if (node === WA.pnid && edge === 'messages') {
    if (token !== WA.token) return err(401, 190, 'Invalid OAuth access token.');
    if (b.to === '2348000000999' && b.type === 'text') return send(res, 400, { error: { message: '(#131047) Re-engagement message', type: 'OAuthException', code: 131047, error_data: { messaging_product: 'whatsapp', details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' } } });
    return send(res, 200, { messaging_product: 'whatsapp', contacts: [{ input: b.to, wa_id: b.to }], messages: [{ id: id('wamid.OUT') }] });
  }
  // Pages and Instagram need the right Page token
  if (PAGE_TOKEN[node] && !PAGE_TOKEN[node].includes(token)) return err(400, 190, 'Error validating access token: The session has been invalidated.');
  if (PAGES.some(p => p.id === node) && edge === 'photos') return send(res, 200, { id: id('photo') });
  if (PAGES.some(p => p.id === node) && edge === 'feed') return send(res, 200, { id: `${node}_${id('post')}` });
  if (PAGES.some(p => p.id === node) && edge === 'videos') return send(res, 200, { id: id('video') });
  if (PAGES.some(p => p.id === node) && edge === 'conversations') {
    const convos = Object.values(s.convos[q.platform === 'instagram' ? 'instagram' : 'messenger']).filter(c => c.page === node);
    return send(res, 200, { data: convos.map(c => ({ id: c.id, updated_time: c.updated_time, participants: { data: c.participants }, messages: { data: [...c.messages].reverse() } })) });
  }
  if (PAGES.some(p => p.id === node) && edge === 'messages') {
    if (!b.recipient || !b.recipient.id || !b.message || !b.message.text) return err(400, 100, '(#100) The parameter recipient is required');
    if (b.recipient.id === 'late-customer') return err(400, 10, '(#10) This message is sent outside of allowed window.', { error_subcode: 2018278 });
    return send(res, 200, { recipient_id: b.recipient.id, message_id: id('m_out') });
  }
  if (['ig1', 'ig3'].includes(node) && edge === 'media') {
    if (!b.image_url && !b.video_url && b.media_type !== 'CAROUSEL') return err(400, 100, 'The parameter image_url is required.');
    const c = id('cont');
    s.igStatus[c] = b.video_url ? ['IN_PROGRESS', 'FINISHED'] : ['FINISHED'];
    return send(res, 200, { id: c });
  }
  if (['ig1', 'ig3'].includes(node) && edge === 'media_publish') return s.igStatus[b.creation_id] ? send(res, 200, { id: id('igmedia') }) : err(400, 100, 'Media ID is not available');
  if (s.igStatus[node] && !edge) return send(res, 200, { id: node, status_code: s.igStatus[node].length > 1 ? s.igStatus[node].shift() : s.igStatus[node][0] });
  if (/^igmedia/.test(node) && q.fields === 'permalink') return send(res, 200, { id: node, permalink: `https://www.instagram.com/p/${node.toUpperCase()}/` });
  if (PAGE_TOKEN[node] && q.fields === 'id') return send(res, 200, { id: node });
  return err(400, 100, `Unsupported request: ${path}`);
}

/* ---------- Threads ---------- */
function threads(res, req, path, q, b) {
  const token = q.access_token || b.access_token;
  const err = (status, code, message) => send(res, status, { error: { message, type: 'OAuthException', code } });
  if (path === 'oauth/access_token') return s.codes[b.code] === 'threads' && b.client_secret === 'thsecret' ? send(res, 200, { access_token: 'TH-SHORT', user_id: 'th1' }) : err(400, 100, 'Invalid code');
  if (path === 'access_token') return q.grant_type === 'th_exchange_token' && q.access_token === 'TH-SHORT' ? send(res, 200, { access_token: 'TH-LONG', token_type: 'bearer', expires_in: 5184000 }) : err(400, 190, 'Invalid token');
  if (path === 'refresh_access_token') return send(res, 200, { access_token: 'TH-LONG-2', token_type: 'bearer', expires_in: 5184000 });
  if (!['TH-LONG', 'TH-LONG-2'].includes(token)) return err(400, 190, 'Invalid OAuth access token');
  if (path === 'v1.0/me') return send(res, 200, { id: 'th1', username: 'djsoulvee', name: 'DJ Soulvee', threads_profile_picture_url: `${ME}/avatar/th1.jpg` });
  if (path === 'v1.0/th1/threads') {
    if (b.media_type === 'TEXT' && String(b.text || '').length > 500) return err(400, 100, 'Text exceeds 500 characters');
    return send(res, 200, { id: id('thc') });
  }
  if (path === 'v1.0/th1/threads_publish') return b.creation_id ? send(res, 200, { id: id('thpost') }) : err(400, 100, 'creation_id is required');
  if (/^v1\.0\/thc/.test(path)) return send(res, 200, { id: path.split('/')[1], status: 'FINISHED' });
  if (/^v1\.0\/thpost/.test(path)) return send(res, 200, { id: path.split('/')[1], permalink: `https://www.threads.net/@djsoulvee/post/${path.split('/')[1]}` });
  return err(400, 100, 'Unsupported request');
}

/* ---------- X ---------- */
function xapi(res, req, path, q, b) {
  if (path === '2/oauth2/token') {
    const basic = String(req.headers.authorization || '');
    if (basic !== 'Basic ' + Buffer.from('xclient:xsecret').toString('base64')) return send(res, 401, { error: 'unauthorized_client', error_description: 'Missing valid authorization header' });
    if (b.grant_type === 'refresh_token') return b.refresh_token === 'X-REFRESH' ? send(res, 200, { token_type: 'bearer', access_token: 'X-ACCESS-2', refresh_token: 'X-REFRESH-2', expires_in: 7200, scope: 'tweet.read tweet.write users.read media.write offline.access' }) : send(res, 400, { error: 'invalid_request', error_description: 'Value passed for the token was invalid.' });
    const want = s.codes[b.code];
    const challenge = crypto.createHash('sha256').update(String(b.code_verifier || '')).digest('base64url');
    if (!want || want.provider !== 'x' || want.challenge !== challenge) return send(res, 400, { error: 'invalid_request', error_description: 'Value passed for the authorization code or verifier was invalid.' });
    return send(res, 200, { token_type: 'bearer', access_token: 'X-ACCESS', refresh_token: 'X-REFRESH', expires_in: 60, scope: 'tweet.read tweet.write users.read media.write offline.access' });
  }
  if (!['X-ACCESS', 'X-ACCESS-2'].includes(bearer(req))) return send(res, 401, { title: 'Unauthorized', type: 'about:blank', status: 401, detail: 'Unauthorized' });
  if (path === '2/users/me') return send(res, 200, { data: { id: 'x1', name: 'DJ Soulvee', username: 'djsoulvee', profile_image_url: `${ME}/avatar/x1.jpg` } });
  if (path === '2/media/upload') return b.media && b.media_category === 'tweet_image' ? send(res, 200, { data: { id: id('1880000'), media_key: '3_' + s.n, size: 1234, expires_after_secs: 86400 } }) : send(res, 400, { title: 'Invalid Request', detail: 'media is required' });
  if (path === '2/tweets') {
    if (String(b.text).includes('DUPLICATE')) return send(res, 403, { detail: 'You are not allowed to create a Tweet with duplicate content.', type: 'about:blank', title: 'Forbidden', status: 403 });
    return send(res, 201, { data: { id: id('19000000'), text: b.text, edit_history_tweet_ids: [] } });
  }
  return send(res, 404, { title: 'Not Found Error', detail: 'Unsupported request' });
}

/* ---------- LinkedIn ---------- */
function linkedin(res, req, path, q, b) {
  if (path === 'oauth/v2/accessToken') return s.codes[b.code] === 'linkedin' && b.client_secret === 'lisecret' ? send(res, 200, { access_token: 'LI-TOKEN', expires_in: 5183999, scope: 'openid,profile,w_member_social' }) : send(res, 400, { error: 'invalid_request', error_description: 'Unable to retrieve access token: appid/redirect uri/code verifier does not match authorization code' });
  if (bearer(req) !== 'LI-TOKEN') return send(res, 401, { status: 401, serviceErrorCode: 65601, code: 'REVOKED_ACCESS_TOKEN', message: 'The token used in the request has been revoked by the user' });
  if (path === 'v2/userinfo') return send(res, 200, { sub: 'li123', name: 'Soulvee Akin', given_name: 'Soulvee', family_name: 'Akin', picture: `${ME}/avatar/li.jpg` });
  const versioned = /^\d{6}$/.test(String(req.headers['linkedin-version'] || '')) && req.headers['x-restli-protocol-version'] === '2.0.0';
  if (path.startsWith('rest/') && !versioned) return send(res, 400, { status: 400, code: 'VERSION_MISSING', message: 'A version must be present. Please specify a version by adding the LinkedIn-Version header.' });
  if (path === 'rest/organizationAcls') return send(res, 200, { elements: [{ organization: 'urn:li:organization:555', role: 'ADMINISTRATOR', state: 'APPROVED' }] });
  if (path === 'rest/organizations/555') return send(res, 200, { id: 555, localizedName: 'Soulveetainment Media Consults', vanityName: 'soulveetainment' });
  if (path === 'rest/images' && q.action === 'initializeUpload') { const img = id('img'); return send(res, 200, { value: { uploadUrlExpiresAt: Date.now() + 3600e3, uploadUrl: `${ME}/linkedin/upload/${img}`, image: `urn:li:image:${img}` } }); }
  if (path === 'rest/posts') {
    if (!b.author || !b.commentary || b.lifecycleState !== 'PUBLISHED' || !b.distribution) return send(res, 422, { status: 422, message: 'ERROR :: /author :: field is required but not found' });
    res.writeHead(201, { 'x-restli-id': `urn:li:share:${7000 + (++s.n)}` });
    return res.end();
  }
  return send(res, 404, { status: 404, message: 'Not found' });
}

/* ---------- Reddit ---------- */
function reddit(res, req, path, q, b) {
  if (path === 'auth/api/v1/access_token') {
    if (String(req.headers.authorization || '') !== 'Basic ' + Buffer.from('rdclient:rdsecret').toString('base64')) return send(res, 401, { message: 'Unauthorized', error: 401 });
    return b.grant_type === 'password' && b.username === 'djsoulvee' && b.password === 'right-password' ? send(res, 200, { access_token: 'RD-TOKEN', token_type: 'bearer', expires_in: 86400, scope: '*' }) : send(res, 200, { error: 'invalid_grant' });
  }
  if (bearer(req) !== 'RD-TOKEN') return send(res, 401, { message: 'Unauthorized', error: 401 });
  if (!/\(by \/u\/djsoulvee\)/.test(String(req.headers['user-agent']))) return send(res, 429, { message: 'Too Many Requests', error: 429 });
  if (path === 'api/v1/me') return send(res, 200, { name: 'djsoulvee', icon_img: 'https://styles.redditmedia.com/t5_1/styles/profileIcon_abc.png?width=256&s=xyz' });
  if (path === 'api/submit') {
    if (b.sr === 'nosuchsub') return send(res, 200, { json: { errors: [['SUBREDDIT_NOEXIST', "that subreddit doesn't exist", 'sr']] } });
    const pid = id('abc');
    return send(res, 200, { json: { errors: [], data: { url: `https://www.reddit.com/r/${b.sr}/comments/${pid}/post/`, drafts_count: 0, id: pid, name: 't3_' + pid } } });
  }
  if (path === 'message/unread') return send(res, 200, { kind: 'Listing', data: { after: null, children: s.reddit.map(m => ({ kind: 't4', data: m })) } });
  if (path === 'api/comment') return b.thing_id ? send(res, 200, { json: { errors: [], data: { things: [{ kind: 't4', data: { name: id('t4_reply'), body: b.text } }] } } }) : send(res, 200, { json: { errors: [['NO_THING_ID', 'no thing id', 'thing_id']] } });
  return send(res, 404, { message: 'Not Found', error: 404 });
}

/* ---------- Gmail ---------- */
const b64 = t => Buffer.from(t, 'utf8').toString('base64url');
function google(res, req, path, q, b) {
  if (path === 'token') {
    if (b.client_secret !== 'gsecret') return send(res, 401, { error: 'invalid_client', error_description: 'Unauthorized' });
    if (b.grant_type === 'refresh_token') return b.refresh_token === 'G-REFRESH' ? send(res, 200, { access_token: 'G-ACCESS-2', expires_in: 3599, scope: 'https://www.googleapis.com/auth/gmail.modify', token_type: 'Bearer' }) : send(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    return s.codes[b.code] === 'gmail' ? send(res, 200, { access_token: 'G-ACCESS', refresh_token: 'G-REFRESH', expires_in: 60, scope: 'openid email https://www.googleapis.com/auth/gmail.modify', token_type: 'Bearer', id_token: 'x.y.z' }) : send(res, 400, { error: 'invalid_grant', error_description: 'Malformed auth code.' });
  }
  if (!['G-ACCESS', 'G-ACCESS-2'].includes(bearer(req))) return send(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
  const sub = path.replace('gmail/v1/users/me/', '');
  if (sub === 'profile') return send(res, 200, { emailAddress: 'djsoulvee.test@gmail.com', messagesTotal: 10, threadsTotal: 8, historyId: '1001' });
  if (sub === 'messages') return send(res, 200, { messages: Object.values(s.gmail).map(m => ({ id: m.id, threadId: m.threadId })).reverse(), resultSizeEstimate: Object.keys(s.gmail).length });
  if (sub === 'messages/send') {
    const raw = Buffer.from(String(b.raw || ''), 'base64').toString('utf8');
    s.sentMail.push({ raw, threadId: b.threadId });
    return send(res, 200, { id: id('sent'), threadId: b.threadId || id('thread'), labelIds: ['SENT'] });
  }
  const m = sub.match(/^messages\/(\w+)$/);
  if (m && s.gmail[m[1]]) {
    const g = s.gmail[m[1]];
    return send(res, 200, { id: g.id, threadId: g.threadId, labelIds: ['INBOX', 'UNREAD'], snippet: g.body.slice(0, 80), internalDate: String(g.at), payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: g.from }, { name: 'To', value: 'DJ Soulvee <djsoulvee.test@gmail.com>' }, { name: 'Subject', value: g.subject }, { name: 'Message-ID', value: `<${g.id}@mail.gmail.com>` }], parts: [{ mimeType: 'text/plain', body: { size: g.body.length, data: b64(g.body + '\r\n\r\nOn Mon, 10 Nov 2026 at 09:00, DJ Soulvee <djsoulvee.test@gmail.com> wrote:\r\n> earlier message') } }, { mimeType: 'text/html', body: { data: b64('<p>' + g.body + '</p>') } }] } });
  }
  return send(res, 404, { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } });
}

/* ---------- Signal bridge ---------- */
function signal(res, req, path, q, b) {
  if (path === 'v1/about') return send(res, 200, { versions: ['v1', 'v2'], build: 2, mode: 'normal', version: '0.92', capabilities: { 'v2/send': ['quotes', 'mentions'] } });
  if (path === 'v1/accounts') return send(res, 200, ['+2348031110000']);
  if (path === 'v1/receive/+2348031110000') { const out = s.signal.splice(0); return send(res, 200, out); }
  if (path === 'v2/send') return b.number === '+2348031110000' && Array.isArray(b.recipients) && b.message ? send(res, 201, { timestamp: String(Date.now()) }) : send(res, 400, { error: 'Invalid send request' });
  return send(res, 404, { error: 'Not found' });
}

/* ---------- OAuth sign-in pages: approve at once and send the browser back ---------- */
function authorize(res, provider, q) {
  if (!q.redirect_uri || !q.state || !q.client_id) return send(res, 400, { error: 'missing redirect_uri, state or client_id' });
  if (provider === 'x' && (q.code_challenge_method !== 'S256' || !q.code_challenge)) return send(res, 400, { error: 'PKCE required' });
  if (q.client_id === 'deny') return redirect(res, `${q.redirect_uri}?error=access_denied&error_description=The+user+denied+access&state=${encodeURIComponent(q.state)}`);
  const code = id('code_');
  s.codes[code] = provider === 'x' ? { provider, challenge: q.code_challenge } : provider;
  log.push({ method: 'AUTHORIZE', path: provider, scope: q.scope, redirect: q.redirect_uri });
  return redirect(res, `${q.redirect_uri}?code=${code}&state=${encodeURIComponent(q.state)}`);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, ME);
  const q = Object.fromEntries(url.searchParams);
  const raw = await read(req);
  const b = parseBody(req, raw);
  const p = url.pathname;
  if (!p.startsWith('/__') && !p.startsWith('/media/') && !p.startsWith('/avatar/')) log.push({ method: req.method, path: p, query: q, body: b, headers: { authorization: req.headers.authorization ? 'set' : '', 'linkedin-version': req.headers['linkedin-version'], 'user-agent': req.headers['user-agent'] } });
  if (p === '/__log') return send(res, 200, log);
  if (p === '/__sent-mail') return send(res, 200, s.sentMail);
  if (p === '/__reset') { log.length = 0; s.tg = []; s.reddit = []; s.gmail = {}; s.signal = []; s.convos = { messenger: {}, instagram: {} }; s.sentMail = []; return send(res, 200, { ok: true }); }
  const push = p.match(/^\/__push\/(\w+)$/);
  if (push) {
    const v = JSON.parse(raw.toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (push[1] === 'telegram') s.tg.push({ update_id: 5000 + s.tg.length, message: { message_id: ++s.tgId, from: { id: v.fromId, is_bot: false, first_name: v.first, last_name: v.last, username: v.username }, chat: { id: v.fromId, type: 'private', first_name: v.first }, date: now, text: v.text } });
    if (push[1] === 'messenger' || push[1] === 'instagram') {
      const box = s.convos[push[1]];
      const c = box[v.convo] || (box[v.convo] = { id: v.convo, page: v.page, participants: [v.participant, { id: push[1] === 'instagram' ? v.ig : v.page, name: 'Page' }], messages: [] });
      c.messages.push({ id: id('m_'), message: v.text, from: v.fromPage ? { id: push[1] === 'instagram' ? v.ig : v.page } : v.participant, created_time: new Date().toISOString().replace('Z', '+0000') });
      c.updated_time = new Date().toISOString().replace('Z', '+0000');
    }
    if (push[1] === 'reddit') s.reddit.push({ name: id('t4_'), author: v.author, subject: v.subject, body: v.body, created_utc: now, was_comment: false, dest: 'djsoulvee' });
    if (push[1] === 'gmail') { const mid = id('msg'); s.gmail[mid] = { id: mid, threadId: v.threadId || id('thr'), from: v.from, subject: v.subject, body: v.body, at: Date.now() }; }
    if (push[1] === 'signal') s.signal.push({ envelope: { source: v.from, sourceNumber: v.from, sourceUuid: 'uuid-' + v.from, sourceName: v.name, sourceDevice: 1, timestamp: Date.now(), dataMessage: { timestamp: Date.now(), message: v.text, expiresInSeconds: 0, viewOnce: false } }, account: '+2348031110000' });
    return send(res, 200, { ok: true });
  }
  if (p.startsWith('/media/') || p.startsWith('/avatar/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(jpg); }
  const tg = p.match(/^\/telegram\/bot([^/]+)\/(\w+)$/);
  if (tg) return telegram(res, decodeURIComponent(tg[1]), tg[2], b);
  const auth = p.match(/^\/(facebook\/v[\d.]+\/dialog\/oauth|threads\/oauth\/authorize|x\/i\/oauth2\/authorize|linkedin\/oauth\/v2\/authorization|google\/auth)$/);
  if (auth) return authorize(res, { facebook: 'meta', threads: 'threads', x: 'x', linkedin: 'linkedin', google: 'gmail' }[auth[1].split('/')[0]], q);
  const gv = p.match(/^\/graph\/v[\d.]+\/(.+)$/);
  if (gv) return graph(res, req, gv[1], q, b);
  if (p.startsWith('/threads/')) return threads(res, req, p.slice('/threads/'.length), q, b);
  if (p.startsWith('/x/')) return xapi(res, req, p.slice(3), q, b);
  if (p.startsWith('/linkedin/upload/')) { res.writeHead(raw.length && bearer(req) === 'LI-TOKEN' ? 201 : 400); return res.end(); }
  if (p.startsWith('/linkedin/')) return linkedin(res, req, p.slice('/linkedin/'.length), q, b);
  if (p.startsWith('/reddit-auth/')) return reddit(res, req, 'auth/' + p.slice('/reddit-auth/'.length), q, b);
  if (p.startsWith('/reddit/')) return reddit(res, req, p.slice('/reddit/'.length), q, b);
  if (p.startsWith('/google/')) return google(res, req, p.slice('/google/'.length), q, b);
  if (p.startsWith('/signal/')) return signal(res, req, decodeURIComponent(p.slice('/signal/'.length)), q, b);
  return send(res, 404, { error: 'no such mock route ' + p });
}).listen(port, () => console.log('mock platforms on ' + port));
