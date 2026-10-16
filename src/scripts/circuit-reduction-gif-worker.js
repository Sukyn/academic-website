import * as gifenc from 'gifenc';
import { getRule, applyMove, isSolved, validateCircuit, moveCost } from '../lib/circuit-reduction/engine.js';
import { CIRCUIT_COLORS } from '../lib/games/circuit-graphics.js';
import { drawCircuit } from '../lib/circuit-reduction/rendering.js';
import { installReplayEncoder } from '../lib/games/replay-gif.js';
const { GIFEncoder, applyPalette } = Reflect.get(gifenc, 'default') ?? gifenc;
const WIDTH = 960;
const colors = ['#18231e', CIRCUIT_COLORS.text, '#fff3cf', CIRCUIT_COLORS.z, CIRCUIT_COLORS.h, CIRCUIT_COLORS.x, CIRCUIT_COLORS.wire, '#213029'];

export function encodeReplay(round, onProgress, imageOnly = false) {
  if (typeof OffscreenCanvas !== 'function') throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  validateCircuit(round.circuit);
  if (typeof round.label !== 'string' || !Array.isArray(round.sequence) || !round.sequence.length || round.sequence.length > 2000) throw new Error('Finish a circuit before sharing its replay.');
  const samples = Math.min(96, round.sequence.length);
  const frames = imageOnly ? [] : [{ step: 0, circuit: round.circuit, cost: 0 }];
  let circuit = round.circuit, score = 0, sample = 1;
  // Validate every move, retaining only the states that will actually be drawn.
  for (let step = 1; step <= round.sequence.length; step++) {
    const move = round.sequence[step - 1];
    circuit = applyMove(circuit, move); score += moveCost(move);
    if (!imageOnly && step === Math.round(sample * round.sequence.length / samples)) {
      frames.push({ step, circuit, cost: score }); sample++;
    }
  }
  if (!isSolved(circuit)) throw new Error('This circuit has not been reduced to the identity.');
  const HEIGHT = (imageOnly ? 144 : 224) + round.circuit.length * 80;
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT), ctx = canvas.getContext('2d');
  if (!ctx) throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  const gif = imageOnly ? null : GIFEncoder();
  const palette = imageOnly ? null : colors.map(hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)));
  const stepDelay = Math.min(600, Math.max(80, Math.floor(1200 / samples) * 10));
  const frame = ({ step, circuit, cost }) => {
    const move = imageOnly ? undefined : round.sequence[step], rule = getRule(move?.rule);
    ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = colors[2]; ctx.font = '600 28px system-ui, sans-serif'; ctx.fillText(round.label, WIDTH / 2, 34, WIDTH - 32);
    ctx.fillStyle = colors[1]; ctx.font = '20px system-ui, sans-serif';
    const hasOptimal = Number.isInteger(round.optimalMoves);
    if (hasOptimal) ctx.fillText(`Optimal : ${round.optimalMoves}`, WIDTH / 2, 66);
    ctx.fillText(`My score : ${score}`, WIDTH / 2, hasOptimal ? 98 : 82);
    const spacing = Math.min(56, 850 / circuit[0].length), left = (WIDTH - spacing * circuit[0].length) / 2;
    drawCircuit(ctx, circuit, { left, top: 154, spacing, rowSpacing: 80, radius: Math.min(17, spacing * .36),
      selected: (y, x) => rule && y >= move.row && y < move.row + rule.left.length && x >= move.column && x < move.column + rule.left[0].length });
    if (!imageOnly && move) {
      ctx.fillStyle = colors[2]; ctx.font = '20px system-ui, sans-serif';
      const label = rule?.title ?? 'Identity spacing · free';
      ctx.fillText(`${moveCost(move) ? `Move ${cost + moveCost(move)}` : 'Layout'}: ${label}`, WIDTH / 2, HEIGHT - 40);
    }
    if (gif) {
      const indexed = applyPalette(ctx.getImageData(0, 0, WIDTH, HEIGHT).data, palette, 'rgb444');
      gif.writeFrame(indexed, WIDTH, HEIGHT, { palette, delay: step === round.sequence.length ? 1800 : step === 0 ? 1000 : stepDelay });
    }
  };
  if (imageOnly) { frame({ step: 0, circuit: round.circuit, cost: 0 }); return canvas; }
  onProgress?.(0);
  frame(frames[0]);
  for (let index = 1; index <= samples; index++) { frame(frames[index]); onProgress?.(index / samples); }
  gif.finish(); return gif.bytesView();
}
installReplayEncoder(encodeReplay);
