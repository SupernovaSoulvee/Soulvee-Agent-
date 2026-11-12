// HTTP calls to the social platforms: a timeout on every call, JSON in and out, and errors
// in plain English. Errors carry a code, and `retry` says whether trying again later could help.

function fail(code, message, retry) {
  const err = new Error(message);
  err.code = code;
  err.retry = !!retry;
  return err;
}

function parse(text) {
  try { return text ? JSON.parse(text) : null; }
  catch { return null; }
}

// call(url, { method, query, json, form, body, headers, timeout, label }) → { status, ok, headers, data, text }
async function call(url, opts = {}) {
  const u = new URL(url);
  Object.entries(opts.query || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); });
  const headers = { 'user-agent': opts.agent || 'SoulveeOS/1.2', accept: 'application/json', ...(opts.headers || {}) };
  const init = { method: opts.method || (opts.json !== undefined || opts.form !== undefined || opts.body !== undefined ? 'POST' : 'GET'), headers, signal: AbortSignal.timeout(opts.timeout || 25000) };
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.json);
  }
  if (opts.form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(Object.entries(opts.form).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
  }
  if (opts.body !== undefined) init.body = opts.body;
  const label = opts.label || u.hostname;
  // The URL is never put in the message: some platforms (Telegram) carry the token in it.
  const res = await fetch(u, init).catch(err => { throw fail('network', `Couldn't reach ${label}: ${err.name === 'TimeoutError' ? 'it took too long to answer' : err.message}.`, true); });
  const text = await res.text().catch(() => '');
  return { status: res.status, ok: res.ok, headers: res.headers, data: parse(text), text };
}

// Turns a failed response into a coded error. `detail` picks the platform's own message from the body.
function check(res, label, detail) {
  if (res.ok) return res.data || {};
  const said = (detail && detail(res.data || {})) || '';
  const s = res.status;
  const why = said ? `: ${said}` : '';
  if (s === 401) throw fail('auth', `${label} no longer accepts this account's sign-in${why}. Reconnect it in Accounts.`);
  if (s === 403) throw fail('forbidden', `${label} refused${why}.`);
  if (s === 429) throw fail('rate', `${label} asked Soulvee OS to slow down${why}. It will try again later.`, true);
  if (s >= 500) throw fail('server', `${label} had a problem (HTTP ${s})${why}. Soulvee OS will try again later.`, true);
  throw fail('rejected', `${label} didn't accept it${why || ` (HTTP ${s})`}.`);
}

// Downloads a post's image so it can be uploaded to platforms that don't fetch URLs themselves.
async function fetchMedia(url, max = 15 * 1024 * 1024) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) }).catch(err => { throw fail('media', `Couldn't download the media at ${url}: ${err.message}.`, true); });
  if (!res.ok) throw fail('media', `Couldn't download the media at ${url} (HTTP ${res.status}).`, res.status >= 500);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw fail('media', `The media at ${url} is over ${Math.round(max / 1024 / 1024)} MB.`);
  return { buf, type: (res.headers.get('content-type') || 'application/octet-stream').split(';')[0] };
}

module.exports = { call, check, fail, fetchMedia };
