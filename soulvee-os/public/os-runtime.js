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

  // The server turns ?token=… into a cookie, so drop it from the address bar.
  if (/[?&]token=/.test(location.search)) {
    const q = new URLSearchParams(location.search);
    q.delete('token');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  }

  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  // Keep only well-formed data: { collections: { name: { id: doc } }, docs: { path: value } }.
  function clean(s) {
    const out = { collections: {}, docs: isObj(s && s.docs) ? s.docs : {} };
    const cols = isObj(s && s.collections) ? s.collections : {};
    Object.keys(cols).forEach(name => {
      if (isObj(cols[name])) out.collections[name] = Object.fromEntries(Object.entries(cols[name]).filter(([, d]) => isObj(d)));
    });
    return out;
  }
  function load() {
    try { return clean(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { return clean(null); }
  }
  let state = load();

  const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) {} });
  // Apply a change and save it; if the device refuses (storage full), undo it.
  function commit(mutate) {
    const before = JSON.stringify(state);
    mutate();
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { state = JSON.parse(before); throw { code: 'quota_exceeded', message: 'Device storage is full' }; }
    notify();
  }
  // Keep several open tabs in sync.
  window.addEventListener('storage', ev => { if (ev.key === KEY) { state = load(); notify(); } });

  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const meta = { fromCache: false };
  // Calls `emit` now, then again only when the value returned by `read` actually changes.
  function watch(read, emit) {
    let last = null;
    const fn = () => {
      const now = String(JSON.stringify(read()));
      if (now === last) return;
      last = now;
      emit();
    };
    listeners.add(fn);
    queueMicrotask(() => { if (listeners.has(fn)) fn(); });
    return () => listeners.delete(fn);
  }

  const db = {
    collection(name) {
      const col = () => state.collections[name] || {};
      const ensure = () => (state.collections[name] = state.collections[name] || {});
      return {
        onSnapshot(next) {
          return watch(col, () => next({ metadata: meta, docs: Object.entries(col()).map(([id, d]) => ({ id, data: () => clone(d) })) }));
        },
        doc(id) {
          return {
            async set(v) { commit(() => { ensure()[id] = clone(v); }); },
            async update(p) {
              if (!col()[id]) throw { code: 'not_found', message: 'that record no longer exists' };
              commit(() => { ensure()[id] = { ...col()[id], ...clone(p) }; });
            },
            async delete() { commit(() => { delete ensure()[id]; }); },
          };
        },
      };
    },
    doc(path) {
      return {
        onSnapshot(next) {
          return watch(() => state.docs[path], () => {
            const d = state.docs[path];
            next({ exists: d !== undefined, data: () => clone(d), metadata: meta });
          });
        },
        async set(v) { commit(() => { state.docs[path] = clone(v); }); },
      };
    },
  };

  /* ---------- Claude ---------- */
  let health = null;
  async function checkAI() {
    if (health) return health;
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      health = r.ok ? await r.json() : { ai: false, reason: 'server' };
    } catch (e) {
      health = { ai: false, reason: 'offline' };
    }
    return health;
  }
  const OFF = {
    no_key: 'AI is off. Set ANTHROPIC_API_KEY on the Soulvee OS server (see README), then restart it.',
    locked: 'AI is locked on this device. Open the app once with ?token=YOUR_TOKEN to unlock it.',
    offline: "AI needs the Soulvee OS server, and it can't be reached right now. Check your connection, then reload.",
    server: "AI is unavailable: the Soulvee OS server didn't answer. Reload to try again.",
  };

  async function callClaude(body, signal) {
    let r;
    try {
      r = await fetch('/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw { code: 'aborted', message: 'Stopped.' };
      throw { message: "Couldn't reach the Soulvee OS server. Check your connection and try again." };
    }
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    if (r.status === 429) throw { code: 'rate_limited', message: 'Too many AI requests just now — wait a minute and try again.' };
    const err = (j && typeof j.error === 'object' && j.error) || {};
    if (err.type === 'authentication_error') throw { message: 'Claude rejected the API key. Check ANTHROPIC_API_KEY on the Soulvee OS server, then restart it.' };
    if (r.status === 529 || err.type === 'overloaded_error') throw { message: 'Claude is busy right now. Try again in a moment.' };
    throw { message: err.message || (typeof j.error === 'string' && j.error) || 'AI request failed (' + r.status + ').' };
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
      if (text) {
        soFar = soFar ? soFar + '\n\n' + text : text;
        if (opts.onText) opts.onText({ text: soFar });
      }
      const uses = (msg.content || []).filter(b => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || !uses.length) return { text: soFar };
      messages.push({ role: 'assistant', content: msg.content });
      const results = [];
      for (const u of uses) {
        const tool = tools.find(t => t.name === u.name);
        let content;
        let isError = false;
        try { content = JSON.stringify(tool ? await tool.execute(u.input || {}) : { error: 'Unknown tool' }); }
        catch (e) { content = JSON.stringify({ error: (e && e.message) || String(e) }); isError = true; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content, is_error: isError });
      }
      messages.push({ role: 'user', content: results });
      if (opts.signal && opts.signal.aborted) throw { code: 'aborted', message: 'Stopped.' };
    }
    return { text: soFar || 'Stopped after too many steps — try a narrower request.' };
  }
  sample.json = async prompt => {
    const r = await sample(prompt + '\n\nReply with a single JSON object only — no prose, no code fences.');
    const m = (r.text || '').match(/\{[\s\S]*\}/);
    if (!m) throw { code: 'bad_json', message: "The AI didn't return a usable answer. Try again." };
    try { return JSON.parse(m[0]); }
    catch (e) { throw { code: 'bad_json', message: "The AI didn't return a usable answer. Try again." }; }
  };

  /* ---------- backup / restore, status ---------- */
  window.SoulveeOS = {
    exportData() {
      const blob = new Blob([JSON.stringify({ app: 'soulvee-os', exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'soulvee-os-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async importData(file) {
      let parsed;
      try { parsed = JSON.parse(await file.text()); }
      catch (e) { throw new Error("that file isn't a valid backup"); }
      if (!isObj(parsed) || !isObj(parsed.collections)) throw new Error("that file isn't a Soulvee OS backup");
      const next = clean(parsed);
      commit(() => { state = next; });
    },
    aiOffReason: () => OFF[health && health.reason] || OFF.no_key,
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
