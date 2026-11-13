// A stand-in for the Anthropic Messages API that speaks the real SSE wire format,
// so the official SDK in Soulvee OS runs end to end against it.
//   POST /__script   body: [response, ...]  queue scripted responses (FIFO)
//   GET  /__requests                        every request body received so far
//   POST /__reset                           clear queue and log
// A request with the key sk-ant-rejected-key gets the 401 Anthropic sends for a bad key. The SDK sends
// the key as "Authorization: Bearer …"; older versions used an x-api-key header, so both are read.
// A scripted response: { blocks: [...], stop_reason, model?, delayMs? } or { status, error: {type, message} }.
// Blocks: {type:'text', text} | {type:'tool_use', name, input | raw} | {type:'thinking'} | {type:'fallback', from, to}
const http = require('node:http');
const port = Number(process.argv[2] || 8799);
const queue = [];
const log = [];
let n = 0;

const read = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function defaultReply(body) {
  const last = body.messages[body.messages.length - 1];
  const text = typeof last.content === 'string' ? last.content : '(tool results)';
  return { blocks: [{ type: 'text', text: 'Mock reply to: ' + text.slice(0, 40) }], stop_reason: 'end_turn' };
}

async function streamReply(res, script, body) {
  const model = script.model || body.model;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_mock_' + n });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id: 'msg_mock_' + n, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  for (let i = 0; i < script.blocks.length; i++) {
    const b = script.blocks[i];
    if (b.type === 'text') {
      ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      for (const part of b.text.match(/.{1,12}/gs) || ['']) { ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: part } }); if (script.delayMs) await sleep(script.delayMs); }
    }
    if (b.type === 'thinking') {
      ev('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '', signature: '' } });
      ev('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: 'sig_mock_' + i } });
    }
    if (b.type === 'tool_use') {
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: 'toolu_mock_' + n + '_' + i, name: b.name, input: {} } });
      const raw = b.raw !== undefined ? b.raw : JSON.stringify(b.input);
      for (const part of raw.match(/.{1,10}/gs) || ['']) ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: part } });
    }
    if (b.type === 'fallback') ev('content_block_start', { index: i, content_block: { type: 'fallback', from: { model: b.from }, to: { model: b.to } } });
    ev('content_block_stop', { index: i });
  }
  ev('message_delta', { delta: { stop_reason: script.stop_reason || 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
  ev('message_stop', {});
  res.end();
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__script') { queue.push(...JSON.parse(await read(req))); res.end('ok'); return; }
  if (url.pathname === '/__requests') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(log)); return; }
  if (url.pathname === '/__reset') { queue.length = 0; log.length = 0; res.end('ok'); return; }
  if (url.pathname === '/v1/messages' && req.method === 'POST') {
    n += 1;
    const body = JSON.parse(await read(req));
    log.push({ headers: { 'x-api-key': req.headers['x-api-key'], 'anthropic-beta': req.headers['anthropic-beta'], 'anthropic-version': req.headers['anthropic-version'] }, body });
    const key = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (key === 'sk-ant-rejected-key') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); return; }
    const script = queue.shift() || defaultReply(body);
    if (script.status) { res.writeHead(script.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: script.error })); return; }
    if (body.stream) return streamReply(res, script, body);
    const content = script.blocks.map((b, i) => b.type === 'tool_use' ? { type: 'tool_use', id: 'toolu_' + i, name: b.name, input: b.input } : { type: 'text', text: b.text });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'msg_mock_' + n, type: 'message', role: 'assistant', model: script.model || body.model, content, stop_reason: script.stop_reason || 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }));
    return;
  }
  res.writeHead(404); res.end('{}');
}).listen(port, '127.0.0.1', () => console.log('mock anthropic on ' + port));
