import * as gifenc from 'gifenc';
import { applyMove, isSolved, MAX_MOVES, optimalShots, pathGraph, sequenceCost, validateGraph } from '../lib/graph-states/engine.js';
import { graphPositions } from '../lib/graph-states/rendering.js';
import { REPLAY_COMPLEMENT_DURATION, graphAnimationProgress, graphBoundary, graphMoveStages } from '../lib/graph-states/animation.js';
import { CIRCUIT_COLORS as colors } from '../lib/games/circuit-graphics.js';
import { installReplayEncoder } from '../lib/games/replay-gif.js';

const { GIFEncoder, applyPalette } = Reflect.get(gifenc, 'default') ?? gifenc;
const WIDTH = 960, WHITE = '#f5f5f2', EDGE = '#b6c4bb';
const AFFECTED = '#3d3825', ANIMATION_FRAMES = 16, MAX_STAGES = 64;
const palette = [colors.background, colors.text, colors.h, colors.z, WHITE, EDGE, AFFECTED]
  .map(hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)));

function drawGraph(ctx, graph, left, top, scale, animation) {
  const positions = graphPositions(graph.vertices).map(({ x, y }) => ({ x: left + x * scale, y: top + y * scale }));
  const stage = animation?.stage, timing = animation && graphAnimationProgress(animation.progress);
  const changing = timing?.phase === 'rewrite' ? new Set(stage.pairs.map(({ edge }) => edge.join(':'))) : null;
  ctx.strokeStyle = EDGE; ctx.lineWidth = 2.6;
  for (const [u, v] of graph.edges) {
    if (changing?.has(`${u}:${v}`)) continue;
    ctx.beginPath(); ctx.moveTo(positions[u].x, positions[u].y); ctx.lineTo(positions[v].x, positions[v].y); ctx.stroke();
  }
  if (stage) {
    if (timing.phase === 'pulse') for (const vertex of stage.neighbours) {
      const origin = positions[stage.vertex], target = positions[vertex];
      const start = graphBoundary(origin, target), end = graphBoundary(target, origin);
      ctx.fillStyle = colors.h;
      ctx.beginPath(); ctx.arc(start.x + (end.x - start.x) * timing.travel, start.y + (end.y - start.y) * timing.travel, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    if (changing) for (const { edge, existed } of stage.pairs) {
      if (existed ? timing.change === 1 : timing.change === 0) continue;
      const [a, b] = edge.map(vertex => positions[vertex]), middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.strokeStyle = existed ? EDGE : WHITE; ctx.lineWidth = existed ? 2.8 : 3.2;
      for (const vertex of [a, b]) {
        const start = graphBoundary(vertex, middle);
        const front = { x: start.x + (middle.x - start.x) * timing.change, y: start.y + (middle.y - start.y) * timing.change };
        ctx.beginPath(); ctx.moveTo(existed ? front.x : start.x, existed ? front.y : start.y);
        ctx.lineTo(existed ? middle.x : front.x, existed ? middle.y : front.y); ctx.stroke();
      }
    }
  }
  for (let vertex = 0; vertex < positions.length; vertex++) {
    const { x, y } = positions[vertex];
    const source = stage?.vertex === vertex, affected = stage && timing.phase !== 'pulse' && stage.neighbours.includes(vertex);
    ctx.fillStyle = affected ? AFFECTED : colors.background; ctx.strokeStyle = source || affected ? colors.h : colors.z; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(x, y, 21 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = colors.text; ctx.font = `${16 * scale}px system-ui, sans-serif`; ctx.fillText(String(vertex + 1), x, y);
  }
}

export function encodeReplay(round, onProgress, imageOnly = false) {
  if (typeof OffscreenCanvas !== 'function') throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  const initial = validateGraph(round.puzzle);
  if (typeof round.label !== 'string' || round.label.length > 240 || !Array.isArray(round.sequence) ||
      !round.sequence.length || round.sequence.length > MAX_MOVES) throw new Error('Finish a graph before sharing its replay.');
  const frames = [];
  let graph = initial;
  for (const move of round.sequence) {
    if (imageOnly) graph = applyMove(graph, move);
    else {
      const stages = graphMoveStages(graph, move);
      graph = stages.at(-1).after;
      frames.push({ graph, stages });
    }
  }
  if (!isSolved(graph)) throw new Error('This graph has not reached the target chain.');
  const shots = sequenceCost(round.sequence), minimum = optimalShots(initial);
  const scale = imageOnly ? 1 : .75, width = WIDTH * scale, height = 520 * scale;
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d');
  if (!ctx) throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  ctx.scale(scale, scale);
  const gif = imageOnly ? null : GIFEncoder(), target = pathGraph(initial.vertices);
  let first = true;
  const drawFrame = (frame, delay) => {
    ctx.fillStyle = colors.background; ctx.fillRect(0, first ? 0 : 150, first ? WIDTH : WIDTH / 2, first ? 520 : 370);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (first) {
      ctx.fillStyle = colors.h; ctx.font = '600 20px system-ui, sans-serif'; ctx.fillText(round.label, WIDTH / 2, 34, WIDTH - 40);
      ctx.fillStyle = colors.text; ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(`Optimal : ${minimum}`, WIDTH / 2, 66);
      ctx.fillText(`My score : ${shots}`, WIDTH / 2, 98);
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText(imageOnly ? 'Original' : 'Current', 240, 142); ctx.fillText('Target', 720, 142);
      drawGraph(ctx, target, 560, 150, 1);
    }
    drawGraph(ctx, frame.graph, 80, 150, 1, frame.animation);
    // The first frame supplies the static target and global palette. Later frames
    // replace only the left half; GIF disposal preserves the untouched right side.
    if (gif) {
      const frameWidth = first ? width : width / 2;
      gif.writeFrame(applyPalette(ctx.getImageData(0, 0, frameWidth, height).data, palette, 'rgb444'), frameWidth, height,
        first ? { palette, delay } : { delay });
    }
    first = false;
  };
  if (imageOnly) {
    drawFrame({ graph: initial });
    return canvas;
  }
  onProgress?.(0);
  drawFrame({ graph: initial }, 700);
  // Keep long exports bounded while each sampled complementation retains its real pace.
  const count = Math.min(MAX_STAGES, shots);
  const samples = new Set(Array.from({ length: count }, (_, index) => Math.round((index + 1) * shots / count) - 1));
  let stageIndex = 0;
  for (const frame of frames) {
    let sampled = false;
    for (const stage of frame.stages) {
      if (samples.has(stageIndex)) {
        sampled = true;
        for (let index = 0; index < ANIMATION_FRAMES; index++) {
          const progress = index / (ANIMATION_FRAMES - 1);
          drawFrame({ graph: stage.before, animation: { stage, progress } }, REPLAY_COMPLEMENT_DURATION / ANIMATION_FRAMES);
          onProgress?.((stageIndex + (index + 1) / ANIMATION_FRAMES) / shots);
        }
      }
      stageIndex++;
    }
    const last = frame === frames.at(-1);
    if (sampled || last) drawFrame(frame, last ? 1500 : 200);
  }
  onProgress?.(1);
  gif.finish(); return gif.bytesView();
}

installReplayEncoder(encodeReplay);
