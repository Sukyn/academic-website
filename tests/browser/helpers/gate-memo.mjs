import assert from 'node:assert/strict';

/** The same static reference is used by PRO, PROP and Controlled PROP. */
export async function assertGateMemo(page, map) {
  const memo = page.locator('#signal-memo');
  assert.equal(await memo.locator('[data-memo-input], .signal-memo-colour-swap, #signal-memo-key').count(), 0,
    'No input selector or colour-swap legend hides part of the reference');
  const examples = await memo.locator('#signal-memo-body > .signal-memo-circuit').evaluateAll(nodes => nodes.map(node => ({
    input: node.dataset.input, phase: Number(node.dataset.phase),
    label: node.querySelector('.signal-memo-paths').getAttribute('aria-label'),
    gates: node.querySelector('.signal-memo-circuit-gate').children.length,
    lanes: [...node.querySelectorAll('.signal-memo-lane')].map(lane => ({ bits: lane.dataset.basis, y: Number(lane.getAttribute('y1')) })),
    dots: [...node.querySelectorAll('.signal-memo-node')].map(dot => ({
      role: dot.dataset.role, bits: dot.dataset.bits, phase: Number(dot.dataset.phase),
      fill: dot.getAttribute('fill'), outline: dot.getAttribute('stroke'), y: Number(dot.getAttribute('cy')),
    })),
    paths: [...node.querySelectorAll('.signal-memo-path')].map(path => {
      const gradient = [...node.querySelectorAll('linearGradient')].find(gradient => path.getAttribute('stroke') === `url(#${gradient.id})`);
      return { from: path.dataset.from, to: path.dataset.to, phase: Number(path.dataset.phase),
        stroke: path.getAttribute('stroke'), opacity: getComputedStyle(path).opacity,
        startY: path.getPointAtLength(0).y, endY: path.getPointAtLength(path.getTotalLength()).y,
        stops: gradient && [...gradient.children].map(stop => stop.getAttribute('stop-color')) };
    }),
  })));
  const colour = phase => phase < 0 ? '#ffffff' : '#000000';
  assert.equal(examples.length, 2 * map.rows.length, 'Each input is shown independently in black and white');
  for (const [index, row] of map.rows.entries()) for (const [column, phase] of [1, -1].entries()) {
    const shown = examples[index * 2 + column], lanes = new Map(shown.lanes.map(lane => [lane.bits, lane.y]));
    assert.equal(shown.input, row.input); assert.equal(shown.phase, phase);
    assert.ok(shown.label.includes(row.input) && shown.label.includes(phase < 0 ? 'white' : 'black'));
    assert.equal(shown.gates, 1);
    const expected = row.outputs.map(output => ({ bits: output.bits, phase: output.flipsColour ? -phase : phase }));
    assert.deepEqual(shown.dots.filter(dot => dot.role === 'input').map(({ bits, phase }) => ({ bits, phase })), [{ bits: row.input, phase }]);
    assert.deepEqual(shown.dots.filter(dot => dot.role === 'output').map(({ bits, phase }) => ({ bits, phase })), expected);
    assert.deepEqual(shown.paths.map(({ from, to, phase }) => ({ from, bits: to, phase })), expected.map(output => ({ from: row.input, ...output })));
    for (const dot of shown.dots) {
      assert.equal(dot.fill, colour(dot.phase)); assert.equal(dot.outline, '#ffffff');
      assert.equal(dot.y, lanes.get(dot.bits));
    }
    for (const path of shown.paths) {
      assert.equal(path.opacity, '1', 'Every case is readable without interaction');
      assert.ok(Math.abs(path.startY - lanes.get(path.from)) < .01);
      assert.ok(Math.abs(path.endY - lanes.get(path.to)) < .01);
      if (path.phase === phase) assert.equal(path.stroke, colour(phase));
      else assert.deepEqual(path.stops, [colour(phase), colour(phase), colour(-phase), colour(-phase)]);
    }
  }
}
