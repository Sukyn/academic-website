/** Keep the static header while writing cropped frames with one global palette. */
export function writeReplayFrame(gif, indexed, width, height, { palette, delay, top = 0 }) {
  const start = gif.bytesView().length;
  gif.writeFrame(indexed, width, height, { palette, delay, dispose: 1 });
  if (!top) return;
  // gifenc emits the image descriptor after its eight-byte graphic control block.
  const bytes = gif.bytesView(), descriptor = start + 8;
  if (bytes[descriptor] !== 0x2c) throw new Error('Could not encode the replay frame.');
  bytes[descriptor + 3] = top & 255;
  bytes[descriptor + 4] = top >> 8;
}

/** Run a game's synchronous encoder inside its worker and transfer the result. */
export function installReplayEncoder(encodeReplay) {
  if (typeof WorkerGlobalScope === 'undefined' || !(globalThis instanceof WorkerGlobalScope)) return;
  globalThis.onmessage = async ({ data }) => {
    try {
      if (data.imageOnly) {
        const canvas = encodeReplay(data.round, undefined, true);
        const image = await canvas.convertToBlob({ type: 'image/png' });
        globalThis.postMessage({ image });
      } else {
        const bytes = encodeReplay(data.round, progress => globalThis.postMessage({ progress }));
        globalThis.postMessage({ bytes }, [bytes.buffer]);
      }
    } catch (error) {
      globalThis.postMessage({ error: error.message || 'Could not create the export. Please try again.', name: error.name });
    }
  };
}

function createWorkerReplay(round, createWorker, { signal, onProgress } = {}, imageOnly = false) {
  const format = imageOnly ? 'image' : 'GIF';
  const failed = `Could not create the ${format}. Please try again.`;
  return new Promise((resolve, reject) => {
    let worker, settled = false;
    const finish = (error, bytes) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
      if (error) reject(error);
      else resolve(imageOnly ? bytes : new Blob([bytes], { type: 'image/gif' }));
    };
    const cancel = () => finish(new DOMException('Export cancelled.', 'AbortError'));
    if (signal?.aborted) return cancel();
    if (typeof Worker !== 'function') return finish(new DOMException(`Your browser cannot create this ${format}. Try an up-to-date browser.`, 'NotSupportedError'));
    try {
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.error) {
          const error = new Error(data.error);
          error.name = data.name || 'Error';
          finish(error);
        }
        else if (imageOnly && data.image instanceof Blob && data.image.type === 'image/png') finish(null, data.image);
        else if (!imageOnly && data.bytes) finish(null, data.bytes);
        else if (Number.isFinite(data.progress)) onProgress?.(Math.max(0, Math.min(1, data.progress)));
      };
      worker.onerror = event => {
        event.preventDefault();
        finish(new Error(failed));
      };
      worker.onmessageerror = () => finish(new Error(failed));
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) return cancel();
      worker.postMessage({ round, imageOnly });
    } catch {
      finish(new Error(failed));
    }
  });
}

export function createWorkerReplayGif(round, createWorker, options) {
  return createWorkerReplay(round, createWorker, options);
}

export function createWorkerReplayImage(round, createWorker, options) {
  return createWorkerReplay(round, createWorker, options, true);
}
