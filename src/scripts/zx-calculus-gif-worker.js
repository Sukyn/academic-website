import * as gifenc from 'gifenc';
import { applyMove, isSolved, MAX_MOVES, validateDiagram } from '../lib/zx-calculus/engine.js';
import { diagramLayout, drawDiagram, ZX_COLORS } from '../lib/zx-calculus/rendering.js';
import { createRewriteScene, drawRewriteFrame, rewriteDuration, REPLAY_MOVE_DURATION } from '../lib/zx-calculus/animation.js';
import { installReplayEncoder, writeReplayFrame } from '../lib/games/replay-gif.js';

const { GIFEncoder, applyPalette } = Reflect.get(gifenc, 'default') ?? gifenc;
const BACKGROUND = '#1b2822';
const ANIMATION_FRAMES = 8, MAX_TRANSITIONS = 24, BOARD_TOP = 100;
const palette = [BACKGROUND, ZX_COLORS.z, ZX_COLORS.x, ZX_COLORS.h, ZX_COLORS.wire, '#899b91']
  .map(hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)));

export function encodeReplay(round, onProgress, imageOnly = false) {
  if (typeof OffscreenCanvas !== 'function') throw new DOMException('Your browser cannot create replay images.', 'NotSupportedError');
  const original = validateDiagram(round.puzzle);
  if (typeof round.label !== 'string' || round.label.length > 120 || !Array.isArray(round.sequence) ||
      !round.sequence.length || round.sequence.length > MAX_MOVES) throw new RangeError('Finish a diagram before sharing.');
  const selectedSteps = new Set();
  if (!imageOnly) {
    const count = Math.min(MAX_TRANSITIONS, round.sequence.length);
    for (let index = 1; index <= count; index++) selectedSteps.add(Math.ceil(index * round.sequence.length / count));
  }
  let diagram = original;
  let layout = imageOnly ? null : diagramLayout(original, round.views?.[0]);
  const originalLayout = layout;
  const transitions = [];
  // Validate every move; retain states only for the rewrites we animate.
  for (let index = 0; index < round.sequence.length; index++) {
    const before = diagram, beforeLayout = layout, move = round.sequence[index];
    diagram = applyMove(diagram, move);
    if (!imageOnly) layout = diagramLayout(diagram, round.views?.[index + 1] ?? beforeLayout);
    if (selectedSteps.has(index + 1)) transitions.push({ before, after: diagram, move, step: index + 1, layout: beforeLayout, nextLayout: layout });
  }
  if (!isSolved(diagram)) throw new RangeError('Reach the target before sharing.');
  const width = imageOnly ? 960 : 720, height = imageOnly ? 480 : 360;
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d');
  if (!ctx) throw new DOMException('Your browser cannot create replay images.', 'NotSupportedError');
  const target = { x: width * .76, y: 100, width: width * .21, height: height - 130 };
  const board = { x: 15, y: 100, width: width * .70, height: height - 125 };
  ctx.fillStyle = BACKGROUND; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = ZX_COLORS.h; ctx.font = '600 18px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(round.label, width / 2, 30, width - 40);
  ctx.fillStyle = ZX_COLORS.wire; ctx.font = '15px system-ui, sans-serif';
  ctx.fillText(`${round.sequence.length} moves`, width / 2, 55);
  ctx.fillText(imageOnly ? 'Original' : 'Diagram', width * .365, 90); ctx.fillText('Target', width * .865, 90);
  drawDiagram(ctx, diagram, target);
  const clear = () => { ctx.fillStyle = BACKGROUND; ctx.fillRect(0, BOARD_TOP, Math.ceil(width * .73), height - BOARD_TOP); };
  const draw = (value, options) => { clear(); drawDiagram(ctx, value, board, options); };
  if (imageOnly) { draw(original, round.views?.[0]); return canvas; }
  const gif = GIFEncoder();
  const gaps = transitions.filter((item, index) => item.step !== (transitions[index - 1]?.step ?? 0) + 1).length;
  const totalFrames = 2 + transitions.length * ANIMATION_FRAMES + gaps;
  let encoded = 0;
  // Header and target are drawn once. Quantize only the changing left board.
  const frame = (delay, first = false) => {
    const y = first ? 0 : BOARD_TOP, frameWidth = first ? width : Math.ceil(width * .73);
    const indexed = applyPalette(ctx.getImageData(0, y, frameWidth, height - y).data, palette, 'rgb444');
    writeReplayFrame(gif, indexed, frameWidth, height - y, { palette: first ? palette : undefined, delay, top: y });
    onProgress?.(++encoded / totalFrames);
  };
  onProgress?.(0); draw(original, { layout: originalLayout }); frame(900, true);
  let previousStep = 0;
  for (const { before, after, move, step, layout, nextLayout } of transitions) {
    if (step !== previousStep + 1) { draw(before, { layout }); frame(80); }
    const scene = createRewriteScene(before, move, after, { layout, nextLayout });
    const delay = rewriteDuration(scene, REPLAY_MOVE_DURATION) / ANIMATION_FRAMES;
    for (let tween = 1; tween <= ANIMATION_FRAMES; tween++) {
      clear(); drawRewriteFrame(ctx, scene, tween / ANIMATION_FRAMES, board);
      frame(delay);
    }
    previousStep = step;
  }
  draw(diagram, { layout }); frame(1500);
  gif.finish(); return gif.bytesView();
}

installReplayEncoder(encodeReplay);
