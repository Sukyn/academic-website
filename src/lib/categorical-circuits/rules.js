const gate = (gate, wires, controls = []) => ({ gate, wires, ...(controls.length ? { controls } : {}) });
const single = (name, wire = 0) => gate(name, [wire]);
const swap = (a, b) => gate('SWAP', [a, b]);
const controlled = (name, control = 0, target = 1) => gate(name, [target], [control]);
const rule = (id, title, wires, left, right) => ({ id, title, wires, left, right });

// Equalities are exact real matrices, including global phase. Controls may lift
// a complete equality; they are context, not extra selected target cells.
export const RULES = Object.freeze([
  ...['H', 'X', 'Z'].map(name => rule('cancel-' + name.toLowerCase(), 'Cancel ' + name + name, 1,
    [[single(name)], [single(name)]], [[], []])),
  rule('basis-x', 'H Z H = X', 1,
    [[single('H')], [single('Z')], [single('H')]], [[], [single('X')], []]),
  rule('basis-z', 'H X H = Z', 1,
    [[single('H')], [single('X')], [single('H')]], [[], [single('Z')], []]),
  rule('cancel-swap', 'Cancel two swaps', 2,
    [[swap(0, 1)], [swap(0, 1)]], [[], []]),
  rule('swap-cnot', 'Three alternating CNOTs equal SWAP', 2,
    [[controlled('X')], [controlled('X', 1, 0)], [controlled('X')]],
    [[], [swap(0, 1)], []]),
  ...['H', 'X', 'Z'].map(name => rule('swap-' + name.toLowerCase(), 'Move ' + name + ' through SWAP', 2,
    [[swap(0, 1)], [single(name, 0)]], [[single(name, 1)], [swap(0, 1)]])),
  rule('swap-braid', 'Reorder three swaps', 3,
    [[swap(0, 1)], [swap(1, 2)], [swap(0, 1)]],
    [[swap(1, 2)], [swap(0, 1)], [swap(1, 2)]]),
  rule('controlled-basis', 'Change the target basis', 2,
    [[single('H', 1)], [controlled('Z')], [single('H', 1)]],
    [[], [controlled('X')], []]),
  rule('propagate-cx', 'Propagate X through CNOT', 2,
    [[single('X')], [controlled('X')]],
    [[controlled('X')], [single('X'), single('X', 1)]]),
  rule('propagate-cz', 'Propagate X through CZ', 2,
    [[single('X')], [controlled('Z')]],
    [[controlled('Z')], [single('X'), single('Z', 1)]]),
  rule('commute-cz', 'Reorder controlled phases', 3,
    [[controlled('Z', 0, 1)], [controlled('Z', 1, 2)]],
    [[controlled('Z', 1, 2)], [controlled('Z', 0, 1)]]),
]);

const byId = new Map(RULES.map(value => [value.id, value]));
export const getRule = id => byId.get(id);
