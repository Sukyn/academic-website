import { scoreName } from './submission.js';

const KEY = 'games.nickname.v1';

export function createRememberedName({ storage = () => globalThis.localStorage } = {}) {
  let value = '', revision = 0, overridden = false;

  function refresh() {
    if (overridden) return value;
    try {
      const saved = storage().getItem(KEY);
      let next = '';
      try { next = scoreName(saved); } catch { /* Invalid or missing cache. */ }
      if (next !== value) { value = next; revision++; }
    } catch { /* Storage can be unavailable while this visit remains usable. */ }
    return value;
  }

  function remember(name) {
    value = scoreName(name); revision++; overridden = true;
    try { storage().setItem(KEY, value); overridden = false; return true; }
    catch { return false; }
  }

  function forget() {
    value = ''; revision++; overridden = true;
    try { storage().removeItem(KEY); overridden = false; return true; }
    catch { return false; }
  }

  refresh();
  return { refresh, remember, forget,
    get value() { return value; },
    get revision() { return revision; },
  };
}
