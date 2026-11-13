// Telegram through the Bot API. One bot posts to every channel or group where it is an admin, and
// people who message the bot land in the inbox. Messages are fetched with getUpdates, so no public
// address is needed.
const { call, fail } = require('../net');

async function tg(ctx, token, method, body) {
  const res = await call(`${ctx.urls.telegram}/bot${token}/${method}`, { json: body || {}, label: 'Telegram' });
  const out = res.data || {};
  if (out.ok) return out.result;
  const said = out.description || `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 404) throw fail('auth', 'Telegram rejected the bot token. Copy it again from @BotFather.');
  if (res.status === 409) throw fail('conflict', "This bot has a webhook set by another tool, so Soulvee OS can't read its messages. Remove that webhook or use a separate bot for Soulvee OS.");
  if (res.status === 429) throw fail('rate', `Telegram asked Soulvee OS to slow down: ${said}`, true);
  if (res.status >= 500) throw fail('server', `Telegram had a problem: ${said}`, true);
  throw fail('rejected', `Telegram: ${said}`);
}

const describe = m => (m.photo ? '[photo]' : m.video ? '[video]' : m.voice ? '[voice note]' : m.audio ? '[audio]' : m.document ? '[file]' : m.sticker ? '[sticker]' : m.location ? '[location]' : m.contact ? '[contact]' : '[message]');

module.exports = {
  id: 'telegram',
  name: 'Telegram',

  // fields: { token, chats } — or { via: <id of a connected bot>, chats } to add channels to a bot already connected.
  async connect(ctx, f, find) {
    const via = f.via ? find(f.via) : null;
    const token = String((via && via.secret && via.secret.token) || f.token || '').trim();
    if (!/^\d+:[\w-]{20,}$/.test(token)) throw fail('bad_input', "That isn't a bot token. It looks like 123456789:AAF…, and @BotFather gives it to you when you create a bot.");
    const me = await tg(ctx, token, 'getMe');
    const found = [{ provider: 'telegram', kind: 'bot', externalId: String(me.id), name: me.first_name || me.username, handle: '@' + me.username, can: { publish: false, inbox: true }, meta: { botId: me.id, username: me.username }, secret: { token } }];
    const chats = String(f.chats || '').split(/[\s,]+/).map(c => c.trim()).filter(Boolean).slice(0, 20);
    for (const raw of chats) {
      const chatId = /^-?\d+$/.test(raw) ? raw : '@' + raw.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
      const chat = await tg(ctx, token, 'getChat', { chat_id: chatId });
      const member = await tg(ctx, token, 'getChatMember', { chat_id: chat.id, user_id: me.id });
      const admin = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages !== false);
      if (chat.type === 'channel' && !admin) throw fail('bad_input', `Make @${me.username} an admin of "${chat.title}" with permission to post messages, then try again.`);
      found.push({ provider: 'telegram', kind: chat.type === 'channel' ? 'channel' : 'group', externalId: String(chat.id), name: chat.title || chat.username || String(chat.id), handle: chat.username ? '@' + chat.username : '', can: { publish: true, inbox: false }, meta: { chatId: chat.id, username: chat.username || '', botId: me.id, bot: me.username }, secret: { token } });
    }
    return found;
  },

  async check(ctx, acc) {
    await tg(ctx, acc.secret.token, 'getMe');
  },

  limits: { text: 4096 },

  async publish(ctx, acc, post) {
    const token = acc.secret.token;
    const chat = acc.meta.chatId;
    const text = post.text;
    const media = (post.media || []).slice(0, 10);
    if (text.length > 4096) throw fail('too_long', `Too long for Telegram: ${text.length}/4,096 characters.`);
    // Photos and videos take a caption of up to 1,024 characters; longer text follows as its own message.
    const caption = text.length <= 1024 ? text : '';
    const sent = [];
    if (media.length > 1) {
      const group = media.map((m, i) => ({ type: m.type === 'video' ? 'video' : 'photo', media: m.url, ...(i === 0 && caption ? { caption } : {}) }));
      sent.push(...(await tg(ctx, token, 'sendMediaGroup', { chat_id: chat, media: group })));
    }
    if (media.length === 1) {
      const video = media[0].type === 'video';
      sent.push(await tg(ctx, token, video ? 'sendVideo' : 'sendPhoto', { chat_id: chat, [video ? 'video' : 'photo']: media[0].url, ...(caption ? { caption } : {}) }));
    }
    if (!media.length || !caption) sent.push(await tg(ctx, token, 'sendMessage', { chat_id: chat, text }));
    const first = sent[0] || {};
    return { id: String(first.message_id || ''), url: acc.meta.username && first.message_id ? `https://t.me/${acc.meta.username}/${first.message_id}` : '' };
  },

  async poll(ctx, acc, cursor) {
    const offset = cursor && cursor.offset;
    const updates = await tg(ctx, acc.secret.token, 'getUpdates', { offset, timeout: 0, limit: 100, allowed_updates: ['message'] });
    const items = updates.filter(u => u.message && u.message.chat).map(u => {
      const m = u.message;
      const from = m.from || {};
      const person = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Telegram user';
      const direct = m.chat.type === 'private';
      return {
        thread: String(m.chat.id),
        peer: { id: String(m.chat.id), name: direct ? person : m.chat.title || 'Telegram group', handle: direct && from.username ? '@' + from.username : '', telegramId: direct ? String(from.id) : '' },
        id: String(m.message_id),
        dir: from.id === acc.meta.botId ? 'out' : 'in',
        text: m.text || m.caption || describe(m),
        author: direct ? '' : person,
        at: new Date(m.date * 1000).toISOString(),
      };
    });
    return { items, cursor: { offset: updates.length ? updates[updates.length - 1].update_id + 1 : offset } };
  },

  async send(ctx, acc, convo, msg) {
    if (msg.text.length > 4096) throw fail('too_long', `Too long for Telegram: ${msg.text.length}/4,096 characters.`);
    const out = await tg(ctx, acc.secret.token, 'sendMessage', { chat_id: convo.peer.id, text: msg.text });
    return { id: String(out.message_id) };
  },
};
