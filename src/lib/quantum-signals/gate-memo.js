import { applyGate } from './engine.js';
import { gateIcon, gateLabel, flowPath } from './rendering.js';
import { CIRCUIT_COLORS, svgNode } from '../games/circuit-graphics.js';
import { PHASE_COLORS } from './state-visuals.js';

const operationFor = (hole, gate) => ({ gate, wires: hole.wires });
const apply = (state, operation, wires) => applyGate(state, operation.gate, operation.wires, wires);
const iconFor = (_, gate, hole) => gateIcon(gate, hole.wires);
const labelFor = (_, gate, hole) => gateLabel(gate, hole.wires);
export const gateMemoChoices = hole => hole.wires.length === 1 ? ['I', 'H', 'X', 'Z'] : ['I', 'CX', 'XC', 'CZ'];

/** Restrict the actual simulator to the gate's wires, keeping their top-to-bottom bit order. */
export function gateMemoMap(hole, choice, { operation = operationFor, apply: evolve = apply } = {}) {
  if (!hole?.choices?.includes(choice) || !Array.isArray(hole.wires) || !hole.wires.length) throw new RangeError('Choose a gate offered by this hole.');
  const original = operation(hole, choice);
  const wires = [...new Set([...hole.wires, ...(hole.controls ?? []), ...(original?.wires ?? []), ...(original?.controls ?? [])])].sort((a, b) => a - b);
  if (wires.length > 4 || wires.some(wire => !Number.isInteger(wire) || wire < 0 || wire > 3)) throw new RangeError('Use 1–4 circuit wires.');
  const local = original && { ...original, wires: original.wires.map(wire => wires.indexOf(wire)),
    ...(original.controls ? { controls: original.controls.map(wire => wires.indexOf(wire)) } : {}) };
  const bits = Array.from({ length: 2 ** wires.length }, (_, basis) => basis.toString(2).padStart(wires.length, '0'));
  const rows = bits.map((input, basis) => {
    const state = Array(bits.length).fill(0); state[basis] = 1;
    if (local) evolve(state, local, wires.length);
    if (state.some(value => !Number.isFinite(value))) throw new RangeError('The gate must produce finite amplitudes.');
    return { input, outputs: state.flatMap((value, output) => Math.abs(value) < 1e-9 ? [] : [{ bits: bits[output], flipsColour: value < 0 }]) };
  });
  return { operation: original, wires, rows };
}

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function colourSwapGlyph(attrs = {}) {
  const svg = svgNode('svg', { class: 'signal-memo-colour-swap', viewBox: '0 0 32 22', width: 32, height: 22, 'aria-hidden': true, ...attrs });
  svg.append(svgNode('rect', { x: .75, y: .75, width: 30.5, height: 20.5, rx: 5,
    fill: CIRCUIT_COLORS.background, stroke: CIRCUIT_COLORS.z, 'stroke-width': 1.3 }));
  for (const [x, fill] of [[10, PHASE_COLORS.positive], [22, PHASE_COLORS.negative]]) svg.append(svgNode('circle', {
    cx: x, cy: 11, r: 3.2, fill, stroke: '#ffffff', 'stroke-width': 1,
  }));
  svg.append(svgNode('path', { d: 'M9 5H23l-3-2.5M23 5l-3 2.5M23 17H9l3-2.5M9 17l3 2.5',
    fill: 'none', stroke: CIRCUIT_COLORS.z, 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}
function circuitDiagram(map, basis, glyph, gateName) {
  const row = map.rows[basis], outputs = row.outputs;
  const diagram = element('div', undefined, 'signal-memo-circuit'); diagram.dataset.input = row.input;
  const height = 84 + (map.rows.length - 1) * 44, y = basis => 56 + basis * 44;
  const svg = svgNode('svg', { class: 'signal-memo-paths', viewBox: `0 0 280 ${height}`, role: 'img',
    'aria-label': `Input ${row.input} through ${gateName}: ` +
      outputs.map(output => `${output.bits}, ${output.flipsColour ? 'swap' : 'keep'} colour`).join('; ') + '. Other input mappings are faded.' });
  const node = (bits, x, y, role, flipsColour = false) => {
    svg.append(svgNode('circle', { class: 'signal-memo-node', cx: x, cy: y, r: 8, fill: 'none',
      stroke: CIRCUIT_COLORS.text, 'stroke-width': 1.5, 'data-role': role, 'data-bits': bits, 'data-colour-swap': flipsColour,
      'data-active': role === 'output' || bits === row.input }));
  };
  map.rows.forEach((input, index) => {
    svg.append(svgNode('line', { class: 'signal-memo-lane', x1: 60, x2: 220, y1: y(index), y2: y(index), 'data-basis': input.input }));
    for (const [x, anchor] of [[44, 'end'], [236, 'start']]) {
      const text = svgNode('text', { class: 'signal-memo-bits', x, y: y(index), 'text-anchor': anchor, 'dominant-baseline': 'middle' });
      text.textContent = input.input; svg.append(text);
    }
  });
  // Reference columns are separate inputs. Only one is lit, so H does not appear to add them together.
  for (const input of [...map.rows.filter(input => input !== row), row]) {
    const fromY = y(Number.parseInt(input.input, 2));
    for (const output of input.outputs) {
      const toY = y(Number.parseInt(output.bits, 2));
      svg.append(svgNode('path', {
        class: 'signal-memo-path', d: flowPath(60, fromY, 220, toY),
        fill: 'none', stroke: CIRCUIT_COLORS.text, 'stroke-width': 3, 'stroke-linecap': 'round', 'data-role': 'output',
        'data-from': input.input, 'data-to': output.bits, 'data-colour-swap': output.flipsColour, 'data-active': input === row,
      }));
      if (output.flipsColour) svg.append(colourSwapGlyph({ x: 124, y: (fromY + toY) / 2 - 11,
        'data-from': input.input, 'data-to': output.bits, 'data-active': input === row }));
    }
  }
  map.rows.forEach((input, index) => node(input.input, 60, y(index), 'input'));
  outputs.forEach(output => node(output.bits, 220, y(Number.parseInt(output.bits, 2)), 'output', output.flipsColour));
  const gate = element('span', undefined, 'signal-memo-circuit-gate'); gate.setAttribute('aria-hidden', 'true'); gate.append(glyph);
  diagram.append(svg, gate);
  map.rows.forEach((input, index) => {
    const button = element('button', undefined, 'signal-memo-input-lane'); button.type = 'button'; button.dataset.memoInput = input.input;
    button.setAttribute('aria-label', `Use input ${input.input}`); button.setAttribute('aria-pressed', String(index === basis));
    button.style.top = y(index) / height * 100 + '%'; button.style.height = 44 / height * 100 + '%';
    diagram.append(button);
  });
  return diagram;
}

/** A closed-by-default memo; identical hole contexts retain their DOM and chosen gate. */
export function createGateMemo({ get, choices = gateMemoChoices, operation = operationFor, apply: evolve = apply, icon = iconFor, label = labelFor }) {
  const panel = get('signal-memo'), tabs = get('signal-memo-tabs'), body = get('signal-memo-body');
  const tabpanel = get('signal-memo-map'), caption = get('signal-memo-caption');
  const key = get('signal-memo-key'); key.append(colourSwapGlyph(), element('span', 'Swaps colour'));
  const gates = new Map();
  let context, selected, currentHole, basis = 0;
  function select(choice) {
    const entry = gates.get(choice); if (!entry) return;
    const { map, button } = entry;
    const focusedInput = document.activeElement?.closest('[data-memo-input]');
    basis = Math.min(basis, map.rows.length - 1);
    selected = choice;
    for (const [gate, { button }] of gates) {
      button.setAttribute('aria-selected', String(gate === choice)); button.tabIndex = gate === choice ? 0 : -1;
    }
    tabpanel.setAttribute('aria-labelledby', button.id);
    caption.textContent = 'Bits from left to right: ' + map.wires.map(wire => 'wire ' + (wire + 1)).join(', ');
    key.hidden = !map.rows.some(row => row.outputs.some(output => output.flipsColour));
    body.replaceChildren(circuitDiagram(map, basis, icon(map.operation, choice, currentHole), label(map.operation, choice, currentHole)));
    if (focusedInput) body.querySelector(`[data-memo-input="${map.rows[basis].input}"]`)?.focus({ preventScroll: true });
  }
  body.addEventListener('click', event => {
    const input = event.target.closest('[data-memo-input]')?.dataset.memoInput, next = Number.parseInt(input, 2);
    if (!input || next === basis || gates.get(selected)?.map.rows[next]?.input !== input) return;
    basis = next; select(selected);
  });
  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-memo-choice]');
    if (button && gates.get(button.dataset.memoChoice)?.button === button) select(button.dataset.memoChoice);
  });
  tabs.addEventListener('keydown', event => {
    const choices = [...gates.keys()], current = choices.indexOf(event.target.closest('[data-memo-choice]')?.dataset.memoChoice);
    if (current < 0) return;
    const next = event.key === 'ArrowRight' ? (current + 1) % choices.length : event.key === 'ArrowLeft' ? (current + choices.length - 1) % choices.length :
      event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); select(choices[next]); gates.get(choices[next]).button.focus();
  });
  return {
    update(hole) {
      panel.hidden = !hole;
      if (panel.hidden) return;
      const offered = choices(hole);
      const next = JSON.stringify([hole.wires, hole.controls ?? [], offered]);
      if (context === next) return;
      context = next; currentHole = hole; gates.clear();
      const reference = { ...hole, choices: offered };
      tabs.replaceChildren(...offered.map((choice, index) => {
        const map = gateMemoMap(reference, choice, { operation, apply: evolve });
        const button = element('button'); button.type = 'button'; button.id = 'signal-memo-tab-' + index; button.dataset.memoChoice = choice;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'signal-memo-map');
        button.setAttribute('aria-label', label(map.operation, choice, hole)); button.append(icon(map.operation, choice, hole));
        gates.set(choice, { map, button }); return button;
      }));
      select(gates.has(selected) ? selected : hole.choices.find(choice => choice !== 'I') ?? offered[0]);
    },
  };
}
