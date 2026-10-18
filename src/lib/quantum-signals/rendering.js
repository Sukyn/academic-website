import { gateGlyph, svgNode } from '../games/circuit-graphics.js';
import { controlWire, stateEqual } from './engine.js';
import { flowTrace } from './flow.js';
import { PHASE_COLORS, CANCELLATION_WALL, phasePathColor, phaseColor, canonicalTarget, targetRadius, grayBasis, basisRow } from './state-visuals.js';

const SLOT = 88, ROW = 88, LEFT = 92, TOP = 46;
const renderedTargets = new WeakMap();
export const signalBoardWidth = columns => LEFT + columns * SLOT + 64;
const boardWidth = puzzle => signalBoardWidth(puzzle.columns.length);
export const flowColumnX = boundary => LEFT + (boundary - .5) * SLOT;
const span = (className, text) => { const node = document.createElement('span'); node.className = className; node.textContent = text; return node; };

export function gateLabel(gate, wires = [0, 1]) {
  if (gate === 'I') return 'Empty wire (identity)';
  if (gate === 'CX' || gate === 'XC') return 'CNOT: ' + (controlWire(gate, wires) === Math.min(...wires) ? 'upper' : 'lower') + ' control';
  return gate;
}

export function gateIcon(gate, wires = [0, 1]) {
  if (gate === 'I') return span('signal-empty', '—');
  if (gate === 'CX' || gate === 'XC' || gate === 'CZ') {
    const pair = span('signal-twin', '');
    const upperControl = controlWire(gate, wires) === Math.min(...wires);
    pair.append(...(gate === 'CZ' ? ['Z', 'Z'] : upperControl ? ['Z', 'X'] : ['X', 'Z']).map(gateGlyph));
    return pair;
  }
  return gateGlyph(gate);
}

export function renderBoard(board, puzzle, placements, { selected, locked = false } = {}) {
  const width = boardWidth(puzzle), height = puzzle.wires * ROW + 8;
  board.style.width = width + 'px'; board.style.height = height + 'px';
  const fragment = document.createDocumentFragment();
  const svg = svgNode('svg', { width, height, viewBox: '0 0 ' + width + ' ' + height, class: 'signal-wires', 'aria-hidden': true });
  for (let row = 0; row < puzzle.wires; row++) {
    const group = svgNode('g', { class: 'signal-path', 'data-wire': row });
    group.appendChild(svgNode('line', { x1: 16, x2: width - 96, y1: TOP + row * ROW, y2: TOP + row * ROW,
      stroke: '#f5f5f2', 'stroke-width': 1.8 }));
    svg.appendChild(group);
  }
  fragment.appendChild(svg);
  puzzle.columns.forEach((column, index) => column.forEach(entry => {
    const hole = Boolean(entry.id), gate = hole ? Object.hasOwn(placements, entry.id) ? placements[entry.id] : undefined : entry.gate;
    const first = Math.min(...entry.wires), last = Math.max(...entry.wires);
    const node = document.createElement(hole ? 'button' : 'div');
    node.className = hole ? 'signal-hole' : 'signal-fixed';
    node.style.left = (LEFT + index * SLOT) + 'px'; node.style.top = (TOP + first * ROW) + 'px';
    node.style.height = ((last - first) * ROW + 44) + 'px';
    if (hole) {
      node.type = 'button'; node.dataset.hole = entry.id; node.dataset.filled = String(gate !== undefined);
      node.setAttribute('aria-pressed', String(selected === entry.id)); node.disabled = locked;
      node.setAttribute('aria-label', 'Hole ' + entry.id + ', wire' + (entry.wires.length > 1 ? 's ' : ' ') + entry.wires.map(row => row + 1).join(' and ') + ': ' + (gate ? gateLabel(gate, entry.wires) : 'unfilled'));
    } else node.setAttribute('aria-hidden', 'true');
    if (entry.wires.length === 2 && gate && gate !== 'I') {
      const link = span('signal-link', '');
      link.style.top = '22px'; link.style.height = ((last - first) * ROW) + 'px'; node.appendChild(link);
    }
    for (const row of gate && gate !== 'I' ? entry.wires : []) {
      const endpoint = span('signal-endpoint', '');
      endpoint.style.setProperty('--endpoint-top', ((row - first) * ROW) + 'px');
      endpoint.appendChild(gateIcon(gate === 'CX' || gate === 'XC' ? row === controlWire(gate, entry.wires) ? 'Z' : 'X' : gate === 'CZ' ? 'Z' : gate));
      node.appendChild(endpoint);
    }
    fragment.appendChild(node);
  }));
  board.replaceChildren(fragment);
}

