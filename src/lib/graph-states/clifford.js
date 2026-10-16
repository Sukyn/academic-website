// Signed Pauli images determine a Clifford up to global phase.
// https://quantum.cloud.ibm.com/docs/en/api/qiskit/qiskit.quantum_info.Clifford
const ACTIONS = {
  H: [0, 3, -2, 1],
  S: [0, 2, -1, 3],
  SDG: [0, -2, 1, 3],
  X: [0, 1, -2, -3],
  Z: [0, -1, -2, 3],
};
const image = (axis, action) => Math.sign(axis) * action[Math.abs(axis)];
const key = ([x, z]) => `${x},${z}`;

function shortestWords() {
  const words = new Map([['1,3', []]]), queue = [[1, 3]], gates = Object.entries(ACTIONS);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const axes = queue[cursor], word = words.get(key(axes));
    for (const [gate, action] of gates) {
      const next = axes.map(axis => image(axis, action)), signature = key(next);
      if (words.has(signature)) continue;
      words.set(signature, [...word, gate]);
      queue.push(next);
    }
  }
  return words;
}

// The images of X and Z determine a Clifford up to global phase: 24 cases.
const WORDS = shortestWords();

/** Pack independent wires into at most three gates each, preserving the unitary
 * up to global phase. Inputs contain only the single-qubit correction gates.
 */
export function simplifyCorrectionColumns(vertices, columns) {
  const states = Array.from({ length: vertices }, () => [1, 3]);
  for (const column of columns) for (const { gate, wires: [wire] } of column) {
    const state = states[wire], action = ACTIONS[gate];
    state[0] = image(state[0], action);
    state[1] = image(state[1], action);
  }
  const result = [];
  states.forEach((axes, wire) => {
    WORDS.get(key(axes)).forEach((gate, index) => {
      (result[index] ??= []).push({ gate, wires: [wire] });
    });
  });
  return result;
}
