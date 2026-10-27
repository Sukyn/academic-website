import test from 'node:test';
import assert from 'node:assert/strict';
import { animateFlow } from '../../src/lib/quantum-signals/animation.js';
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');

function fixture(context, { reduced = false, columns = [1, 2] } = {}) {
  const animations = [];
  const makeNode = tag => ({
    tag, attrs: new Map(), dataset: {}, childNodes: [], parentElement: null,
    get classList() { return { contains: name => (this.getAttribute('class') ?? '').split(' ').includes(name) }; },
    setAttribute(name, value) {
      this.attrs.set(name, String(value));
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    },
    removeAttribute(name) { this.attrs.delete(name); if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]; },
    getAttribute(name) { return this.attrs.get(name) ?? null; },
    getAttributeNames() { return [...this.attrs.keys()]; },
    appendChild(child) { child.remove(); child.parentElement = this; this.childNodes.push(child); },
    insertBefore(child, sibling) { child.remove(); child.parentElement = this; this.childNodes.splice(this.childNodes.indexOf(sibling), 0, child); },
    remove() { if (this.parentElement) { const children = this.parentElement.childNodes; children.splice(children.indexOf(this), 1); this.parentElement = null; } },
    replaceWith(...children) {
      const parent = this.parentElement, index = parent.childNodes.indexOf(this);
      for (const child of children) child.remove();
      parent.childNodes.splice(index, 1, ...children); this.parentElement = null;
      for (const child of children) child.parentElement = parent;
    },
    animate(frames, options) {
      let resolve, reject;
      const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
      const animation = { frames, options, finished, complete: resolve, cancel() { reject(new Error('cancelled')); } };
      animations.push(animation); return animation;
    },
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElementNS: (_, tag) => makeNode(tag) } });
  context.after(() => documentDescriptor ? Object.defineProperty(globalThis, 'document', documentDescriptor) : delete globalThis.document);
  const svg = makeNode('svg'), gutter = makeNode('g'); gutter.setAttribute('class', 'signal-flow-gutter');
  svg.ownerDocument = { defaultView: { matchMedia: () => ({ matches: reduced }) } };
  svg.parentElement = { scrollLeft: 0, clientWidth: 1000 };
  svg.querySelector = () => gutter;
  const descendants = root => root.childNodes.flatMap(node => [node, ...descendants(node)]);
  svg.querySelectorAll = () => descendants(svg).filter(node => node.classList.contains('signal-flow-path'));
  const path = (column, amplitude) => {
    const node = makeNode('path');
    for (const [key, value] of Object.entries({ class: 'signal-flow-path', 'data-column': column, 'data-from': 0, 'data-to': 1, 'data-amplitude': amplitude })) node.setAttribute(key, value);
    return node;
  };
  const previous = columns.map(column => path(column, -1));
  for (const column of columns) svg.appendChild(path(column, 1));
  svg.appendChild(gutter);
  return { svg, previous, animations };
}

test('gameplay keeps its short default animation while a tutorial can slow the same transitions', async context => {
  const first = fixture(context), job = animateFlow(first.svg, first.previous, 1);
  assert.deepEqual(first.animations.map(animation => [animation.options.duration, animation.options.delay]), [[160, 0], [280, 0], [160, 70], [280, 70]]);
  for (const animation of first.animations) animation.complete();
  assert.equal(await job.finished, true);
  assert.equal(first.svg.getAttribute('data-flow-animating'), null);
  assert.ok(first.svg.childNodes.every(node => node.tag !== 'g' || node.classList.contains('signal-flow-gutter')));

  const second = fixture(context), slow = animateFlow(second.svg, second.previous, 1, { duration: 1000 });
  assert.deepEqual(second.animations.map(animation => animation.options.delay), [0, 0, 250, 250]);
  assert.deepEqual(second.animations.filter((_, index) => index % 2).map(animation => animation.options.duration), [1000, 1000]);
  slow.cancel();
  assert.equal(await slow.finished, false);
  assert.equal(second.svg.getAttribute('aria-busy'), null);
  assert.ok(second.svg.childNodes.every(node => node.tag !== 'g' || node.classList.contains('signal-flow-gutter')));
});

test('slower tutorial timing still skips reduced-motion and offscreen columns', async context => {
  for (const options of [{ reduced: true }, { columns: [100] }]) {
    const { svg, previous, animations } = fixture(context, options);
    assert.equal(await animateFlow(svg, previous, 1, { duration: 1000 }).finished, true);
    assert.equal(animations.length, 0);
  }
  const { svg, previous } = fixture(context);
  for (const duration of [0, -1, NaN, Infinity, 'slow']) assert.throws(() => animateFlow(svg, previous, 1, { duration }), RangeError);
});
