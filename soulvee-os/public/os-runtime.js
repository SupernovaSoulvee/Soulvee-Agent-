/*
 * Soulvee OS runtime.
 *
 * The app UI was first built as a claude.ai artifact and talks to the platform
 * through `window.claude.use(name)`. This file provides the same interface for
 * the standalone app:
 *   - "db":     a small document store persisted in localStorage
 *   - "user":   always allowed to write (single-owner app)
 *   - "sample": Claude, called through this app's own server (/api/claude),
 *               which keeps the API key off the device. Tool calls run here in
 *               the browser so the agent can read and write the local data.
 *   - "mcp":    not available standalone (Gmail / Calendar need claude.ai)
 */
(function () {
  const KEY = 'soulvee-os:v1';
  const listeners = new Set();

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { collections: {}, docs: {} }; }
    catch (e) { return { collections: {}, docs: {} }; }
  }
  let state = load();
  state.collections = state.collections || {};
  state.docs = state.docs || {};

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { throw { code: 'quota_exceeded', message: 'Device storage is full' }; }
    listeners.forEach(fn => { try { fn(); } catch (e) {} });
  }
  // Keep several open tabs in sync.
  window.addEventListener('storage', ev => {
    if (ev.key !== KEY) return;
    state = load(); state.collections = state.collections || {}; state.docs = state.docs || {};
    listeners.forEach(fn => { try { fn(); } catch (e) {} });
  });

  const clone = v => JSON.parse(JSON.stringify(v));
  const meta = { fromCache: false };
  const subscribe = fn => { listeners.add(fn); queueMicrotask(fn); return () => listeners.delete(fn); };

  const db = {
    collection(name) {
      const col = () => (state.collections[name] = state.collections[name] || {});
      return {
        onSnapshot(next) {
          return subscribe(() => next({
            metadata: meta,
            docs: Object.entries(col()).map(([id, d]) => ({ id, data: () => clone(d) })),
          }));
        },
        doc(id) {
          return {
            async set(v) { col()[id] = clone(v); persist(); },
            async update(p) {
              if (!col()[id]) throw { code: 'not_found', message: 'Record no longer exists' };
              col()[id] = { ...col()[id], ...clone(p) }; persist();
            },
            async delete() { delete col()[id]; persist(); },
          };
        },
      };
    },
    doc(path) {
      return {
        onSnapshot(next) {
          return subscribe(() => {
            const d = state.docs[path];
            next({ exists: d !== undefined, data: () => clone(d), metadata: meta });
          });
        },
        async set(v) { state.docs[path] = clone(v); persist(); },
      };
    },
  };

  /* ---------- backup / restore ---------- */
  window.SoulveeOS = {
    exportData() {
      const blob = new Blob([JSON.stringify({ app: 'soulvee-os', exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'soulvee-os-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async importData(file) {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed.collections !== 'object') throw new Error('Not a Soulvee OS backup file');
      state = { collections: parsed.collections || {}, docs: parsed.docs || {} };
      persist();
    },
  };

  /* ---------- Claude ---------- */
  let aiStatus = null;
  async function checkAI() {
    if (aiStatus) return aiStatus;
    try { const r = await fetch('/api/health'); aiStatus = r.ok ? await r.json() : { ai: false }; }
    catch (e) { aiStatus = { ai: false }; }
    return aiStatus;
  }

  async function callClaude(body, signal) {
    let r;
    try {
      r = await fetch('/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw { message: 'Stopped.' };
      throw { message: 'Could not reach the Soulvee OS server.' };
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 429) throw { code: 'rate_limited', message: 'Too many AI requests just now — wait a minute and try again.' };
      throw { message: (j.error && (j.error.message || j.error)) || ('AI request failed (' + r.status + ')') };
    }
    return j;
  }
  const textOf = msg => (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

  async function sample(input, opts = {}) {
    const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(m => ({ role: m.role, content: m.content }));
    const tools = opts.tools || [];
    const apiTools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
    let soFar = '';
    for (let turn = 0; turn < 8; turn++) {
      const body = { messages, max_tokens: opts.maxTokens || 2048 };
      if (apiTools.length) body.tools = apiTools;
      const msg = await callClaude(body, opts.signal);
      const text = textOf(msg);
      if (text) { soFar = soFar ? soFar + '\n\n' + text : text; if (opts.onText) opts.onText({ text: soFar }); }
      const uses = (msg.content || []).filter(b => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || !uses.length) return { text: soFar };
      messages.push({ role: 'assistant', content: msg.content });
      const results = [];
      for (const u of uses) {
        const tool = tools.find(t => t.name === u.name);
        let content, is_error = false;
        try { content = JSON.stringify(tool ? await tool.execute(u.input || {}) : { error: 'Unknown tool' }); }
        catch (e) { content = JSON.stringify({ error: (e && e.message) || String(e) }); is_error = true; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content, is_error });
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: soFar || 'Stopped after too many tool steps.' };
  }
  sample.json = async prompt => {
    const r = await sample(prompt + '\n\nReply with a single JSON object only — no prose, no code fences.');
    const m = (r.text || '').match(/\{[\s\S]*\}/);
    if (!m) throw { code: 'bad_json', message: 'The AI did not return usable JSON. Try again.' };
    return JSON.parse(m[0]);
  };

  window.claude = {
    async use(name) {
      if (name === 'db') return db;
      if (name === 'user') return { can: async () => true };
      if (name === 'sample') return (await checkAI()).ai ? sample : null;
      return null; // mcp etc.
    },
  };
})();
