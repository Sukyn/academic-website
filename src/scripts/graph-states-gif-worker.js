import * as gifenc from 'gifenc';
import { applyMove, correctionColumns, isSolved, MAX_MOVES, optimalShots, pathGraph, sequenceCost, validateGraph } from '../lib/graph-states/engine.js';
import { graphPositions } from '../lib/graph-states/rendering.js';
import { CIRCUIT_COLORS as colors } from '../lib/games/circuit-graphics.js';
import { drawCorrection } from '../lib/graph-states/correction-graphics.js';
import { simplifyCorrectionColumns } from '../lib/graph-states/clifford.js';
import { installReplayEncoder } from '../lib/games/replay-gif.js';

const { GIFEncoder, applyPalette } = Reflect.get(gifenc, 'default') ?? gifenc;
const WIDTH = 960, WHITE = '#f5f5f2', EDGE = '#b6c4bb';
const palette = [colors.background, colors.text, colors.h, colors.x, colors.z, colors.wire, WHITE, EDGE]
  .map(hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)));

function drawGraph(ctx, graph, left, top, scale) {
  const positions = graphPositions(graph.vertices).map(({ x, y }) => ({ x: left + x * scale, y: top + y * scale }));
  ctx.strokeStyle = EDGE; ctx.lineWidth = 2.6;
  for (const [u, v] of graph.edges) {
    ctx.beginPath(); ctx.moveTo(positions[u].x, positions[u].y); ctx.lineTo(positions[v].x, positions[v].y); ctx.stroke();
  }
  for (let vertex = 0; vertex < positions.length; vertex++) {
    const { x, y } = positions[vertex];
    ctx.fillStyle = colors.background; ctx.strokeStyle = colors.z; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(x, y, 21 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = colors.text; ctx.font = `${16 * scale}px system-ui, sans-serif`; ctx.fillText(String(vertex + 1), x, y);
  }
}

function drawCircuit(ctx, vertices, columns, top) {
  const slot = 58, left = WIDTH / 2 - (Math.max(1, columns.length) - 1) * slot / 2;
  ctx.font = '14px system-ui, sans-serif';
  for (let wire = 0; wire < vertices; wire++) {
    const y = top + wire * 48;
    ctx.fillStyle = colors.wire; ctx.fillText(String(wire + 1), 286, y);
    ctx.strokeStyle = WHITE; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(310, y); ctx.lineTo(674, y); ctx.stroke();
  }
  columns.forEach((column, index) => column.forEach(({ gate, wires }) => {
    drawCorrection(ctx, gate, left + index * slot, top + wires[0] * 48);
  }));
}

export function encodeReplay(round, onProgress, imageOnly = false) {
  if (typeof OffscreenCanvas !== 'function') throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  const initial = validateGraph(round.puzzle);
  if (typeof round.label !== 'string' || round.label.length > 240 || !Array.isArray(round.sequence) ||
      !round.sequence.length || round.sequence.length > MAX_MOVES) throw new Error('Finish a graph before sharing its replay.');
  const frames = imageOnly ? [] : [{ step: 0, graph: initial, columns: [] }], columns = [];
  const samples = Math.min(64, round.sequence.length);
  let graph = initial, sample = 1;
  for (let step = 1; step <= round.sequence.length; step++) {
    columns.push(...correctionColumns(graph, round.sequence[step - 1]));
    graph = applyMove(graph, round.sequence[step - 1]);
    if (!imageOnly && step === Math.round(sample * round.sequence.length / samples)) {
      frames.push({ step, graph, columns: simplifyCorrectionColumns(initial.vertices, columns) }); sample++;
    }
  }
  if (!isSolved(graph)) throw new Error('This graph has not reached the target chain.');
  const shots = sequenceCost(round.sequence), minimum = optimalShots(initial);
  const height = 656 + (initial.vertices - 1) * 48;
  const canvas = new OffscreenCanvas(WIDTH, height), ctx = canvas.getContext('2d');
  if (!ctx) throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  const gif = imageOnly ? null : GIFEncoder(), target = pathGraph(initial.vertices);
  const drawFrame = frame => {
    ctx.fillStyle = colors.background; ctx.fillRect(0, 0, WIDTH, height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.h; ctx.font = '600 28px system-ui, sans-serif'; ctx.fillText('Graph states', WIDTH / 2, 30);
    ctx.fillStyle = colors.text; ctx.font = '20px system-ui, sans-serif'; ctx.fillText(round.label, WIDTH / 2, 64, WIDTH - 40);
    drawGraph(ctx, frame.graph, 90, 90, 1.05); drawGraph(ctx, target, 590, 135, .7);
    ctx.fillStyle = colors.text; ctx.font = '18px system-ui, sans-serif'; ctx.fillText('Target', 702, 122);
    ctx.fillText('Clifford corrections · simplified', WIDTH / 2, 460);
    drawCircuit(ctx, initial.vertices, frame.columns, 510);
    ctx.fillStyle = colors.text; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('|G₀⟩', 308, 480); ctx.fillText('|G⟩', 672, 480);
    ctx.fillStyle = colors.h; ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(frame.step === round.sequence.length ? 'Chain matched · GG' : `Step ${frame.step} / ${round.sequence.length}`, WIDTH / 2, height - 66);
    ctx.fillStyle = colors.text; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(`${shots} ${shots === 1 ? 'shot' : 'shots'} · Optimal: ${minimum}`, WIDTH / 2, height - 46);
    ctx.fillStyle = colors.text; ctx.font = '14px system-ui, sans-serif'; ctx.fillText('colin-blake.eu/games/graph-states/', WIDTH / 2, height - 30);
    if (gif) gif.writeFrame(applyPalette(ctx.getImageData(0, 0, WIDTH, height).data, palette, 'rgb444'), WIDTH, height,
      { palette, delay: frame.step === round.sequence.length ? 1800 : frame.step === 0 ? 1000 : 600 });
  };
  if (imageOnly) {
    drawFrame({ step: round.sequence.length, graph, columns: simplifyCorrectionColumns(initial.vertices, columns) });
    return canvas;
  }
  onProgress?.(0);
  for (const frame of frames) { drawFrame(frame); onProgress?.(frame.step / round.sequence.length); }
  gif.finish(); return gif.bytesView();
}

installReplayEncoder(encodeReplay);
