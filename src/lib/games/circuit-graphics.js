// Circuit gates share shapes and colors; each game owns its wire layout.
export const CIRCUIT_COLORS = { background: '#1b2822', text: '#dde3d7', h: '#f2d572', x: '#e5a89d', z: '#9ad9d1', wire: '#6d7b71' };
const gateColor = cell => cell === 'H' ? CIRCUIT_COLORS.h : cell.startsWith('X') ? CIRCUIT_COLORS.x : CIRCUIT_COLORS.z;

export function svgNode(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

// Draw targets with paths rather than font-dependent ⊕ characters.
export function gateGlyph(cell) {
  const svg = svgNode('svg', { viewBox: '0 0 44 44', width: 44, height: 44, 'aria-hidden': 'true', class: 'gate-glyph' });
  if (cell === '.') return svg;
  const color = gateColor(cell);
  const common = { fill: CIRCUIT_COLORS.background, stroke: color, 'stroke-width': 2.4 };
  if (cell === 'H') {
    svg.appendChild(svgNode('rect', { x: 6, y: 6, width: 32, height: 32, fill: color }));
  } else if (cell.startsWith('X')) {
    svg.appendChild(svgNode('circle', { cx: 22, cy: 22, r: 16, ...common }));
    svg.appendChild(svgNode('path', { d: 'M22 12V32M12 22H32', fill: 'none', stroke: color, 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
  } else svg.appendChild(svgNode('circle', { cx: 22, cy: 22, r: 8, fill: color }));
  return svg;
}

export function drawGate(ctx, cell, x, y, radius) {
  if (cell === '.') return;
  const color = gateColor(cell);
  ctx.fillStyle = CIRCUIT_COLORS.background; ctx.strokeStyle = color; ctx.lineWidth = 2.4;
  if (cell === 'H') {
    ctx.fillStyle = color; ctx.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
  } else if (cell.startsWith('X')) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - radius * .6, y); ctx.lineTo(x + radius * .6, y); ctx.moveTo(x, y - radius * .6); ctx.lineTo(x, y + radius * .6); ctx.stroke();
  } else {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, Math.max(4, radius * .5), 0, Math.PI * 2); ctx.fill();
  }
}