export function highlightFlow(svg, puzzle, selected) {
  const column = selected ? puzzle.columns.findIndex(entries => entries.some(entry => entry.id === selected)) : -1;
  highlightFlowColumn(svg, column);
}

export function highlightFlowColumn(svg, column) {
  const marker = svg.querySelector('.signal-flow-selection');
  if (!marker || column < 0) return;
  marker.setAttribute('x', String(flowColumnX(column))); marker.dataset.column = String(column);
}

export function pinFlowLabels(svg, scrollLeft) {
  svg.querySelector('.signal-flow-gutter')?.setAttribute('transform', 'translate(' + scrollLeft + ',0)');
}

export function highlightFlowBits(svg, wires = []) {
  for (const bit of svg.querySelectorAll('.signal-flow-label tspan')) {
    bit.classList.toggle('signal-flow-bit-highlight', wires.includes(Number(bit.dataset.wire)));
  }
}

export function renderFlow(svg, targetSvg, puzzle, placements, selected, { trace, selectedColumn } = {}) {
  const { snapshots, columns, cancellations } = trace ?? flowTrace(puzzle, placements), output = snapshots.at(-1);
  const target = canonicalTarget(puzzle.target), count = output.length;
  const width = boardWidth(puzzle) - 52, height = count * 34 + 62;
  const x = flowColumnX, y = basis => 44 + basisRow(basis) * 34;
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  const targetChanged = renderedTargets.get(targetSvg) !== puzzle.target;
  if (targetChanged) {
    targetSvg.setAttribute('width', '52'); targetSvg.setAttribute('height', String(height));
    targetSvg.setAttribute('viewBox', '0 0 52 ' + height);
  }
  targetSvg.dataset.match = String(stateEqual(output, puzzle.target));
  const fragment = document.createDocumentFragment(), description = svgNode('desc', {});
  const describe = state => state.flatMap((amplitude, basis) => Math.abs(amplitude) < 1e-9 ? [] :
    [basis.toString(2).padStart(puzzle.wires, '0') + ', ' + Number((amplitude ** 2 * 100).toFixed(2)) + '%, ' + (amplitude < 0 ? 'minus' : 'plus') + ' phase']).join('; ');
  description.textContent = snapshots.map((state, boundary) => (boundary ? 'After column ' + boundary : 'Input') + ': ' + describe(state)).join('. ') + '. Target: ' + describe(target);
  description.textContent += cancellations.flatMap((bases, column) => bases.length ?
    ['. Opposite phases cancel after column ' + (column + 1) + ' at ' + bases.map(basis => basis.toString(2).padStart(puzzle.wires, '0')).join(', ')] : []).join('');
  fragment.appendChild(description);
  selectedColumn ??= selected ? puzzle.columns.findIndex(column => column.some(entry => entry.id === selected)) : -1;
  if (selectedColumn >= 0) fragment.appendChild(svgNode('rect', { class: 'signal-flow-selection', 'data-column': selectedColumn,
    x: x(selectedColumn), y: 28, width: SLOT, height: height - 42, rx: 6 }));
  for (const [label, position] of [['Input', x(0)], ['Output', x(columns.length)]]) {
    const text = svgNode('text', { x: position, y: 16, class: 'signal-flow-heading', 'text-anchor': 'middle' });
    text.textContent = label; fragment.appendChild(text);
  }
  const gutter = svgNode('g', { class: 'signal-flow-gutter' });
  gutter.appendChild(svgNode('rect', { x: 0, y: 28, width: 40, height: height - 28 }));
  for (let row = 0; row < count; row++) {
    const basis = grayBasis(row);
    fragment.appendChild(svgNode('line', { class: 'signal-flow-lane', 'data-basis': basis, x1: x(0), x2: x(columns.length), y1: y(basis), y2: y(basis) }));
    const label = svgNode('text', { x: 8, y: y(basis) + 4, class: 'signal-flow-label', 'data-basis': basis });
    [...basis.toString(2).padStart(puzzle.wires, '0')].forEach((value, wire) => {
      const bit = svgNode('tspan', { 'data-wire': wire, 'data-bit': value });
      bit.textContent = value; label.appendChild(bit);
    });
    gutter.appendChild(label);
  }
  columns.forEach((edges, column) => edges.forEach(edge => {
    const path = svgNode('path', { class: 'signal-flow-path', 'data-column': column, 'data-from': edge.from, 'data-to': edge.to,
      'data-amplitude': edge.amplitude, 'data-phase': edge.amplitude < 0 ? '-' : '+',
      d: 'M' + x(column) + ',' + y(edge.from) + ' C' + (x(column) + SLOT / 2) + ',' + y(edge.from) + ' ' +
        (x(column + 1) - SLOT / 2) + ',' + y(edge.to) + ' ' + x(column + 1) + ',' + y(edge.to),
      stroke: phasePathColor(edge.amplitude), 'stroke-width': 2 + 4 * Math.abs(edge.amplitude) });
    fragment.appendChild(path);
  }));
  cancellations.forEach((bases, column) => bases.forEach(basis => {
    const wall = svgNode('path', { class: 'signal-flow-cancellation', 'data-boundary': column + 1, 'data-basis': basis,
      d: CANCELLATION_WALL.map(([dx, dy], index) => (index ? 'L' : 'M') + (x(column + 1) + dx) + ',' + (y(basis) + dy)).join(' '),
      fill: 'none', stroke: PHASE_COLORS.negative, 'stroke-width': 2, 'stroke-linejoin': 'round', role: 'img',
      'aria-label': basis.toString(2).padStart(puzzle.wires, '0') + ': opposite phases cancel; no outgoing amplitude' });
    fragment.appendChild(wall);
  }));
  snapshots.forEach((state, boundary) => state.forEach((amplitude, basis) => {
    if (Math.abs(amplitude) < 1e-9) return;
    const node = svgNode('circle', { class: 'signal-flow-node', 'data-boundary': boundary, 'data-basis': basis,
      'data-amplitude': amplitude, 'data-phase': amplitude < 0 ? '-' : '+', cx: x(boundary), cy: y(basis),
      r: 8 * Math.abs(amplitude), fill: phaseColor(amplitude), stroke: PHASE_COLORS.negative, role: 'img',
      'aria-label': basis.toString(2).padStart(puzzle.wires, '0') + ': ' + Number((amplitude ** 2 * 100).toFixed(2)) + '%, ' + (amplitude < 0 ? '−' : '+') + ' phase' });
    fragment.appendChild(node);
  }));
  if (targetChanged) {
    const targetFragment = document.createDocumentFragment(), heading = svgNode('text', {
      x: 26, y: 16, class: 'signal-flow-heading', 'text-anchor': 'middle' });
    heading.textContent = 'Target'; targetFragment.appendChild(heading);
    target.forEach((amplitude, basis) => {
      if (Math.abs(amplitude) < 1e-9) return;
      const node = svgNode('circle', { class: 'signal-flow-target', 'data-basis': basis, 'data-amplitude': amplitude,
        'data-phase': amplitude < 0 ? '-' : '+', cx: 26, cy: y(basis), r: targetRadius(amplitude),
        fill: phaseColor(amplitude), stroke: PHASE_COLORS.negative, role: 'img',
        'aria-label': 'Target ' + basis.toString(2).padStart(puzzle.wires, '0') + ': ' + Number((amplitude ** 2 * 100).toFixed(2)) + '%, ' + (amplitude < 0 ? '−' : '+') + ' phase' });
      targetFragment.appendChild(node);
    });
    targetSvg.replaceChildren(targetFragment);
    renderedTargets.set(targetSvg, puzzle.target);
  }
  fragment.appendChild(gutter); svg.replaceChildren(fragment);
  pinFlowLabels(svg, svg.parentElement?.scrollLeft ?? 0);
}
