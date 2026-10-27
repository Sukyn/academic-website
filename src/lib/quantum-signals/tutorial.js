import { validatePuzzle } from './engine.js';

export const TUTORIAL_INTRO = 'Use gates to take 00 to 11. Then solve examples with fixed gates.';
export const TUTORIAL_PUZZLES = [];
export const TUTORIAL_STEPS = [];

const single = (id, wire, gate) => ({ id, wires: [wire], choices: ['I', gate] });
const pair = (id, gate, wires = [0, 1]) => ({ id, wires, choices: ['I', gate] });
const fixed = (gate, wire) => ({ gate, wires: [wire] });
const bits = (basis, ...wires) => ({ kind: 'bits', basis, wires });
const node = (basis, boundary) => ({ kind: 'node', basis, boundary });
const look = (text, focus, anchor, view = 'paths') => ({ text, focus, anchor, view });
const place = (hole, gate, text, focus, animationAnchor, options = {}) => ({
  hole, gate, text, focus, animationAnchor, anchor: { kind: 'gate', hole }, view: 'circuit',
  duration: gate === 'H' ? 1000 : gate === 'X' ? 650 : 850, ...options,
});

function lesson(wires, columns, steps) {
  const chapter = TUTORIAL_PUZZLES.length;
  TUTORIAL_PUZZLES.push(validatePuzzle({ wires, columns }));
  for (const step of steps) TUTORIAL_STEPS.push({ chapter, ...step });
}

lesson(2, [[single('a', 0, 'X')], [single('b', 1, 'X')]], [
  place('a', 'X', 'The goal of the game is to start at 00 and use gates to reach 11. The first bit matches the upper wire; the second matches the lower. Let’s add X on the upper wire to see what it does.',
    { wires: [0, 1], bases: [0], column: 0 }, bits(0, 0, 1), { view: 'paths', anchor: bits(0, 0, 1) }),
  look('The signal now follows 10 instead of 00. The first bit flipped.',
    { wires: [0], bases: [2], column: 0 }, node(2, 1)),
  place('b', 'X', 'X on the lower wire flips the second bit: 10 becomes 11.',
    { wires: [1], bases: [2], column: 1 }, node(2, 1)),
  look('If you forget what a gate does, check the Gate memo here. You’ve reached 11.',
    { wires: [0, 1], bases: [3], column: 1 }, { kind: 'memo' }),
]);

lesson(2, [[fixed('H', 0)], [single('a', 0, 'Z')], [single('b', 0, 'H')], [single('c', 1, 'X')]], [
  look('In this game, at the beginning some gates are fixed. H splits each signal into two branches. For input bit 0, both keep its colour. For input bit 1, the lower branch swaps colour.',
    { wires: [0], bases: [0, 2], column: 0 }, { kind: 'gate', column: 0, wires: [0] }, 'circuit'),
  place('a', 'Z', 'Z on the upper wire swaps black and white when the first bit is 1. Here 10 turns white; 00 stays black.',
    { wires: [0], bases: [0, 2], column: 1 }, node(2, 1), { view: 'paths', anchor: bits(2, 0) }),
  place('b', 'H', 'Let’s apply H again on the upper wire.',
    { wires: [0], bases: [0, 2], column: 2, phase: true }, node(2, 2), { view: 'paths', anchor: node(2, 2) }),
  look('At 00, equal black and white branches cancel. The wall marks where the signal stops. At 10, two black branches amplify the signal.',
    { wires: [0], toBases: [0], column: 2 }, { kind: 'wall', basis: 0, boundary: 3 }),
  place('c', 'X', 'X on the lower wire flips the second bit: 10 becomes 11. The first stays 1.',
    { wires: [1], bases: [2], column: 3 }, node(2, 3)),
]);

lesson(3, [[fixed('X', 1), fixed('X', 2)], [pair('a', 'CX')], [pair('b', 'CX', [1, 2])],
  [pair('c', 'XC')], [single('d', 2, 'H')], [pair('e', 'CZ', [1, 2])], [single('f', 2, 'H')]], [
  place('a', 'CX', 'We’ll add CNOT on the first and second wires. The first bit is 0, so the second won’t flip: 011 will stay 011.',
    { wires: [0, 1], bases: [3], column: 1 }, node(3, 1), { view: 'paths', anchor: bits(3, 0, 1) }),
  place('b', 'CX', 'We’ll add CNOT on the second and third wires. The second bit is 1, so it will flip the third: 011 will become 010.',
    { wires: [1, 2], bases: [3], column: 2 }, node(3, 2)),
  place('c', 'XC', 'We’ll add NOTC on the first and second wires. The second bit is 1, so it will flip the first: 010 will become 110.',
    { wires: [0, 1], bases: [2], column: 3 }, node(2, 3)),
  place('d', 'H', 'For a black signal at 110, H on the third wire gives equal black branches at 110 and 111. The first two bits stay 11.',
    { wires: [2], bases: [6], column: 4 }, node(6, 4)),
  place('e', 'CZ', 'CZ on the second and third wires swaps black and white when those bits are 11. So 111 turns white; 110 stays black.',
    { wires: [1, 2], bases: [6, 7], column: 5, phase: true }, bits(7, 1, 2), { view: 'paths', anchor: bits(7, 1, 2) }),
  place('f', 'H', 'H on the third wire splits both paths again. Equal black and white branches cancel at 110. Two black branches amplify the signal at 111. Goal reached.',
    { wires: [2], bases: [6, 7], column: 6, phase: true }, node(7, 6), { view: 'paths', anchor: node(7, 6) }),
]);

export const TUTORIAL_PUZZLE = TUTORIAL_PUZZLES[0];
