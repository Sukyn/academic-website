import test from 'node:test';
import assert from 'node:assert/strict';
import { createRememberedName } from '../../src/lib/games/remembered-name.js';

const KEY = 'games.nickname.v1';
function store(initial = null) {
  let saved = initial;
  const backend = {
    failRead: false, failWrite: false, failRemove: false,
    getItem(key) { assert.equal(key, KEY); if (backend.failRead) throw new Error('Read blocked'); return saved; },
    setItem(key, value) { assert.equal(key, KEY); if (backend.failWrite) throw new Error('Write blocked'); saved = value; },
    removeItem(key) { assert.equal(key, KEY); if (backend.failRemove) throw new Error('Removal blocked'); saved = null; },
    get saved() { return saved; },
    set saved(value) { saved = value; },
  };
  return backend;
}

test('remembered names use the shared canonical Unicode and whitespace rules', () => {
  const backend = store('  Zoë\n Noether  '), name = createRememberedName({ storage: () => backend });
  assert.equal(name.value, 'Zoë Noether');
  const initial = name.revision;
  assert.equal(name.refresh(), 'Zoë Noether');
  assert.equal(name.revision, initial);
  assert.equal(name.remember('  😀  '), true);
  assert.equal(name.value, '😀');
  assert.equal(backend.saved, '😀');
  assert.equal(name.revision, initial + 1);
  assert.equal(name.remember('😀'.repeat(24)), true);
  assert.equal(name.value, '😀'.repeat(24));
  const before = name.revision;
  for (const invalid of ['', ' ', null, 42, {}, '😀'.repeat(25), 'Ada\u0000', 'Ada\u202e']) {
    assert.throws(() => name.remember(invalid));
    assert.equal(name.value, '😀'.repeat(24));
    assert.equal(name.revision, before);
    assert.equal(backend.saved, '😀'.repeat(24));
  }
});

test('invalid cached identities clear memory while read failures preserve it', () => {
  const backend = store('Ada'), name = createRememberedName({ storage: () => backend });
  const initial = name.revision;
  backend.failRead = true;
  assert.equal(name.refresh(), 'Ada');
  assert.equal(name.revision, initial);
  backend.failRead = false; backend.saved = 'Ada\u202e';
  assert.equal(name.refresh(), '');
  assert.equal(name.revision, initial + 1);
  for (const invalid of [null, '', ' ', '😀'.repeat(25), 'A\u0000', 42, {}]) {
    backend.saved = invalid;
    assert.equal(createRememberedName({ storage: () => backend }).value, '');
  }
});

test('unavailable storage getters retain an independent in-memory identity for this visit', () => {
  let available = false;
  const backend = store('Stored name');
  const name = createRememberedName({ storage: () => {
    if (!available) throw new Error('Storage getter blocked');
    return backend;
  } });
  assert.equal(name.value, '');
  assert.equal(name.remember('Ada'), false);
  const remembered = name.revision;
  assert.equal(name.refresh(), 'Ada');
  available = true;
  assert.equal(name.refresh(), 'Ada', 'A stale stored value cannot undo the failed write.');
  assert.equal(name.revision, remembered);
  assert.equal(createRememberedName({ storage: () => backend }).value, 'Stored name', 'Instances share only persisted data.');
  assert.equal(name.remember('Grace'), true);
  backend.saved = 'Emmy';
  assert.equal(name.refresh(), 'Emmy', 'A successful write releases the in-memory override.');
});

test('failed writes and removals preserve explicit user intent across refreshes', () => {
  const backend = store(), name = createRememberedName({ storage: () => backend });
  backend.failWrite = true;
  assert.equal(name.remember('Ada'), false);
  assert.equal(backend.saved, null);
  assert.equal(name.refresh(), 'Ada');
  backend.saved = 'Stale name';
  assert.equal(name.refresh(), 'Ada');
  backend.failRemove = true;
  const revision = name.revision;
  assert.equal(name.forget(), false);
  assert.equal(name.value, '');
  assert.equal(name.revision, revision + 1);
  assert.equal(name.refresh(), '', 'A failed removal must not restore the stored name.');
  backend.failWrite = false;
  assert.equal(name.remember('Emmy'), true);
  backend.saved = 'External name';
  assert.equal(name.refresh(), 'External name');
  backend.failRemove = false;
  assert.equal(name.forget(), true);
  assert.equal(backend.saved, null);
});

test('external persisted changes refresh other instances and revisions without tracking player IDs', () => {
  const backend = store(), first = createRememberedName({ storage: () => backend });
  const second = createRememberedName({ storage: () => backend });
  assert.equal(first.revision, 0); assert.equal(second.revision, 0);
  first.remember('Ada');
  assert.equal(second.value, '');
  assert.equal(second.refresh(), 'Ada');
  assert.equal(second.revision, 1);
  backend.saved = '  Ada  ';
  second.refresh();
  assert.equal(second.revision, 1, 'Equivalent canonical names do not change identity.');
  const before = first.revision;
  first.remember('Ada');
  assert.equal(first.revision, before + 1, 'Explicit same-name intent invalidates older work too.');
  first.forget();
  assert.equal(second.refresh(), '');
  assert.equal(second.revision, 2);
  const forgotten = first.revision;
  first.forget();
  assert.equal(first.revision, forgotten + 1);
  assert.equal(backend.saved, null);
});
