// A small JSON file store for server-side state (the social posting queue).
// Writes go to a temp file first and are renamed into place, one at a time,
// so a crash mid-write never leaves a half-written file behind.
const fs = require('node:fs');
const path = require('node:path');

function open(file, initial) {
  const tmp = file + '.tmp';
  const state = { data: load(file, initial), chain: Promise.resolve() };

  function save() {
    const text = JSON.stringify(state.data, null, 2);
    state.chain = state.chain
      .then(() => fs.promises.mkdir(path.dirname(file), { recursive: true }))
      .then(() => fs.promises.writeFile(tmp, text))
      .then(() => fs.promises.rename(tmp, file))
      .catch(err => console.error(`Could not save ${file}: ${err.message}`));
    return state.chain;
  }

  return { get: () => state.data, save };
}

function load(file, initial) {
  if (!fs.existsSync(file)) return initial();
  const text = fs.readFileSync(file, 'utf8');
  const parsed = safeParse(text);
  if (parsed) return parsed;
  // Keep the unreadable file for inspection instead of silently overwriting it.
  const aside = `${file}.corrupt-${Date.now()}`;
  fs.renameSync(file, aside);
  console.error(`${file} was unreadable; moved it to ${aside} and started fresh.`);
  return initial();
}

function safeParse(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}

module.exports = { open };
