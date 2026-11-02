import { applyGate } from './engine.js';
import { gateIcon, gateLabel, flowPath } from './rendering.js';
import { svgNode } from '../games/circuit-graphics.js';
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
function circuitDiagram(map, basis, phase, glyph, gateName) {
  const row = map.rows[basis], outputs = row.outputs;
  const diagram = element('div', undefined, 'signal-memo-circuit'); diagram.dataset.input = row.input;
  diagram.dataset.phase = String(phase); diagram.dataset.bits = String(map.wires.length);
  const colour = value => value < 0 ? PHASE_COLORS.negative : PHASE_COLORS.positive;
  const name = value => value < 0 ? 'white' : 'black';
  // Large controlled maps omit unused lanes in each independent example.
  const lanes = map.rows.length > 4 ? map.rows.filter(input => input === row || outputs.some(output => output.bits === input.input)) : map.rows;
  const height = 84 + (lanes.length - 1) * 44, y = bits => 56 + lanes.findIndex(input => input.input === bits) * 44;
  const svg = svgNode('svg', { class: 'signal-memo-paths', viewBox: `0 0 240 ${height}`, role: 'img',
    'aria-label': `${name(phase)} input ${row.input} through ${gateName}: ` +
      outputs.map(output => `${output.bits}, ${name(output.flipsColour ? -phase : phase)}`).join('; ') });
  const node = (bits, x, role, value) => {
    svg.append(svgNode('circle', { class: 'signal-memo-node', cx: x, cy: y(bits), r: 9,
      fill: colour(value), stroke: '#ffffff', 'stroke-width': 1.5, 'data-role': role, 'data-bits': bits, 'data-phase': value }));
  };
  lanes.forEach(input => {
    svg.append(svgNode('line', { class: 'signal-memo-lane', x1: 56, x2: 184, y1: y(input.input), y2: y(input.input), 'data-basis': input.input }));
    for (const [x, anchor] of [[42, 'end'], [198, 'start']]) {
      const text = svgNode('text', { class: 'signal-memo-bits', x, y: y(input.input), 'text-anchor': anchor, 'dominant-baseline': 'middle' });
      text.textContent = input.input; svg.append(text);
    }
  });
  for (const output of outputs) {
    const outputPhase = output.flipsColour ? -phase : phase;
    let stroke = colour(phase);
    if (output.flipsColour) {
      const id = `memo-${basis}-${phase}-${output.bits}`;
      const gradient = svgNode('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: 56, x2: 184, y1: 0, y2: 0 });
      for (const [offset, value] of [[0, phase], [.5, phase], [.5, outputPhase], [1, outputPhase]]) {
        gradient.append(svgNode('stop', { offset, 'stop-color': colour(value) }));
      }
      const defs = svgNode('defs'); defs.append(gradient); svg.append(defs); stroke = `url(#${id})`;
    }
    const path = { d: flowPath(56, y(row.input), 184, y(output.bits)), fill: 'none', 'stroke-linecap': 'round' };
    svg.append(svgNode('path', { ...path, stroke: '#8e9b93', 'stroke-width': 5, class: 'signal-memo-path-outline' }));
    svg.append(svgNode('path', { ...path, class: 'signal-memo-path', stroke, 'stroke-width': 3,
      'data-from': row.input, 'data-to': output.bits, 'data-phase': outputPhase }));
  }
  node(row.input, 56, 'input', phase);
  outputs.forEach(output => node(output.bits, 184, 'output', output.flipsColour ? -phase : phase));
  const gate = element('span', undefined, 'signal-memo-circuit-gate'); gate.setAttribute('aria-hidden', 'true'); gate.append(glyph);
  diagram.append(svg, gate);
  return diagram;
}

/** A closed-by-default memo; identical hole contexts retain their DOM and chosen gate. */
export function createGateMemo({ get, choices = gateMemoChoices, operation = operationFor, apply: evolve = apply, icon = iconFor, label = labelFor }) {
  const panel = get('signal-memo'), tabs = get('signal-memo-tabs'), body = get('signal-memo-body');
  const tabpanel = get('signal-memo-map'), caption = get('signal-memo-caption');
  const gates = new Map();
  let context, selected, currentHole;
  function select(choice) {
    const entry = gates.get(choice); if (!entry) return;
    const { map, button } = entry;
    selected = choice;
    for (const [gate, { button }] of gates) {
      button.setAttribute('aria-selected', String(gate === choice)); button.tabIndex = gate === choice ? 0 : -1;
    }
    tabpanel.setAttribute('aria-labelledby', button.id);
    caption.textContent = 'Bits from left to right: ' + map.wires.map(wire => 'wire ' + (wire + 1)).join(', ');
    body.replaceChildren(...map.rows.flatMap((_, basis) => [1, -1].map(phase =>
      circuitDiagram(map, basis, phase, icon(map.operation, choice, currentHole), label(map.operation, choice, currentHole)))));
  }
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
