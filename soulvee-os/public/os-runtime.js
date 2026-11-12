/*
 * Soulvee OS runtime.
 *
 * The app UI was first built as a claude.ai artifact and talks to the platform
 * through `window.claude.use(name)`. This file provides the same interface for
 * the standalone app:
 *   - "db":     a small document store persisted in localStorage
 *   - "user":   always allowed to write (single-owner app)
 *   - "sample": Claude, streamed through this app's own server (/api/claude),
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
    local_only: 'AI only works on the computer running Soulvee OS. To use it on this device, set SOULVEE_ACCESS_TOKEN on the server, restart it, then open the app once with ?token=YOUR_TOKEN.',
    offline: "AI needs the Soulvee OS server, and it can't be reached right now. Check your connection, then reload.",
    server: "AI is unavailable: the Soulvee OS server didn't answer. Reload to try again.",
  };

  // Reads the server's event stream for one model turn: text as it arrives, then the full message.
  async function turn(body, signal, onDelta) {
    let res;
    try {
      res = await fetch('/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw { code: 'aborted', message: 'Stopped.' };
      throw { code: 'network', message: "Couldn't reach the Soulvee OS server. Check your connection and try again." };
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const err = (j && j.error) || {};
      throw { code: err.code || 'http', message: err.message || 'AI request failed (' + res.status + ').' };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const got = { message: null, failure: null, buf: '' };
    const handle = block => {
      let event = 'message';
      const data = [];
      block.split('\n').forEach(line => {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      });
      if (!data.length) return; // keep-alive comment
      const payload = JSON.parse(data.join('\n'));
      if (event === 'text') onDelta(payload.text || '');
      if (event === 'message') got.message = payload;
      if (event === 'error') got.failure = payload;
    };
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        got.buf += decoder.decode(chunk.value, { stream: true });
        for (let i = got.buf.indexOf('\n\n'); i >= 0; i = got.buf.indexOf('\n\n')) {
          handle(got.buf.slice(0, i));
          got.buf = got.buf.slice(i + 2);
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') throw { code: 'aborted', message: 'Stopped.' };
      throw { code: 'network', message: 'The connection to the server dropped. Try again.' };
    }
    if (got.buf.trim()) handle(got.buf);
    if (got.failure) throw got.failure;
    if (!got.message) throw { code: 'network', message: 'The AI reply was cut off. Try again.' };
    return got.message;
  }

  // Checks a tool input against its JSON schema (the subset the app's tools use). Returns the problem, or ''.
  function invalid(schema, value, at) {
    if (!schema) return '';
    if (schema.enum && !schema.enum.includes(value)) return at + ' must be one of: ' + schema.enum.join(', ');
    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return at + ' must be an object';
      const missing = (schema.required || []).find(k => value[k] === undefined || value[k] === null);
      if (missing) return at + '.' + missing + ' is required';
      for (const [k, sub] of Object.entries(schema.properties || {})) {
        const problem = value[k] === undefined || value[k] === null ? '' : invalid(sub, value[k], at + '.' + k);
        if (problem) return problem;
      }
      return '';
    }
    if (schema.type === 'array') {
      if (!Array.isArray(value)) return at + ' must be a list';
      for (let i = 0; i < value.length; i++) {
        const problem = invalid(schema.items, value[i], at + '[' + i + ']');
        if (problem) return problem;
      }
      return '';
    }
    if (schema.type === 'string' && typeof value !== 'string') return at + ' must be text';
    if (schema.type === 'number' && !(typeof value === 'number' && isFinite(value))) return at + ' must be a number';
    if (schema.type === 'integer' && !Number.isInteger(value)) return at + ' must be a whole number';
    if (schema.type === 'boolean' && typeof value !== 'boolean') return at + ' must be true or false';
    return '';
  }

  // After a mid-answer fallback to another model, blocks from the declined attempt that came before
  // the last fallback marker are left out when the turn is sent back - except text - and the marker stays put.
  const lastFallback = content => content.map(b => b.type).lastIndexOf('fallback');
  const echo = content => content.filter((b, i) => i >= lastFallback(content) || b.type === 'text' || b.type === 'fallback');
  const afterFallback = content => content.slice(lastFallback(content) + 1);
  const join = (a, b) => (a && b ? a + '\n\n' + b : a || b);

  // Runs one request, or a whole agent turn when tools are given. The tools run here in the
  // browser, because they read and change the data stored on this device.
  async function sample(input, opts = {}) {
    const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(m => ({ role: m.role, content: m.content }));
    const tools = opts.tools || [];
    const body = { messages, effort: opts.effort || 'medium' };
    if (opts.system) body.system = opts.system;
    if (opts.format) body.format = opts.format;
    if (tools.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
    const run = { done: '', retries: 0 };
    for (let step = 0; step < 12; step++) {
      const live = { text: '' };
      const show = () => { if (opts.onText) opts.onText({ text: join(run.done, live.text) }); };
      const msg = await turn(body, opts.signal, d => { live.text += d; show(); }).catch(e => {
        // A garbled streamed tool call: ask again, at most twice in a row.
        if (e && e.code === 'bad_tool_json' && run.retries < 2) return null;
        throw e;
      });
      if (!msg) { run.retries += 1; continue; }
      run.retries = 0;
      // A refusal can cut an answer or tool call off part-way: never use or run any of it.
      if (msg.stop_reason === 'refusal') throw { code: 'refusal', message: 'Claude declined this request. Try rephrasing it.' };
      const content = msg.content || [];
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('');
      run.done = join(run.done, text);
      if (opts.onText) opts.onText({ text: run.done });
      const uses = afterFallback(content).filter(b => b.type === 'tool_use');
      if (msg.stop_reason === 'max_tokens' && (uses.length || !text)) throw { code: 'max_tokens', message: 'The answer got cut off. Try a narrower request.' };
      if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: echo(content) }); continue; }
      if (msg.stop_reason !== 'tool_use' || !uses.length) return { text: run.done, stop_reason: msg.stop_reason };
      messages.push({ role: 'assistant', content: echo(content) });
      const results = [];
      for (const u of uses) {
        const tool = tools.find(t => t.name === u.name);
        const problem = tool ? invalid(tool.inputSchema, u.input, 'input') : 'unknown tool ' + u.name;
        if (problem) {
          // Tool inputs stream unvalidated, so a bad one goes back to Claude to fix instead of running.
          results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(u.input), problem }) });
          continue;
        }
        const out = await Promise.resolve().then(() => tool.execute(u.input)).then(
          value => ({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(value === undefined ? { ok: true } : value) }),
          e => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: JSON.stringify({ error: (e && e.message) || String(e) }) }),
        );
        results.push(out);
      }
      messages.push({ role: 'user', content: results });
      if (opts.signal && opts.signal.aborted) throw { code: 'aborted', message: 'Stopped.' };
    }
    return { text: run.done || 'Stopped after too many steps — try a narrower request.' };
  }
  const parseJson = text => { try { return JSON.parse(text); } catch (e) { return null; } };
  // With a schema the reply is guaranteed to be JSON matching it (structured outputs).
  sample.json = async (prompt, schema, opts = {}) => {
    const r = await sample(prompt, { ...opts, format: schema || undefined });
    const raw = String(r.text || '').trim();
    const parsed = parseJson(raw) || parseJson((raw.match(/\{[\s\S]*\}/) || [''])[0]);
    if (!parsed) throw { code: 'bad_json', message: "The AI's answer couldn't be read. Try again." };
    return parsed;
  };

  // JSON calls to the server's own API (publishing, AI self-test).
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .catch(() => { throw new Error("Couldn't reach the Soulvee OS server. Check your connection."); });
    const j = await res.json().catch(() => null);
    if (res.ok && j) return j;
    const err = (j && j.error) || {};
    throw Object.assign(new Error(err.message || 'Request failed (' + res.status + ').'), { code: err.code || 'http' });
  }

  // Whether this device may use publishing, accounts and the inbox (asked once; the answer can't change without a reload).
  let allowedOnce = null;
  const allowed = () => (allowedOnce = allowedOnce || api('GET', '/api/social/status').then(s => !!s.allowed, () => false));

  /* ---------- backup / restore, status ---------- */
  window.SoulveeOS = {
    allowed,
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
    aiTest: () => api('POST', '/api/ai-test'),
    health: () => api('GET', '/api/health'),
    images: {
      generate: body => api('POST', '/api/images/generate', body),
    },
    autopilot: {
      status: () => api('GET', '/api/autopilot'),
      save: config => api('PUT', '/api/autopilot', config),
      context: context => api('POST', '/api/autopilot/context', context),
      run: () => api('POST', '/api/autopilot/run'),
      inbox: () => api('GET', '/api/autopilot/inbox'),
      ack: ids => api('POST', '/api/autopilot/inbox/ack', { ids }),
    },
    accounts: {
      list: refresh => api('GET', '/api/accounts' + (refresh ? '?refresh=1' : '')),
      connect: (provider, fields) => api('POST', '/api/accounts/connect/' + encodeURIComponent(provider), fields),
      signIn: provider => api('POST', '/api/accounts/oauth/' + encodeURIComponent(provider)),
      update: (id, patch) => api('PATCH', '/api/accounts/' + encodeURIComponent(id), patch),
      remove: id => api('DELETE', '/api/accounts/' + encodeURIComponent(id)),
      test: id => api('POST', '/api/accounts/' + encodeURIComponent(id) + '/test'),
    },
    inbox: {
      list: () => api('GET', '/api/inbox'),
      sync: () => api('POST', '/api/inbox/sync'),
      get: key => api('GET', '/api/inbox/c/' + encodeURIComponent(key)),
      read: key => api('POST', '/api/inbox/c/' + encodeURIComponent(key) + '/read'),
      reply: (key, msg) => api('POST', '/api/inbox/c/' + encodeURIComponent(key) + '/reply', msg),
    },
    social: {
      status: () => api('GET', '/api/social/status'),
      channels: refresh => api('GET', '/api/social/channels' + (refresh ? '?refresh=1' : '')),
      publish: (post, target) => api('POST', '/api/social/publish', { post, target }),
      jobs: ids => api('GET', '/api/social/jobs?ids=' + encodeURIComponent(ids.join(','))),
      cancel: id => api('POST', '/api/social/jobs/' + encodeURIComponent(id) + '/cancel'),
      testWebhook: () => api('POST', '/api/social/test-webhook'),
      insights: (tz, refresh) => api('GET', '/api/social/insights?tz=' + encodeURIComponent(tz || '') + (refresh ? '&refresh=1' : '')),
    },
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
