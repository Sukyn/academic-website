import * as gifenc from 'gifenc';
import { applyMove, isSolved, validateCircuit, moveCost } from '../lib/circuit-reduction/engine.js';
import { CIRCUIT_COLORS, drawGate } from '../lib/games/circuit-graphics.js';
import { drawCircuit } from '../lib/circuit-reduction/rendering.js';
import { createRewriteTransition, transitionSample, REWRITE_DURATION } from '../lib/circuit-reduction/transition.js';
import { installReplayEncoder } from '../lib/games/replay-gif.js';
const { GIFEncoder, applyPalette } = Reflect.get(gifenc, 'default') ?? gifenc;
const IMAGE_WIDTH = 960, GIF_WIDTH = 720, MAX_TRANSITIONS = 16, TWEEN_FRAMES = 8, CIRCUIT_TOP = 100;
const colors = ['#18231e', CIRCUIT_COLORS.text, '#fff3cf', CIRCUIT_COLORS.z, CIRCUIT_COLORS.h, CIRCUIT_COLORS.x, CIRCUIT_COLORS.wire];

// A single small palette, including fade/antialias shades, serves every frame.
const rgb = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
const background = rgb(colors[0]);
const palette = [background, ...[...colors.slice(1), CIRCUIT_COLORS.background].flatMap(hex => {
  const color = rgb(hex);
  return [.2, .4, .6, .8, 1].map(opacity => color.map((value, index) => Math.round(background[index] + (value - background[index]) * opacity)));
})];

