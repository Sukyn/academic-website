import { createWorkerReplayGif } from '../games/replay-gif.js';

export function createReplayGif(round, options = {}) {
  return createWorkerReplayGif(round, () =>
    new Worker(new URL('../../scripts/quantum-golf-gif-worker.js', import.meta.url), { type: 'module' }), options);
}
