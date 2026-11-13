// Images for posts: made from the post's visual brief with OpenAI's image API, then hosted at a
// public, permanent link that Buffer and the social networks can fetch:
//   CLOUDINARY_URL set -> uploaded to Cloudinary (recommended)
//   PUBLIC_URL set     -> served by this server at PUBLIC_URL/media/<file>
//   neither            -> kept on this server for previews and posting by hand only
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../public/shared.js');

function create(env, dir) {
  const key = env.OPENAI_API_KEY || '';
  const api = (env.SOULVEE_IMAGE_API_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = env.SOULVEE_IMAGE_MODEL || 'gpt-image-2';
  const quality = env.SOULVEE_IMAGE_QUALITY || 'medium';
  const cloud = parseCloudinary(env.CLOUDINARY_URL || '');
  const cloudApi = (env.CLOUDINARY_API_URL || 'https://api.cloudinary.com').replace(/\/$/, '');
  const publicUrl = (env.PUBLIC_URL || '').replace(/\/$/, '');
  const mediaDir = path.join(dir, 'media');

  function status() {
    return { ready: !!key, model, hosting: cloud ? 'cloudinary' : publicUrl ? 'server' : 'local' };
  }

  async function generate(opts) {
    if (!key) throw fail('images_off', 'Images are off: add OPENAI_API_KEY to the server.');
    const brief = String(opts.visual || '').trim() || String(opts.title || '').trim();
    if (!brief) throw fail('bad_brief', 'Write a visual brief for the post first.');
    const shape = shared.imageShape(opts.format, opts.platforms);
    const size = shape === 'portrait' ? '1024x1536' : '1024x1024';
    const prompt = shared.imagePrompt({ brand: opts.brand, visual: brief, shape });
    const res = await fetch(`${api}/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      // JPEG: Instagram only accepts JPEG images through its publishing API.
      body: JSON.stringify({ model, prompt, size, quality, n: 1, output_format: 'jpeg', output_compression: 90 }),
      signal: AbortSignal.timeout(180000),
    }).catch(err => { throw fail('images_network', `Couldn't reach the image service: ${err.message}`); });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw fail(res.status === 401 ? 'images_auth' : 'images_api', explain(res.status, body, model));
    const b64 = body && body.data && body.data[0] && body.data[0].b64_json;
    if (!b64) throw fail('images_api', "The image service didn't return an image.");
    const url = await host(Buffer.from(b64, 'base64'));
    return { type: 'image', url, size, hosting: status().hosting };
  }

  async function host(bytes) {
    const id = crypto.randomUUID();
    if (cloud) return upload(bytes, id);
    await fs.promises.mkdir(mediaDir, { recursive: true });
    await fs.promises.writeFile(path.join(mediaDir, `${id}.jpg`), bytes);
    return `${publicUrl}/media/${id}.jpg`; // a relative link when PUBLIC_URL isn't set
  }

  // Signed upload: SHA-1 of the sorted parameters (minus file and api_key) followed by the API secret.
  async function upload(bytes, id) {
    const params = { folder: 'soulvee-os', public_id: id, timestamp: String(Math.floor(Date.now() / 1000)) };
    const signed = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const signature = crypto.createHash('sha1').update(signed + cloud.secret).digest('hex');
    const form = new URLSearchParams({ ...params, api_key: cloud.key, signature, file: `data:image/jpeg;base64,${bytes.toString('base64')}` });
    const res = await fetch(`${cloudApi}/v1_1/${encodeURIComponent(cloud.name)}/image/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) })
      .catch(err => { throw fail('cloudinary_network', `Couldn't reach Cloudinary: ${err.message}`); });
    const body = await res.json().catch(() => null);
    if (res.ok && body && body.secure_url) return body.secure_url;
    const why = body && body.error && body.error.message ? `: ${body.error.message}` : ` (HTTP ${res.status})`;
    throw fail('cloudinary', `Cloudinary didn't accept the image${why}. Check CLOUDINARY_URL.`);
  }

  // A locally hosted image, by file name; null for anything that isn't one of ours.
  function file(name) {
    return /^[0-9a-f-]{36}\.jpg$/.test(name) ? path.join(mediaDir, name) : null;
  }

  return { status, generate, file };
}

function explain(status, body, model) {
  const err = (body && body.error) || {};
  const text = String(err.message || '');
  if (status === 401) return 'The image service rejected OPENAI_API_KEY. Check the key, then restart the server.';
  if (status === 404 || err.code === 'model_not_found') return `${model} isn't available to this key. Set SOULVEE_IMAGE_MODEL to an image model your account can use.`;
  if (status === 429) return 'The image service is rate limiting or your credit has run out. Try again later.';
  if (status === 400 && /safety|policy|moderation/i.test(text + err.code)) return 'The image service declined this brief. Reword it and try again.';
  return `The image service said: ${text || `HTTP ${status}`}`;
}

function parseCloudinary(url) {
  const m = String(url).match(/^cloudinary:\/\/([^:]+):([^@]+)@([\w-]+)$/);
  return m ? { key: m[1], secret: m[2], name: m[3] } : null;
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

module.exports = { create };
