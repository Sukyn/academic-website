import * as gifenc from 'gifenc';
import { BlochSphere } from '../lib/quantum-golf/sphere.js';
import { START_STATE, applyGate, gateRotation } from '../lib/quantum-golf/quantum.js';
import { installReplayEncoder } from '../lib/games/replay-gif.js';

// gifenc exposes CommonJS in Node and ES modules in the browser bundle.
const { GIFEncoder, quantize, applyPalette } = Reflect.get(gifenc, 'default') ?? gifenc;
const WIDTH = 480, HEIGHT = 560, HEADER = 128;

export function encodeReplay(round, onProgress, imageOnly = false) {
  if (typeof OffscreenCanvas !== 'function') {
    throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  }
  const { label, sequence, target, epsilon, optimalMoves,
    background = '#18231e', textColor = '#dde3d7', headingColor = '#fff3cf' } = round;
  if (typeof label !== 'string' || !label.length || typeof sequence !== 'string' ||
      !sequence.length || /[^HT]/.test(sequence) || !Number.isInteger(optimalMoves) || optimalMoves < 0) {
    throw new Error('This replay is unavailable. Finish a puzzle first.');
  }
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT), ctx = canvas.getContext('2d');
  const sphereCanvas = new OffscreenCanvas(WIDTH, HEIGHT - HEADER);
  if (!ctx || !sphereCanvas.getContext('2d')) {
    throw new DOMException('Your browser cannot create GIFs. Try an up-to-date browser.', 'NotSupportedError');
  }
  const sphere = new BlochSphere(sphereCanvas, { interactive: false });
  sphere.setState({ target, epsilon, showLabels: false, showPreviews: false });
  sphere.focus(START_STATE);

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.fillStyle = headingColor;
  ctx.fillText(label, WIDTH / 2, 34, WIDTH - 32);
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillStyle = textColor;
  ctx.fillText(`Optimal : ${optimalMoves}`, WIDTH / 2, 66, WIDTH - 32);
  ctx.fillText(`My score : ${sequence.length}`, WIDTH / 2, 98, WIDTH - 32);

  const pixels = () => {
    ctx.fillStyle = background;
    ctx.fillRect(0, HEADER, WIDTH, HEIGHT - HEADER);
    ctx.drawImage(sphereCanvas, 0, HEADER);
    return ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
  };
  let finalState = START_STATE;
  for (const gate of sequence) finalState = applyGate(finalState, gate);
  if (imageOnly) {
    sphere.cameraTo(finalState)(1);
    sphere.setState({ state: finalState, sequence });
    ctx.drawImage(sphereCanvas, 0, HEADER);
    return canvas;
  }
  onProgress?.(0);
  // Seed one palette with both the empty sphere and the complete trace.
  const first = pixels();
  sphere.cameraTo(finalState)(1);
  sphere.setState({ state: finalState, sequence });
  const seed = new Uint8Array(first.length * 2);
  seed.set(first);
  seed.set(pixels(), first.length);
  const opaquePalette = quantize(seed, 63, { format: 'rgb444' });
  const palette = [[0, 0, 0], ...opaquePalette];
  const colorDepth = Math.max(2, Math.ceil(Math.log2(palette.length)));
  sphere.cameraTo(START_STATE)(1);
  sphere.setState({ state: START_STATE, sequence: '' });

  const gif = GIFEncoder();
  let previous;
  const frame = (data, delay) => {
    const indexed = applyPalette(data, opaquePalette, 'rgb444');
    const delta = new Uint8Array(indexed.length);
    for (let i = 0; i < indexed.length; i++) {
      indexed[i]++; // Index 0 is reserved for unchanged pixels.
      delta[i] = previous && indexed[i] === previous[i] ? 0 : indexed[i];
    }
    gif.writeFrame(delta, WIDTH, HEIGHT, { palette: previous ? undefined : palette,
      colorDepth, delay, transparent: Boolean(previous), transparentIndex: 0, dispose: 1 });
    previous = indexed;
  };
  let state = START_STATE, completed = 0;
  const samples = Math.min(96, sequence.length * 6);
  frame(first, 600);
  for (let i = 1; i <= samples; i++) {
    const position = sequence.length * i / samples;
    while (completed < Math.floor(position)) {
      state = applyGate(state, sequence[completed++]);
    }
    const progress = position - completed, gate = sequence[completed];
    const rotate = progress ? gateRotation(state, gate) : null;
    const visibleState = rotate ? rotate(progress) : state;
    sphere.cameraTo(visibleState)(1);
    sphere.setState({ state: visibleState, sequence: sequence.slice(0, completed),
      animation: rotate ? { gate, rotate, progress } : null });
    frame(pixels(), i === samples ? 1600 : 80);
    onProgress?.(i / samples);
  }
  gif.finish();
  return gif.bytesView();
}

installReplayEncoder(encodeReplay);
