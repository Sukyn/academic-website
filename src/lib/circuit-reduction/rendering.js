// Gate shapes use paths instead of font-dependent ⊕ characters. Draw every
// connector first so neighbouring gates cannot paint over each other's symbols.
export const CIRCUIT_COLORS = { background: '#1b2822', text: '#dde3d7', h: '#f2d572', x: '#e5a89d', z: '#9ad9d1', wire: '#6d7b71' };
const NS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}
export function gateGlyph(cell) {
  const svg = svgNode('svg', { viewBox: '0 0 44 44', width: 44, height: 44, 'aria-hidden': 'true', class: 'gate-glyph' });
  if (cell === '.') return svg;
  const color = cell === 'H' ? CIRCUIT_COLORS.h : cell.startsWith('X') ? CIRCUIT_COLORS.x : CIRCUIT_COLORS.z;
  const common = { fill: CIRCUIT_COLORS.background, stroke: color, 'stroke-width': 2.4 };
  if (cell === 'H') {
    svg.appendChild(svgNode('rect', { x: 6, y: 6, width: 32, height: 32, fill: color }));
  } else if (cell.startsWith('X')) {
    svg.appendChild(svgNode('circle', { cx: 22, cy: 22, r: 16, ...common }));
    svg.appendChild(svgNode('path', { d: 'M22 12V32M12 22H32', fill: 'none', stroke: color, 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
  } else svg.appendChild(svgNode('circle', { cx: 22, cy: 22, r: 6, fill: color }));
  return svg;
}
export function spaceGlyph() {
  const svg = svgNode('svg', { viewBox: '0 0 20 20', width: 20, height: 20, 'aria-hidden': 'true', class: 'space-glyph' });
  svg.appendChild(svgNode('rect', { x: 3, y: 3, width: 14, height: 14, fill: 'var(--color-surface-2)' }));
  svg.appendChild(svgNode('path', { d: 'M5 10H15M10 5V15', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }));
  return svg;
}
export function circuitWires(circuit, { cellWidth = 64, cellHeight = 72, gutter = 44, header = 36, slotGaps = false } = {}) {
  const width = gutter + circuit[0].length * cellWidth, height = header + circuit.length * cellHeight;
  const svg = svgNode('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'circuit-wires', 'aria-hidden': 'true' });
  for (let row = 0; row < circuit.length; row++) {
    const y = header + (row + .5) * cellHeight;
    const wire = (x1, x2) => svg.appendChild(svgNode('line', { x1, y1: y, x2, y2: y, stroke: CIRCUIT_COLORS.wire, 'stroke-width': 1.5 }));
    if (slotGaps) {
      for (let column = 0; column < circuit[0].length; column++) {
        wire(gutter + column * cellWidth + (column ? 1.5 : 0), gutter + (column + 1) * cellWidth - (column < circuit[0].length - 1 ? 1.5 : 0));
      }
    } else wire(gutter, width);
  }
  circuit.forEach((line, row) => line.forEach((cell, column) => {
    if (cell.endsWith('U')) {
      const x = gutter + (column + .5) * cellWidth, y = header + (row + .5) * cellHeight;
      svg.appendChild(svgNode('line', { x1: x, y1: y, x2: x, y2: y + cellHeight, stroke: CIRCUIT_COLORS.z, 'stroke-width': 2.4 }));
    }
  }));
  return svg;
}
export function drawCircuit(ctx, circuit, { left, top, spacing, rowSpacing = 72, radius = 16, selected } = {}) {
  const colors = CIRCUIT_COLORS;
  ctx.lineWidth = 1.5; ctx.strokeStyle = colors.wire;
  circuit.forEach((_, row) => {
    const y = top + row * rowSpacing;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + spacing * circuit[0].length, y); ctx.stroke();
  });
  // Links are a distinct background pass. No connector crosses an X plus sign.
  ctx.lineWidth = 2.4; ctx.strokeStyle = colors.z;
  circuit.forEach((line, row) => line.forEach((cell, column) => {
    if (cell.endsWith('U')) {
      const x = left + (column + .5) * spacing, y = top + row * rowSpacing;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowSpacing); ctx.stroke();
    }
  }));
  circuit.forEach((line, row) => line.forEach((cell, column) => {
    const x = left + (column + .5) * spacing, y = top + row * rowSpacing;
    if (selected?.(row, column)) { ctx.strokeStyle = colors.z; ctx.lineWidth = 1; ctx.strokeRect(x - spacing / 2 + 2, y - 28, spacing - 4, 56); }
    if (cell === '.') return;
    const color = cell === 'H' ? colors.h : cell.startsWith('X') ? colors.x : colors.z;
    ctx.fillStyle = colors.background; ctx.strokeStyle = color; ctx.lineWidth = 2.4;
    if (cell === 'H') {
      ctx.fillStyle = color; ctx.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
    } else if (cell.startsWith('X')) {
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - radius * .6, y); ctx.lineTo(x + radius * .6, y); ctx.moveTo(x, y - radius * .6); ctx.lineTo(x, y + radius * .6); ctx.stroke();
    } else { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, Math.max(4, radius * .375), 0, Math.PI * 2); ctx.fill(); }
  }));
}
