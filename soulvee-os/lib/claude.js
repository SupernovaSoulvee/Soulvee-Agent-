// Claude through the official Anthropic SDK.
// The browser runs the agent loop (its tools act on data stored in the browser),
// so this module streams each model turn back as server-sent events:
//   event: text     {"text": "..."}      text as it is generated
//   event: message  {...Message...}      the complete message, once the turn ends
//   event: error    {"code", "message"}  what went wrong, in plain words
const Anthropic = require('@anthropic-ai/sdk').default;

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const ROLES = new Set(['user', 'assistant']);
// Retries a policy decline on the model Anthropic recommends for that category.
// On a model without fallback support the request simply runs on that model alone.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

function create(env) {
  const key = env.ANTHROPIC_API_KEY || '';
  return {
    client: key ? new Anthropic({ apiKey: key, maxRetries: 2 }) : null,
    model: env.SOULVEE_MODEL || 'claude-opus-5-5',
  };
}

// Returns why a request body can't be sent, or '' when it is fine.
function check(body) {
  if (!body || typeof body !== 'object') return 'Bad request body';
  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length) return 'messages required';
  if (messages.length > 200) return 'This conversation is too long. Clear it and start again.';
  if (messages.some(m => !m || !ROLES.has(m.role) || (typeof m.content !== 'string' && !Array.isArray(m.content)))) return 'Bad message in the conversation';
  if (messages[0].role !== 'user') return 'The conversation must start with a user message';
  if (body.system !== undefined && typeof body.system !== 'string') return 'Bad system prompt';
  if (body.format !== undefined && (!body.format || typeof body.format !== 'object')) return 'Bad output format';
  const tools = body.tools;
  if (tools !== undefined && (!Array.isArray(tools) || tools.length > 20 || tools.some(t => !t || typeof t.name !== 'string' || !t.input_schema || typeof t.input_schema !== 'object'))) return 'Bad tools';
  return '';
}

function params(api, body) {
  const output = { effort: EFFORTS.has(body.effort) ? body.effort : 'medium' };
  if (body.format) output.format = { type: 'json_schema', schema: body.format };
  const request = {
    model: api.model,
    // Thinking counts toward max_tokens, so leave room for it as well as the reply.
    max_tokens: 64000,
    messages: body.messages,
    output_config: output,
    // Caches the prompt prefix, so each step of an agent turn re-reads it at a fraction of the price.
    cache_control: { type: 'ephemeral' },
    ...FALLBACK,
  };
  if (body.system) request.system = body.system;
  if (body.tools && body.tools.length) {
    // Tool inputs stream as they are generated; the browser validates each one before running it.
    request.tools = body.tools.map(t => ({ name: t.name, description: t.description || '', input_schema: t.input_schema, eager_input_streaming: true }));
  }
  return request;
}

async function stream(api, res, body) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // Comments keep idle connections open through proxies while Claude thinks.
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  const run = api.client.beta.messages.stream(params(api, body));
  res.on('close', () => { if (!res.writableFinished) run.abort(); });
  run.on('text', text => emit('text', { text }));
  const message = await run.finalMessage().catch(err => {
    if (!(err instanceof Anthropic.APIUserAbortError)) emit('error', explain(err, api.model));
    return null;
  });
  if (message) emit('message', message);
  clearInterval(ping);
  res.end();
}

// One short real request, so the owner can confirm the key and model work.
async function test(api) {
  const message = await api.client.beta.messages.create({
    model: api.model,
    max_tokens: 2048,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: 'Reply with one word: ready' }],
    ...FALLBACK,
  });
  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  return { ok: message.stop_reason !== 'refusal', model: message.model, stop_reason: message.stop_reason, text };
}

function explain(err, model) {
  if (err instanceof Anthropic.AuthenticationError) return { code: 'auth', message: 'Claude rejected the API key. Check ANTHROPIC_API_KEY on the Soulvee OS server, then restart it.' };
  if (err instanceof Anthropic.PermissionDeniedError) return { code: 'forbidden', message: `This API key isn't allowed to use ${model}. Check your Anthropic Console, or set SOULVEE_MODEL to another model.` };
  if (err instanceof Anthropic.NotFoundError) return { code: 'model', message: `${model} isn't available to this API key. Set SOULVEE_MODEL to another model.` };
  if (err instanceof Anthropic.RateLimitError) return { code: 'rate_limited', message: 'Too many AI requests just now — wait a minute and try again.' };
  if (err instanceof Anthropic.BadRequestError) return { code: 'bad_request', message: `Claude rejected the request: ${err.message}` };
  if (err instanceof Anthropic.APIConnectionError) return { code: 'network', message: "The server couldn't reach Claude. Check its internet connection and try again." };
  if (err instanceof Anthropic.APIError && err.status === 529) return { code: 'overloaded', message: 'Claude is busy right now. Try again in a moment.' };
  if (err instanceof Anthropic.APIError) return { code: 'api', message: `Claude error${err.status ? ` (${err.status})` : ''}: ${err.message}` };
  // Not an API error: with eager input streaming the SDK raises a plain AnthropicError
  // when a streamed tool input isn't valid JSON. The browser re-issues the turn.
  if (err instanceof Anthropic.AnthropicError) return { code: 'bad_tool_json', message: 'The AI sent a garbled tool call.' };
  console.error('Unexpected AI error:', err);
  return { code: 'server', message: 'Something went wrong on the Soulvee OS server. Try again.' };
}

module.exports = { create, check, stream, test, explain };
