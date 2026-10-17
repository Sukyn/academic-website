import { CIRCUIT_COLORS, gateGlyph, svgNode } from '../games/circuit-graphics.js';
import { renderFlow } from '../quantum-signals/rendering.js';
import { flowTrace, touchedWires } from './engine.js';

const CELL_SIZE = 88, ROW_SIZE = 88;
const LEFT = 48, TOP = 8;
const cellKey = (wire, column) => wire + ':' + column;
const wireList = wires => wires.map(wire => wire + 1).join(', ');

export function operationLabel(operation) {
  if (!operation || operation.gate === 'I') return 'Identity';
  const name = operation.gate === 'SWAP' ? 'SWAP on wires ' + wireList(operation.wires) :
    operation.gate + ' on wire ' + wireList(operation.wires);
  return name + (operation.controls?.length ? ', controlled by wire' +
    (operation.controls.length === 1 ? ' ' : 's ') + wireList(operation.controls) : '');
}

function swapGlyph() {
  const svg = svgNode('svg', { viewBox: '0 0 44 44', width: 44, height: 44,
    'aria-hidden': true, class: 'gate-glyph' });
  svg.appendChild(svgNode('path', { d: 'M13 13L31 31M13 31L31 13',
    fill: 'none', stroke: CIRCUIT_COLORS.text, 'stroke-width': 2.8, 'stroke-linecap': 'round' }));
  return svg;
}

// A palette shows the same endpoints as the board, compressed to one icon.
export function operationIcon(operation) {
  if (!operation || operation.gate === 'I') {
    const svg = gateGlyph('.');
    svg.appendChild(svgNode('path', { d: 'M7 22H37', stroke: CIRCUIT_COLORS.text,
      'stroke-width': 1.8, 'stroke-opacity': .6 }));
    return svg;
  }
  if (!operation.controls?.length && operation.wires.length === 1) return gateGlyph(operation.gate);
  const rows = [...new Set(touchedWires(operation))].sort((a, b) => a - b);
  const y = wire => 11 + rows.indexOf(wire) * 22 / Math.max(1, rows.length - 1);
  const size = rows.length > 2 ? 14 : 22;
  const svg = svgNode('svg', { viewBox: '0 0 44 44', width: 44, height: 44,
    'aria-hidden': true, class: 'gate-glyph' });
  svg.appendChild(svgNode('line', { x1: 22, x2: 22, y1: y(rows[0]), y2: y(rows.at(-1)),
    stroke: CIRCUIT_COLORS.z, 'stroke-width': 1.8 }));
  for (const wire of rows) {
    if (operation.controls?.includes(wire)) {
      svg.appendChild(svgNode('circle', { cx: 22, cy: y(wire), r: 4.5, fill: CIRCUIT_COLORS.z }));
    } else {
      const glyph = operation.gate === 'SWAP' ? swapGlyph() : gateGlyph(operation.gate);
      for (const [name, value] of Object.entries({ x: 22 - size / 2, y: y(wire) - size / 2, width: size, height: size })) {
        glyph.setAttribute(name, String(value));
      }
      svg.appendChild(glyph);
    }
  }
  return svg;
}

