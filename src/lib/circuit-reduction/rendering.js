import { CIRCUIT_COLORS, svgNode, drawGate } from '../games/circuit-graphics.js';

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
    drawGate(ctx, cell, x, y, radius);
  }));
}
