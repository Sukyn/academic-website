import * as gifenc from 'gifenc';
import { applyPlacement, controlWire, simulate, validatePuzzle } from '../lib/quantum-signals/engine.js';
import { CIRCUIT_COLORS as colors, drawGate } from '../lib/games/circuit-graphics.js';
import { PHASE_COLORS, PHASE_PATH_COLORS, CANCELLATION_WALL, phasePathColor, phaseColor, alignTarget, targetRadius } from '../lib/quantum-signals/state-visuals.js';
import { flowTrace } from '../lib/quantum-signals/flow.js';
import { installReplayEncoder } from '../lib/games/replay-gif.js';

const { GIFEncoder, applyPalette } = Reflect.get(gifenc, 'default') ?? gifenc;
const WIDTH = 960;
const WHITE = '#f5f5f2';
const palette = [colors.background, colors.text, colors.h, colors.x, colors.z, colors.wire, WHITE, ...Object.values(PHASE_PATH_COLORS), ...Object.values(PHASE_COLORS)]
  .filter((color, index, list) => list.indexOf(color) === index)
  .map(hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)));

function drawBoard(ctx, puzzle, placements, top, selected) {
  const step = Math.min(88, 740 / puzzle.columns.length), left = (WIDTH - step * puzzle.columns.length) / 2;
  const y = row => top + row * 76;
  ctx.strokeStyle = WHITE; ctx.lineWidth = 1.8;
  for (let row = 0; row < puzzle.wires; row++) {
    ctx.beginPath(); ctx.moveTo(left - 20, y(row));
    ctx.lineTo(left + puzzle.columns.length * step + 20, y(row)); ctx.stroke();
  }
  puzzle.columns.forEach((column, index) => column.forEach(entry => {
    const x = left + (index + .5) * step, radius = Math.min(17, step * .36);
    const gate = entry.gate ?? (Object.hasOwn(placements, entry.id) ? placements[entry.id] : null);
    const controlledX = gate === 'CX' || gate === 'XC';
    if (controlledX || gate === 'CZ') {
      ctx.strokeStyle = colors.z; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(x, y(entry.wires[0])); ctx.lineTo(x, y(entry.wires[1])); ctx.stroke();
    }
    entry.wires.forEach(row => {
      if (entry.id) {
        if (!gate || gate === 'I') {
          ctx.fillStyle = colors.z; ctx.globalAlpha = selected === entry.id ? .12 : .05;
          ctx.fillRect(x - radius - 6, y(row) - radius - 6, (radius + 6) * 2, (radius + 6) * 2);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = selected === entry.id ? colors.h : colors.z; ctx.lineWidth = selected === entry.id ? 2 : 1;
        ctx.strokeRect(x - radius - 6, y(row) - radius - 6, (radius + 6) * 2, (radius + 6) * 2);
      }
      const glyph = controlledX ? row === controlWire(gate, entry.wires) ? 'Z' : 'X' : gate === 'CZ' ? 'Z' : gate;
      if (glyph && glyph !== 'I') drawGate(ctx, glyph, x, y(row), radius);
    });
  }));
}

function drawFlow(ctx, puzzle, placements, top, { imageOnly = false } = {}) {
  const { snapshots, columns, cancellations } = flowTrace(puzzle, placements);
  const step = imageOnly ? 740 / puzzle.columns.length : Math.min(88, 740 / puzzle.columns.length);
  const left = (WIDTH - step * puzzle.columns.length) / 2;
  const right = left + puzzle.columns.length * step, targetX = right + 54, y = basis => top + basis * (imageOnly ? 38 : 28);
  ctx.font = '14px system-ui, sans-serif'; ctx.fillStyle = colors.text;
  if (!imageOnly) {
    ctx.fillText('Output', right, top - 28); ctx.fillText('Target', targetX, top - 28);
  }
  for (let basis = 0; basis < snapshots[0].length; basis++) {
    ctx.fillText(basis.toString(2).padStart(puzzle.wires, '0'), left - 28, y(basis));
    ctx.strokeStyle = colors.wire; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, y(basis)); ctx.lineTo(right, y(basis)); ctx.stroke();
  }
  if (!imageOnly) {
    ctx.strokeStyle = colors.wire; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(right + 26, top - 44);
    ctx.lineTo(right + 26, y(snapshots[0].length - 1) + 16); ctx.stroke();
  }
  columns.forEach((edges, column) => {
    const start = left + column * step, end = start + step;
    for (const edge of edges) {
      ctx.strokeStyle = phasePathColor(edge.amplitude); ctx.lineWidth = 2 + 4 * Math.abs(edge.amplitude);
      ctx.beginPath(); ctx.moveTo(start, y(edge.from));
      ctx.bezierCurveTo(start + step / 2, y(edge.from), end - step / 2, y(edge.to), end, y(edge.to)); ctx.stroke();
    }
  });
  ctx.strokeStyle = PHASE_COLORS.negative; ctx.lineWidth = 2;
  cancellations.forEach((bases, column) => bases.forEach(basis => {
    ctx.beginPath();
    CANCELLATION_WALL.forEach(([dx, dy], index) => {
      const x = left + (column + 1) * step + dx;
      if (index) ctx.lineTo(x, y(basis) + dy);
      else ctx.moveTo(x, y(basis) + dy);
    });
    ctx.stroke();
  }));
  const dot = (x, basis, amplitude, target = false) => {
    if (Math.abs(amplitude) < 1e-9) return;
    ctx.fillStyle = phaseColor(amplitude); ctx.strokeStyle = PHASE_COLORS.negative; ctx.lineWidth = target ? 2 : 1.4;
    ctx.beginPath(); ctx.arc(x, y(basis), target ? targetRadius(amplitude) : 8 * Math.abs(amplitude), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  };
  snapshots.forEach((state, column) => state.forEach((amplitude, basis) => dot(left + column * step, basis, amplitude)));
  if (!imageOnly) alignTarget(puzzle.target, snapshots.at(-1)).forEach((amplitude, basis) => {
    if (Math.abs(amplitude) < 1e-9) {
      ctx.strokeStyle = colors.wire; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(targetX, y(basis), 6, 0, Math.PI * 2); ctx.stroke();
    } else dot(targetX, basis, amplitude, true);
  });
}

export function encodeReplay(round, onProgress, imageOnly = false) {
  if (typeof OffscreenCanvas !== 'function') throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  const puzzle = validatePuzzle(round.puzzle);
  if (typeof round.label !== 'string' || round.label.length > 240 || !Array.isArray(round.sequence) ||
      !round.sequence.length || round.sequence.length > 1000) throw new Error('Finish a circuit before sharing its replay.');
  const samples = Math.min(64, round.sequence.length), frames = imageOnly ? [] : [{ step: 0, placements: {} }];
  let placements = {}, sample = 1;
  for (let step = 1; step <= round.sequence.length; step++) {
    placements = applyPlacement(puzzle, placements, round.sequence[step - 1]);
    if (!imageOnly && step === Math.round(sample * round.sequence.length / samples)) {
      frames.push({ step, placements }); sample++;
    }
  }
  if (!simulate(puzzle, placements).solved) throw new Error('This circuit has not reached its target state.');
  const flowHeight = (2 ** puzzle.wires - 1) * (imageOnly ? 38 : 28);
  const height = imageOnly ? Math.max(240, 144 + flowHeight) : 246 + (puzzle.wires - 1) * 76 + flowHeight + 100;
  const flowTop = imageOnly ? (height + 48 - flowHeight) / 2 : 246 + (puzzle.wires - 1) * 76;
  const canvas = new OffscreenCanvas(WIDTH, height), ctx = canvas.getContext('2d');
  if (!ctx) throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  const gif = imageOnly ? null : GIFEncoder();
  const drawFrame = frame => {
    const move = round.sequence[frame.step - 1];
    ctx.fillStyle = colors.background; ctx.fillRect(0, 0, WIDTH, height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.h; ctx.font = '600 20px system-ui, sans-serif'; ctx.fillText(round.label, WIDTH / 2, 34, WIDTH - 40);
    if (!imageOnly) drawBoard(ctx, puzzle, frame.placements, 154, move?.hole);
    drawFlow(ctx, puzzle, frame.placements, flowTop, { imageOnly });
    if (gif) {
      const indexed = applyPalette(ctx.getImageData(0, 0, WIDTH, height).data, palette, 'rgb444');
      gif.writeFrame(indexed, WIDTH, height, { palette, delay: frame.step === round.sequence.length ? 1800 : frame.step === 0 ? 1000 : 500 });
    }
  };
  if (imageOnly) { drawFrame({ step: round.sequence.length, placements }); return canvas; }
  onProgress?.(0);
  for (const frame of frames) { drawFrame(frame); onProgress?.(frame.step / round.sequence.length); }
  gif.finish(); return gif.bytesView();
}

installReplayEncoder(encodeReplay);
