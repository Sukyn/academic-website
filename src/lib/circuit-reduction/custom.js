import { MAX_WIRES, cloneCircuit, isIdentity, isSolved, validateCircuit } from './engine.js';

export function identityCircuit(wires = 2) {
  if (!Number.isInteger(wires) || wires < 1 || wires > MAX_WIRES) throw new RangeError('Use 1–4 wires.');
  return Array.from({ length: wires }, () => Array(6).fill('.'));
}

export function customCircuit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('Use an object containing a circuit.');
  const circuit = validateCircuit(value.circuit);
  if (isSolved(circuit)) throw new RangeError('Add some gates first.');
  if (!isIdentity(circuit)) throw new RangeError('The circuit must implement the identity.');
  return cloneCircuit(circuit);
}