function drawTransition(ctx, before, plan, layout) {
  const { left, top, spacing, rowSpacing, radius } = layout;
  const oldGates = new Set(plan.gates.filter(item => item.phase !== 'in').map(item => `${item.row}:${item.fromColumn}`));
  const oldLinks = new Set(plan.links.filter(item => item.phase !== 'in').map(item => `${item.row}:${item.fromColumn}`));
  ctx.lineWidth = 1.5; ctx.strokeStyle = CIRCUIT_COLORS.wire;
  before.forEach((_, row) => {
    const y = top + row * rowSpacing;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + spacing * before[0].length, y); ctx.stroke();
  });
  const link = (row, column) => {
    const x = left + (column + .5) * spacing, y = top + row * rowSpacing;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowSpacing); ctx.stroke();
  };
  ctx.lineWidth = 2.4; ctx.strokeStyle = CIRCUIT_COLORS.z;
  before.forEach((line, row) => line.forEach((cell, column) => {
    if (cell.endsWith('U') && !oldLinks.has(`${row}:${column}`)) link(row, column);
  }));
  // Connectors are always behind the gate shapes and connect adjacent wires.
  for (const item of plan.links) {
    const sample = transitionSample(item, layout.progress);
    if (!sample.opacity) continue;
    ctx.globalAlpha = sample.opacity;
    link(item.row, sample.column);
  }
  ctx.globalAlpha = 1;
  before.forEach((line, row) => line.forEach((cell, column) => {
    if (!oldGates.has(`${row}:${column}`)) drawGate(ctx, cell, left + (column + .5) * spacing, top + row * rowSpacing, radius);
  }));
  for (const item of plan.gates) {
    const sample = transitionSample(item, layout.progress);
    if (!sample.opacity) continue;
    ctx.save(); ctx.globalAlpha = sample.opacity;
    ctx.translate(left + (sample.column + .5) * spacing, top + item.row * rowSpacing);
    ctx.scale(sample.scale, sample.scale);
    drawGate(ctx, item.cell, 0, 0, radius);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// gifenc writes image descriptors at (0, 0). Set the circuit crop's vertical
// origin in its standard GIF descriptor, leaving the first frame's header live.
function writeFrame(gif, indexed, width, height, delay, first) {
  const start = gif.bytesView().length;
  gif.writeFrame(indexed, width, height, { ...(first ? { palette } : {}), delay, dispose: 1 });
  if (!first) {
    const bytes = gif.bytesView(), descriptor = start + 8;
    if (bytes[descriptor] !== 0x2c) throw new Error('Could not encode the replay frame.');
    bytes[descriptor + 3] = CIRCUIT_TOP & 255;
    bytes[descriptor + 4] = CIRCUIT_TOP >> 8;
  }
}

export function encodeReplay(round, onProgress, imageOnly = false) {
  if (typeof OffscreenCanvas !== 'function') throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  validateCircuit(round.circuit);
  if (typeof round.label !== 'string' || !Array.isArray(round.sequence) || !round.sequence.length || round.sequence.length > 2000) throw new Error('Finish a circuit before sharing its replay.');
  // Spend the animation budget on rewrites. Free spacing edits can otherwise
  // crowd the actual simplification steps out of a normal daily replay.
  let trailingLayout = false;
  const selectedSteps = new Set();
  if (!imageOnly) {
    const rewriteSteps = round.sequence.flatMap((move, index) => moveCost(move) ? [index + 1] : []);
    const candidates = rewriteSteps.length ? rewriteSteps : round.sequence.map((_, index) => index + 1);
    trailingLayout = candidates.at(-1) < round.sequence.length;
    const samples = Math.min(MAX_TRANSITIONS - Number(trailingLayout), candidates.length);
    for (let index = 0; index < samples; index++) selectedSteps.add(candidates[Math.round((index + 1) * candidates.length / samples) - 1]);
  }
  const transitions = [];
  let circuit = round.circuit, score = 0;
  // Validate every move, retaining only the states that will actually be drawn.
  for (let step = 1; step <= round.sequence.length; step++) {
    const move = round.sequence[step - 1];
    const before = circuit;
    circuit = applyMove(circuit, move); score += moveCost(move);
    if (!imageOnly && selectedSteps.has(step)) {
      transitions.push({ step, before, after: circuit, move });
    }
  }
  if (!isSolved(circuit)) throw new Error('This circuit has not been reduced to the identity.');
  const width = imageOnly ? IMAGE_WIDTH : GIF_WIDTH, scale = width / IMAGE_WIDTH;
  const height = (144 + round.circuit.length * 80) * scale;
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d');
  if (!ctx) throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  const header = () => {
    ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = colors[2]; ctx.font = `600 ${28 * scale}px system-ui, sans-serif`; ctx.fillText(round.label, width / 2, 34 * scale, width - 32 * scale);
    ctx.fillStyle = colors[1]; ctx.font = `${20 * scale}px system-ui, sans-serif`;
    const hasOptimal = Number.isInteger(round.optimalMoves);
    if (hasOptimal) ctx.fillText(`Optimal : ${round.optimalMoves}`, width / 2, 66 * scale);
    ctx.fillText(`My score : ${score}`, width / 2, (hasOptimal ? 98 : 82) * scale);
  };
  const layout = circuit => {
    const spacing = Math.min(56, 850 / circuit[0].length) * scale;
    return { left: (width - spacing * circuit[0].length) / 2, top: 154 * scale, spacing, rowSpacing: 80 * scale, radius: Math.min(17 * scale, spacing * .36) };
  };
  header();
  drawCircuit(ctx, round.circuit, layout(round.circuit));
  if (imageOnly) return canvas;
  const gif = GIFEncoder();
  const pixels = (first, delay) => {
    const y = first ? 0 : CIRCUIT_TOP;
    const indexed = applyPalette(ctx.getImageData(0, y, width, height - y).data, palette, 'rgb444');
    writeFrame(gif, indexed, width, height - y, delay, first);
  };
  const frame = (circuit, delay, plan, progress) => {
    ctx.fillStyle = colors[0]; ctx.fillRect(0, CIRCUIT_TOP, width, height - CIRCUIT_TOP);
    const geometry = layout(circuit);
    if (plan) drawTransition(ctx, circuit, plan, { ...geometry, progress });
    else drawCircuit(ctx, circuit, geometry);
    pixels(false, delay);
  };
  onProgress?.(0);
  pixels(true, 1000);
  let previousStep = 0;
  const outputSteps = transitions.length + Number(trailingLayout);
  transitions.forEach(({ step, before, after, move }, index) => {
    // Only retained moves animate; skipped moves are still fully validated.
    if (step !== previousStep + 1) frame(before, 60);
    const plan = createRewriteTransition(before, after, move), final = index === transitions.length - 1 && !trailingLayout;
    if (plan) {
      for (let tween = 1; tween <= TWEEN_FRAMES; tween++) {
        const complete = tween === TWEEN_FRAMES;
        frame(complete ? after : before, complete && final ? 1800 : REWRITE_DURATION / TWEEN_FRAMES,
          complete ? null : plan, tween / TWEEN_FRAMES);
      }
    } else frame(after, final ? 1800 : 80);
    previousStep = step;
    onProgress?.((index + 1) / outputSteps);
  });
  if (trailingLayout) { frame(circuit, 1800); onProgress?.(1); }
  gif.finish(); return gif.bytesView();
}
installReplayEncoder(encodeReplay);
