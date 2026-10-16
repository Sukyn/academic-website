import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoveTimeline } from '../../src/lib/games/move-timeline.js';

function setup(context) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let created = 0, fragments = 0;
  class Node {
    constructor(fragment = false) { this.fragment = fragment; this.children = []; this.attrs = {}; this.dataset = {}; this.writes = 0; }
    appendChild(child) {
      if (child.fragment) { for (const node of child.children) this.appendChild(node); }
      else { this.children.push(child); child.parent = this; }
    }
    get lastElementChild() { return this.children.at(-1); }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    setAttribute(name, value) { this.attrs[name] = value; this.writes++; }
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement() { created++; return new Node(); }, createDocumentFragment() { fragments++; return new Node(true); },
  } });
  context.after(() => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document);
  const container = new Node(), descriptions = [];
  const render = createMoveTimeline(container, (move, index) => {
    descriptions.push(move);
    const text = typeof move === 'string' ? move : move.gate;
    return { text, label: `Step ${index + 1}: ${text}` };
  });
  return { container, render, descriptions, get created() { return created; }, get fragments() { return fragments; } };
}

test('metadata and replay selection preserve button nodes, labels and their event handlers', context => {
  const state = setup(context);
  state.render('HTH');
  const buttons = [...state.container.children];
  buttons[1].handler = () => 'keyboard action';
  assert.deepEqual(buttons.map(button => button.dataset.step), ['1', '2', '3']);
  assert.equal(buttons[1].attrs['aria-label'], 'Step 2: T');
  state.render('HTH', { step: 2, disabled: true });
  assert.deepEqual(state.container.children, buttons);
  assert.equal(buttons[1].handler(), 'keyboard action');
  assert.ok(buttons.every(button => button.disabled));
  assert.deepEqual(buttons.map(button => button.attrs['aria-current']), ['false', 'step', 'false']);
  state.render('HTH', { step: 3 });
  assert.ok(buttons.every(button => !button.disabled));
  assert.deepEqual(buttons.map(button => button.attrs['aria-current']), ['false', 'false', 'step']);
  const writes = buttons.map(button => button.writes);
  state.render('HTH', { step: 3 });
  assert.deepEqual(buttons.map(button => button.writes), writes);
  assert.equal(state.created, 3); assert.equal(state.descriptions.length, 3);
});

test('mutable move histories append, undo and replace only their changed suffix', context => {
  const state = setup(context), first = { gate: 'H' }, second = { gate: 'T' }, sequence = [first];
  state.render(sequence);
  const kept = state.container.children[0];
  sequence.push(second); state.render(sequence, { disabled: true, step: 2 });
  const removed = state.container.children[1];
  assert.equal(state.container.children[0], kept); assert.equal(removed.disabled, true);
  sequence.pop(); state.render(sequence, { disabled: true });
  sequence.push({ gate: 'X' }); state.render(sequence, { disabled: true, step: 2 });
  assert.equal(state.container.children[0], kept);
  assert.notEqual(state.container.children[1], removed);
  assert.equal(state.container.children[1].textContent, 'X');
  assert.equal(state.container.children[1].disabled, true);
  assert.equal(state.container.children[1].attrs['aria-current'], 'step');
  state.render([], { step: 0 });
  assert.equal(state.container.children.length, 0);
  state.render([first]); assert.equal(state.container.children.length, 1);
});

test('unchanged move arrays allocate no fragments, create no buttons and leave existing labels untouched', context => {
  const state = setup(context), sequence = [{ gate: 'H' }, { gate: 'X' }];
  state.render(sequence, { step: 1 });
  const buttons = [...state.container.children], writes = buttons.map(button => button.writes);
  for (let refresh = 0; refresh < 20; refresh++) state.render(sequence, { step: 1 });
  assert.equal(state.fragments, 1); assert.equal(state.created, 2);
  assert.equal(state.descriptions.length, 2);
  assert.deepEqual(buttons.map(button => button.writes), writes);
  state.render([]); assert.equal(state.fragments, 1);
});

test('unchanged strings leave the DOM untouched, while changed strings retain the common prefix', context => {
  const state = setup(context);
  state.render('HT'); const first = state.container.children[0];
  state.render('HX');
  assert.equal(state.container.children[0], first);
  assert.equal(state.container.children[1].textContent, 'X');
  const descriptors = state.descriptions.length;
  // No descriptions or DOM writes occur for repeated animation-frame updates.
  for (let frame = 0; frame < 60; frame++) state.render('HX');
  assert.equal(state.descriptions.length, descriptors); assert.equal(state.created, 3);
});
