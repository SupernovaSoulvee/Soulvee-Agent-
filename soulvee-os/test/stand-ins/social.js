// Stand-ins for Buffer's GraphQL API and for a Make/Zapier webhook.
//   Buffer:  POST http://127.0.0.1:8797/        (Authorization: Bearer buf_test_key)
//   Webhook: POST http://127.0.0.1:8796/hook    (verifies x-soulvee-signature with secret s3cret)
//   GET /__log on either port: everything received
const http = require('node:http');
const crypto = require('node:crypto');
const read = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });
const bufferLog = [];
const hookLog = [];
const CHANNELS = [
  { id: 'ch_ig', name: 'djsoulvee', displayName: 'DJ Soulvee IG', service: 'instagram', avatar: '', isQueuePaused: false, isDisconnected: false, isLocked: false },
  { id: 'ch_x', name: 'djsoulvee', displayName: 'DJ Soulvee X', service: 'twitter', avatar: '', isQueuePaused: false, isDisconnected: false, isLocked: false },
  { id: 'ch_tt', name: 'djsoulvee', displayName: 'DJ Soulvee TikTok', service: 'tiktok', avatar: '', isQueuePaused: true, isDisconnected: false, isLocked: false },
  { id: 'ch_li', name: 'soulveetainment', displayName: 'SMC LinkedIn', service: 'linkedin', avatar: '', isQueuePaused: false, isDisconnected: false, isLocked: false },
  { id: 'ch_fb', name: 'oldpage', displayName: 'Old FB Page', service: 'facebook', avatar: '', isQueuePaused: false, isDisconnected: true, isLocked: false },
];

http.createServer(async (req, res) => {
  if (req.url === '/__log') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(bufferLog)); return; }
  const body = JSON.parse(await read(req) || '{}');
  bufferLog.push({ auth: req.headers.authorization, query: body.query, variables: body.variables });
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== 'Bearer buf_test_key') { res.end(JSON.stringify({ data: null, errors: [{ message: 'Not authorized', extensions: { code: 'UNAUTHORIZED' } }] })); return; }
  const q = String(body.query || '');
  if (q.includes('SoulveeOrganizations')) { res.end(JSON.stringify({ data: { account: { organizations: [{ id: 'org_1', name: 'Soulveetainment' }] } } })); return; }
  if (q.includes('SoulveeChannels')) { res.end(JSON.stringify({ data: { channels: q.includes('"org_1"') ? CHANNELS : [] } })); return; }
  if (q.includes('SoulveeResults')) {
    const now = Date.now();
    const history = [
      { id: 'hist_1', text: 'POV: the bride hears her song. Book DJ Soulvee for your wedding.', channelId: 'ch_ig', channelService: 'instagram', sentAt: new Date(now - 6 * 864e5).toISOString(), metrics: [{ type: 'reactions', value: 410, unit: 'count' }, { type: 'comments', value: 38, unit: 'count' }, { type: 'saves', value: 52, unit: 'count' }, { type: 'reach', value: 5200, unit: 'count' }, { type: 'engagementRate', value: 9.4, unit: 'percentage' }] },
      { id: 'hist_2', text: 'Friday night at the club, who is coming?', channelId: 'ch_ig', channelService: 'instagram', sentAt: new Date(now - 9 * 864e5).toISOString(), metrics: [{ type: 'reactions', value: 120, unit: 'count' }, { type: 'comments', value: 9, unit: 'count' }, { type: 'reach', value: 3100, unit: 'count' }, { type: 'engagementRate', value: 4.6, unit: 'percentage' }] },
      { id: 'hist_3', text: 'New mix out now on all platforms.', channelId: 'ch_x', channelService: 'twitter', sentAt: new Date(now - 12 * 864e5).toISOString(), metrics: [{ type: 'reactions', value: 8, unit: 'count' }, { type: 'reposts', value: 1, unit: 'count' }, { type: 'impressions', value: 900, unit: 'count' }] },
      { id: 'hist_4', text: 'Not yet measured', channelId: 'ch_x', channelService: 'twitter', sentAt: new Date(now - 864e5).toISOString(), metrics: [] },
    ];
    const created = bufferLog.filter(r => String(r.query).includes('SoulveeCreatePost') && r.created).map((r, i) => ({ id: r.created, text: r.variables.input.text, channelId: r.variables.input.channelId, channelService: (CHANNELS.find(c => c.id === r.variables.input.channelId) || {}).service, sentAt: new Date(now - 3600e3).toISOString(), metrics: [{ type: 'reactions', value: 60 + i, unit: 'count' }, { type: 'reach', value: 1000, unit: 'count' }] }));
    res.end(JSON.stringify({ data: { posts: { edges: [...created, ...history].map(node => ({ node: { dueAt: node.sentAt, metricsUpdatedAt: node.sentAt, ...node } })), pageInfo: { endCursor: null, hasNextPage: false } } } }));
    return;
  }
  if (q.includes('SoulveeCreatePost')) {
    const input = (body.variables || {}).input || {};
    const problems = [];
    if (!input.text) problems.push('Text is required');
    if (!CHANNELS.some(c => c.id === input.channelId)) problems.push('Channel not found');
    if (input.schedulingType !== 'automatic') problems.push('bad schedulingType');
    if (!['customScheduled', 'shareNow', 'addToQueue', 'shareNext'].includes(input.mode)) problems.push('bad mode');
    if (input.mode === 'customScheduled' && !input.dueAt) problems.push('dueAt required');
    if (!Array.isArray(input.assets)) problems.push('assets must be a list');
    if (input.metadata && input.metadata.instagram && (!input.metadata.instagram.type || input.metadata.instagram.shouldShareToFeed === undefined)) problems.push('instagram metadata incomplete');
    if (problems.length) { res.end(JSON.stringify({ data: { createPost: { message: problems.join('; ') } } })); return; }
    if (input.channelId === 'ch_li') { res.end(JSON.stringify({ data: { createPost: { message: 'Queue limit reached' } } })); return; }
    const id = 'post_' + bufferLog.length;
    bufferLog[bufferLog.length - 1].created = id;
    res.end(JSON.stringify({ data: { createPost: { post: { id, dueAt: input.dueAt || new Date().toISOString() } } } }));
    return;
  }
  res.end(JSON.stringify({ data: null, errors: [{ message: 'Unknown query', extensions: { code: 'UNEXPECTED' } }] }));
}).listen(8797, '127.0.0.1', () => console.log('mock buffer on 8797'));

http.createServer(async (req, res) => {
  if (req.url === '/__log') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(hookLog)); return; }
  const raw = await read(req);
  const stamp = req.headers['x-soulvee-timestamp'];
  const expected = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(`${stamp}.${raw}`).digest('hex');
  const body = JSON.parse(raw || '{}');
  hookLog.push({ event: req.headers['x-soulvee-event'], delivery: req.headers['x-soulvee-delivery'], signatureValid: req.headers['x-soulvee-signature'] === expected, body });
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Accepted');
}).listen(8796, '127.0.0.1', () => console.log('mock webhook on 8796'));