// Cells remain native buttons for pointer, touch and keyboard selection. Controls
// carry their role separately from targets, even when both endpoints are dots.
export function renderCircuit(container, circuit, {
  selectedCells = [], holes = [], fixedColumns = circuit.columns.length - holes.length,
  locked = false, interactive = true,
} = {}) {
  const selected = selectedCells instanceof Set ? selectedCells : new Set(selectedCells);
  const width = LEFT + Math.max(1, circuit.columns.length) * CELL_SIZE + 24;
  const height = TOP * 2 + circuit.wires * ROW_SIZE;
  container.classList.add('categorical-board');
  Object.assign(container.style, { position: 'relative', width: width + 'px', height: height + 'px' });
  const fragment = document.createDocumentFragment();
  const svg = svgNode('svg', { width, height, viewBox: '0 0 ' + width + ' ' + height,
    class: 'categorical-wires', 'aria-hidden': true });
  Object.assign(svg.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  const centerX = column => LEFT + (column + .5) * CELL_SIZE;
  const centerY = wire => TOP + (wire + .5) * ROW_SIZE;
  for (let wire = 0; wire < circuit.wires; wire++) {
    svg.appendChild(svgNode('line', { x1: 16, x2: width - 16, y1: centerY(wire), y2: centerY(wire),
      stroke: '#f5f5f2', 'stroke-width': 1.8, class: 'categorical-wire' }));
  }
  const roles = new Map();
  circuit.columns.forEach((entries, column) => entries.forEach(operation => {
    const touched = touchedWires(operation), first = Math.min(...touched), last = Math.max(...touched);
    if (first !== last) svg.appendChild(svgNode('line', { x1: centerX(column), x2: centerX(column),
      y1: centerY(first), y2: centerY(last), stroke: CIRCUIT_COLORS.z,
      'stroke-width': 2, class: 'categorical-link' }));
    operation.wires.forEach(wire => roles.set(cellKey(wire, column), { operation, control: false }));
    (operation.controls ?? []).forEach(wire => {
      const key = cellKey(wire, column), role = roles.get(key);
      if (role) role.operations.push(operation);
      else roles.set(key, { operation, operations: [operation], control: true });
    });
  }));
  const holeCells = new Map();
  holes.forEach((hole, index) => {
    const column = hole.column ?? fixedColumns + index;
    hole.wires.forEach(wire => holeCells.set(cellKey(wire, column), index));
    // The slot's constructor remains visible before a gate is chosen. These
    // dim endpoints describe its controls, not a filled operation or amplitude.
    if (hole.controls?.length && !hole.wires.some(wire => roles.has(cellKey(wire, column)))) {
      const wires = [...hole.wires, ...hole.controls];
      svg.appendChild(svgNode('line', { x1: centerX(column), x2: centerX(column),
        y1: centerY(Math.min(...wires)), y2: centerY(Math.max(...wires)),
        stroke: CIRCUIT_COLORS.z, 'stroke-width': 2, 'stroke-opacity': .45,
        class: 'categorical-link', 'data-hole-context': index }));
      for (const wire of hole.controls) if (!roles.has(cellKey(wire, column))) {
        roles.set(cellKey(wire, column), { control: true, placeholder: true,
          label: 'Control for hole ' + (index + 1) + ', target wire' + (hole.wires.length > 1 ? 's ' : ' ') + wireList(hole.wires) });
      }
    }
  });
  fragment.appendChild(svg);
  for (let wire = 0; wire < circuit.wires; wire++) for (let column = 0; column < circuit.columns.length; column++) {
    const key = cellKey(wire, column), role = roles.get(key), hole = holeCells.get(key);
    const cell = document.createElement(interactive ? 'button' : 'div');
    cell.className = 'categorical-cell' + (selected.has(key) ? ' is-selected' : '') +
      (hole !== undefined ? ' is-hole' : '');
    Object.assign(cell.style, { position: 'absolute', left: (LEFT + column * CELL_SIZE) + 'px',
      top: (TOP + wire * ROW_SIZE) + 'px', width: CELL_SIZE + 'px', height: ROW_SIZE + 'px',
      display: 'grid', placeItems: 'center', padding: '0', border: '0', background: 'transparent' });
    cell.dataset.cell = key; cell.dataset.target = column + ':' + wire;
    cell.dataset.wire = String(wire); cell.dataset.column = String(column);
    cell.dataset.role = role?.control ? 'control' : role ? 'target' : 'identity';
    if (role?.placeholder) cell.dataset.placeholder = 'true';
    if (hole !== undefined) {
      cell.dataset.hole = String(hole); cell.dataset.filled = String(Boolean(role));
      const box = document.createElement('span'); box.className = 'categorical-hole';
      Object.assign(box.style, { position: 'absolute', width: '44px', height: '44px', borderRadius: '5px',
        border: '1.5px dashed ' + CIRCUIT_COLORS.z, background: 'rgba(154,217,209,.06)', pointerEvents: 'none' });
      cell.appendChild(box);
    }
    let label = 'Wire ' + (wire + 1) + ', column ' + (column + 1) + ': ';
    if (role?.control) label += role.label ?? 'control for ' + role.operations.map(operationLabel).join('; ');
    else label += operationLabel(role?.operation);
    if (hole !== undefined) label = 'Hole ' + (hole + 1) + ', ' + label;
    cell.setAttribute('aria-label', label);
    if (interactive) {
      cell.type = 'button'; cell.disabled = locked;
      cell.setAttribute('aria-pressed', String(selected.has(key)));
    }
    if (role) {
      const glyph = role.control ? gateGlyph('Z') : role.operation.gate === 'SWAP' ? swapGlyph() : gateGlyph(role.operation.gate);
      glyph.classList.add('categorical-endpoint');
      Object.assign(glyph.style, { position: 'relative', width: '44px', height: '44px', pointerEvents: 'none' });
      if (role.placeholder) glyph.style.opacity = '.45';
      cell.appendChild(glyph);
    }
    fragment.appendChild(cell);
  }
  container.replaceChildren(fragment);
}

export function renderAdvancedFlow(svg, targetSvg, circuit, target, { profile = 'controlled', selectedColumn } = {}) {
  // Keep the target reference stable across edits; the shared renderer caches its
  // markers independently from the evolving state and its overall phase.
  const puzzle = { ...circuit, target };
  if (Number.isInteger(selectedColumn) && puzzle.columns[selectedColumn]) {
    puzzle.columns = puzzle.columns.map((column, index) => index === selectedColumn ? [...column, { id: 'selected' }] : column);
  }
  renderFlow(svg, targetSvg, puzzle, {}, Number.isInteger(selectedColumn) ? 'selected' : undefined,
    { trace: flowTrace(circuit, profile) });
}
