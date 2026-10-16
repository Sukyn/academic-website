import test from 'node:test';
import assert from 'node:assert/strict';
import { CORRECTION_LABELS, CORRECTION_SIZE, correctionGlyph, drawCorrection } from '../../src/lib/graph-states/correction-graphics.js';

test('phase gates use green split dots with transparent cuts in opposite diagonal directions', context => {
  const original = globalThis.document;
  context.after(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
  globalThis.document = { createElementNS: (_, tag) => ({
    tag, children: [], attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); },
  }) };
  const diagonals = [];
  for (const gate of ['H', 'X', 'Z', 'S', 'SDG']) {
    const glyph = correctionGlyph(gate, 80, 60);
    assert.equal(glyph.attributes.transform, 'translate(80,60)');
    assert.equal(glyph.attributes.role, 'img');
    assert.equal(glyph.attributes['aria-label'], CORRECTION_LABELS[gate]);
    assert.ok(glyph.children.every(child => child.tag !== 'text'), 'Gate symbols never depend on a font.');
    if (gate.startsWith('S')) {
      const paths = glyph.children.filter(child => child.tag === 'path');
      assert.equal(glyph.children.length, 1, 'The accessible group contains only the cut-out dot.');
      assert.equal(paths.length, 1);
      assert.equal(paths[0].attributes.fill, '#9ad9d1');
      assert.equal(paths[0].attributes.stroke, undefined);
      const segments = [...paths[0].attributes.d.matchAll(/M([^A]+)A([^Z]+)Z/g)].map(([, start, arc]) => {
        const numbers = value => value.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
        const a = numbers(start), values = numbers(arc), b = values.slice(-2);
        assert.equal(values[0], values[1], 'Both lobes follow the same circle.');
        for (const point of [a, b]) assert.ok(Math.abs(Math.hypot(...point) - values[0]) < 1e-8);
        const middle = a.map((coordinate, index) => (coordinate + b[index]) / 2);
        assert.ok(Math.hypot(...middle) >= 1.5, 'A visible transparent strip separates the two lobes.');
        assert.ok(values[0] < CORRECTION_SIZE / 2, 'The dot fits comfortably in its gate slot.');
        return { a, b, middle };
      });
      assert.equal(segments.length, 2);
      assert.ok(segments[0].middle.every((coordinate, index) => Math.abs(coordinate + segments[1].middle[index]) < 1e-8));
      const { a, b } = segments[0];
      diagonals.push(Math.sign((b[0] - a[0]) * (b[1] - a[1])));
      assert.equal(glyph.children.some(child => child.attributes?.fill === '#1b2822'), false,
        'The slash is a cutout rather than a strip painted in a background colour.');
    }
  }
  assert.deepEqual(diagonals, [-1, 1], 'S uses a slash; its inverse uses a backslash.');
});

test('canvas phase symbols fit the same compact envelope without drawing text', () => {
  for (const gate of ['H', 'X', 'Z', 'S', 'SDG']) {
    const coordinates = [], operations = [];
    const ctx = Object.fromEntries(['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'arc', 'closePath', 'fill', 'stroke', 'fillRect']
      .map(method => [method, (...points) => {
        operations.push(method);
        if (['moveTo', 'lineTo', 'bezierCurveTo'].includes(method)) coordinates.push(...points);
      }]));
    ctx.fillText = () => assert.fail('Canvas gates must not depend on text rendering.');
    drawCorrection(ctx, gate, 0, 0);
    assert.ok(coordinates.every(value => Number.isFinite(value) && Math.abs(value) < CORRECTION_SIZE / 2));
    if (gate.startsWith('S')) {
      assert.equal(operations.filter(method => method === 'fill').length, 1);
      assert.equal(operations.filter(method => method === 'arc').length, 2);
      assert.equal(operations.filter(method => method === 'closePath').length, 2);
      assert.equal(operations.filter(method => method === 'stroke').length, 0);
      assert.equal(operations.filter(method => method === 'fillRect').length, 0);
      assert.equal(ctx.fillStyle, '#9ad9d1');
    }
  }
});
