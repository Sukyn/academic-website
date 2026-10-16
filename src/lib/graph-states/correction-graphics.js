import { CIRCUIT_COLORS as colors, drawGate, gateGlyph, svgNode } from '../games/circuit-graphics.js';

export const CORRECTION_SIZE = 40;
export const CORRECTION_LABELS = { H: 'Hadamard (H)', X: 'Pauli X', Z: 'Pauli Z', S: 'Phase gate (S)', SDG: 'Inverse phase gate (S†)' };
const phaseRadius = 11;

// Two circular segments leave a real transparent slit, including over a wire.
// Precompute the same geometry for the SVG and canvas renderers.
function phaseShape(rotation) {
  const gap = Math.asin(2 / phaseRadius);
  const arcs = [0, Math.PI].map(offset => {
    const start = rotation + offset + gap, end = rotation + offset + Math.PI - gap;
    const x = phaseRadius * Math.cos(start), y = phaseRadius * Math.sin(start);
    const endX = phaseRadius * Math.cos(end), endY = phaseRadius * Math.sin(end);
    return { start, end, x, y, path: `M${x} ${y}A${phaseRadius} ${phaseRadius} 0 0 1 ${endX} ${endY}Z` };
  });
  return { arcs, path: arcs.map(arc => arc.path).join('') };
}
const phases = { S: phaseShape(-Math.PI / 4), SDG: phaseShape(Math.PI / 4) };

/** A centred local Clifford gate, including its accessible name. */
export function correctionGlyph(gate, x, y) {
  const group = svgNode('g', { transform: `translate(${x},${y})`, class: 'graph-gate', 'data-gate': gate, role: 'img', 'aria-label': CORRECTION_LABELS[gate] });
  const title = svgNode('title'); title.textContent = CORRECTION_LABELS[gate]; group.appendChild(title);
  if (phases[gate]) {
    group.appendChild(svgNode('path', { d: phases[gate].path, fill: colors.z }));
  } else {
    const glyph = gateGlyph(gate);
    glyph.setAttribute('x', '-22'); glyph.setAttribute('y', '-22');
    group.appendChild(glyph);
  }
  return group;
}

/** Canvas counterpart used by the replay worker. */
export function drawCorrection(ctx, gate, x, y) {
  const phase = phases[gate];
  if (!phase) {
    drawGate(ctx, gate, x, y, 16);
    return;
  }
  ctx.fillStyle = colors.z;
  ctx.beginPath();
  for (const arc of phase.arcs) {
    ctx.moveTo(x + arc.x, y + arc.y);
    ctx.arc(x, y, phaseRadius, arc.start, arc.end);
    ctx.closePath();
  }
  ctx.fill();
}
