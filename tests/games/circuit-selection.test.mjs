import test from 'node:test';
import assert from 'node:assert/strict';
import { expandSelection, toggleSelection } from '../../src/lib/games/circuit-selection.js';
import { gateCells } from '../../src/lib/categorical-circuits/engine.js';
import { rectangleCells } from '../../src/lib/games/controls.js';

const ordered = cells => [...cells].sort();
const op = (gate, wires, controls = []) => ({ gate, wires, ...(controls.length ? { controls } : {}) });

test('either SWAP target toggles both cells without selecting external controls', () => {
  const circuit = { wires: 4, columns: [[op('SWAP', [1, 2], [0, 3])]] };
  for (const profile of ['prop', 'controlled']) {
    const source = profile === 'prop' ? { ...circuit, columns: [[op('SWAP', [1, 2])]] } : circuit;
    const linked = key => gateCells(source, key, { profile });
    for (const target of ['1:0', '2:0']) {
      const original = new Set(['3:0']);
      const selected = toggleSelection(original, linked(target), linked);
      assert.deepEqual(ordered(selected), ['1:0', '2:0', '3:0']);
      assert.deepEqual(ordered(original), ['3:0'], 'Selection updates do not mutate their source');
      const opposite = target === '1:0' ? '2:0' : '1:0';
      assert.deepEqual(ordered(toggleSelection(selected, linked(opposite), linked)), ['3:0']);
    }
  }
});

test('PROP CNOT and CZ select complete gates while Controlled PROP keeps each endpoint independent', () => {
  for (const gate of ['X', 'Z']) for (const [target, control] of [[0, 1], [1, 0], [3, 0]]) {
    const circuit = { wires: 4, columns: [[op(gate, [target], [control])]] };
    for (const wire of [target, control]) {
      assert.deepEqual(ordered(gateCells(circuit, wire + ':0', { profile: 'prop' })),
        [target + ':0', control + ':0'].sort());
      assert.deepEqual(gateCells(circuit, wire + ':0'), [wire + ':0']);
    }
  }
});

test('rectangles expand touched gates but retain unrelated cells and separate controlled targets', () => {
  const circuit = { wires: 4, columns: [[op('X', [1], [0])], [op('SWAP', [1, 2])], []] };
  for (const profile of ['prop', 'controlled']) {
    const linked = key => gateCells(circuit, key, { profile });
    const rectangle = rectangleCells('1:0', '1:2');
    assert.deepEqual(ordered(expandSelection(rectangle, linked)),
      (profile === 'prop' ? ['0:0', '1:0', '1:1', '1:2', '2:1'] : ['1:0', '1:1', '1:2', '2:1']));
    assert.equal(rectangle.size, 3);
  }
});

test('parallel PROP gates retain their shared control when one selected target is removed', () => {
  const circuit = { wires: 3, columns: [[op('X', [1], [0]), op('Z', [2], [0])], [op('H', [1])]] };
  const linked = key => gateCells(circuit, key, { profile: 'prop' });
  let selected = toggleSelection(new Set(), linked('1:0'), linked);
  assert.deepEqual(ordered(selected), ['0:0', '1:0'], 'Selecting a target does not also select other gates reading its control');
  selected = toggleSelection(selected, linked('1:1'), linked);
  selected = toggleSelection(selected, linked('1:1'), linked);
  assert.deepEqual(ordered(selected), ['0:0', '1:0'], 'Toggling an unrelated gate does not expand an existing shared control');
  selected = toggleSelection(selected, linked('2:0'), linked);
  assert.deepEqual(ordered(selected), ['0:0', '1:0', '2:0']);
  selected = toggleSelection(selected, linked('1:0'), linked);
  assert.deepEqual(ordered(selected), ['0:0', '2:0']);
  assert.deepEqual(ordered(toggleSelection(selected, linked('2:0'), linked)), []);
  assert.deepEqual(ordered(expandSelection(new Set(['0:0']), linked)), ['0:0', '1:0', '2:0']);
});
