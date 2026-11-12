// WhatsApp through Meta's WhatsApp Business Platform (Cloud API). Each business phone number is an
// account. Customer messages arrive by webhook, so the server needs a public address (PUBLIC_URL).
// Replies are free-form within 24 hours of the customer's last message; after that only an approved
// template can be sent.
const { call, fail } = require('../net');

async function wa(ctx, path, opts = {}) {
  const res = await call(`${ctx.urls.graph}/${ctx.graphVersion}/${path}`, { ...opts, label: 'WhatsApp' });
  if (res.ok) return res.data || {};
  const e = (res.data && res.data.error) || {};
  const said = (e.error_data && e.error_data.details) || e.message || `HTTP ${res.status}`;
  if (e.code === 190) throw fail('auth', `WhatsApp no longer accepts this access token (${said}). Paste a new one in Accounts.`);
  if (e.code === 131047 || e.code === 470) throw fail('window', 'More than 24 hours have passed since this customer last wrote, so WhatsApp only allows an approved template message.');
  if ([4, 80007, 130429, 131048, 131056].includes(e.code) || res.status === 429) throw fail('rate', `WhatsApp's limit was reached: ${said}`, true);
  if (res.status >= 500) throw fail('server', `WhatsApp had a problem: ${said}`, true);
  throw fail('rejected', `WhatsApp: ${said}`);
}

const describe = m => (m.image ? m.image.caption || '[photo]' : m.video ? m.video.caption || '[video]' : m.document ? m.document.caption || '[file]' : m.audio ? '[voice note]' : m.sticker ? '[sticker]' : m.location ? '[location]' : m.button ? m.button.text : m.interactive ? '[reply]' : m.reaction ? `[reacted ${m.reaction.emoji || ''}]` : '[message]');

module.exports = {
  id: 'whatsapp',
  name: 'WhatsApp Business',

  // fields: { token, phoneNumberId, appSecret } — from the WhatsApp section of the Meta app.
  async connect(ctx, f) {
    const token = String(f.token || '').trim();
    const id = String(f.phoneNumberId || '').trim();
    if (token.length < 20) throw fail('bad_input', 'Paste the WhatsApp access token from your Meta app (a permanent system user token is best).');
    if (!/^\d{5,}$/.test(id)) throw fail('bad_input', 'The phone number ID is the long number shown under your WhatsApp number in the Meta app, not the phone number itself.');
    const n = await wa(ctx, id, { query: { fields: 'display_phone_number,verified_name,quality_rating', access_token: token } });
    return [{ provider: 'whatsapp', kind: 'number', externalId: id, name: n.verified_name || n.display_phone_number, handle: n.display_phone_number || '', can: { publish: false, inbox: true }, meta: { phoneNumberId: id, quality: n.quality_rating || '' }, secret: { token, appSecret: String(f.appSecret || '').trim() } }];
  },

  async check(ctx, acc) {
    await wa(ctx, acc.meta.phoneNumberId, { query: { fields: 'id', access_token: acc.secret.token } });
  },

  async send(ctx, acc, convo, msg) {
    const body = msg.template
      ? { messaging_product: 'whatsapp', to: convo.peer.id, type: 'template', template: { name: msg.template.name, language: { code: msg.template.language || 'en' } } }
      : { messaging_product: 'whatsapp', recipient_type: 'individual', to: convo.peer.id, type: 'text', text: { body: msg.text, preview_url: false } };
    if (!msg.template && msg.text.length > 4096) throw fail('too_long', `Too long for WhatsApp: ${msg.text.length}/4,096 characters.`);
    const out = await wa(ctx, `${acc.meta.phoneNumberId}/messages`, { json: body, headers: { authorization: `Bearer ${acc.secret.token}` } });
    return { id: ((out.messages || [])[0] || {}).id || '' };
  },

  // Turns a webhook delivery into new messages and delivery updates for the matching number.
  webhook(body, accounts) {
    if (body.object !== 'whatsapp_business_account') return [];
    const out = [];
    (body.entry || []).forEach(entry => (entry.changes || []).forEach(change => {
      const v = change.value || {};
      const acc = accounts.find(a => a.provider === 'whatsapp' && String(a.meta.phoneNumberId) === String((v.metadata || {}).phone_number_id));
      if (!acc) return;
      const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, (c.profile || {}).name || '']));
      const items = (v.messages || []).map(m => ({
        thread: m.from,
        peer: { id: m.from, name: names[m.from] || '+' + m.from, phone: '+' + m.from },
        id: m.id,
        dir: 'in',
        text: (m.text && m.text.body) || describe(m),
        at: new Date(Number(m.timestamp) * 1000).toISOString(),
      }));
      const statuses = (v.statuses || []).map(s => ({ thread: s.recipient_id, statusFor: s.id, status: s.status, error: ((s.errors || [])[0] || {}).title || '' }));
      out.push({ account: acc, items: [...items, ...statuses] });
    }));
    return out;
  },
};
