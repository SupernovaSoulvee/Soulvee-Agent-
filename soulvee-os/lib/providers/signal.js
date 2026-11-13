// Signal has no official API for businesses. This connects to signal-cli-rest-api, a community bridge
// you run yourself (for example in Docker) with a phone number registered or linked to Signal. It is
// for one-to-one conversations with your contacts, not bulk messages. Run the bridge in "normal" or
// "native" mode so messages can be fetched over HTTP.
const { call, fail } = require('../net');

async function sg(ctx, acc, path, opts = {}) {
  const res = await call(`${acc.meta.url}/${path}`, { ...opts, label: 'the Signal bridge', timeout: opts.timeout || 30000 });
  if (res.ok) return res.data === null ? {} : res.data;
  const why = (res.data && (res.data.error || res.data.message)) || res.text.slice(0, 200) || `HTTP ${res.status}`;
  if (/websocket|json-rpc/i.test(why)) throw fail('mode', 'The Signal bridge runs in json-rpc mode, where messages can only be read over a websocket. Restart it with MODE=normal or MODE=native.');
  if (res.status >= 500) throw fail('server', `The Signal bridge had a problem: ${why}`, true);
  throw fail('rejected', `Signal: ${why}`);
}

module.exports = {
  id: 'signal',
  name: 'Signal',

  // fields: { url, number } — the bridge address (e.g. http://localhost:8080) and the registered number.
  async connect(ctx, f) {
    const url = String(f.url || '').trim().replace(/\/+$/, '');
    const number = String(f.number || '').trim().replace(/[^\d+]/g, '');
    if (!/^https?:\/\/\S+$/i.test(url)) throw fail('bad_input', 'Enter the address of your signal-cli-rest-api bridge, e.g. http://localhost:8080.');
    if (!/^\+\d{7,15}$/.test(number)) throw fail('bad_input', 'Enter the Signal number in international format, e.g. +2348031234567.');
    const acc = { meta: { url } };
    const about = await sg(ctx, acc, 'v1/about');
    const numbers = await sg(ctx, acc, 'v1/accounts').catch(() => null);
    if (Array.isArray(numbers) && !numbers.includes(number)) throw fail('bad_input', `${number} isn't registered on that Signal bridge. Register or link it there first.`);
    return [{ provider: 'signal', kind: 'number', externalId: number, name: 'Signal ' + number, handle: number, can: { publish: false, inbox: true }, meta: { url, number, mode: about.mode || '' }, secret: {} }];
  },

  async check(ctx, acc) {
    await sg(ctx, acc, 'v1/about');
  },

  async poll(ctx, acc) {
    const list = await sg(ctx, acc, `v1/receive/${encodeURIComponent(acc.meta.number)}`, { query: { timeout: 1 } });
    const items = (Array.isArray(list) ? list : []).map(x => x.envelope || {}).filter(e => e.dataMessage && e.dataMessage.message).map(e => {
      const from = e.sourceNumber || e.source || e.sourceUuid || '';
      return { thread: from, peer: { id: from, name: e.sourceName || from, phone: e.sourceNumber || '' }, id: `${from}-${e.timestamp}`, dir: 'in', text: e.dataMessage.message, at: new Date(Number(e.timestamp) || Date.now()).toISOString() };
    });
    return { items, cursor: {} };
  },

  async send(ctx, acc, convo, msg) {
    const out = await sg(ctx, acc, 'v2/send', { json: { message: msg.text, number: acc.meta.number, recipients: [convo.peer.id] } });
    return { id: String(out.timestamp || '') };
  },
};
