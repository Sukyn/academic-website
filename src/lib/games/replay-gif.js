const unavailable = 'Your browser cannot create GIFs. Try an up-to-date browser.';
const failed = 'Could not create the GIF. Please try again.';

/** Run a game's synchronous encoder inside its worker and transfer the result. */
export function installReplayEncoder(encodeReplay) {
  if (typeof WorkerGlobalScope === 'undefined' || !(globalThis instanceof WorkerGlobalScope)) return;
  globalThis.onmessage = async ({ data }) => {
    try {
      let finalFrame, image;
      const bytes = encodeReplay(data, progress => globalThis.postMessage({ progress }), canvas => { finalFrame = canvas; });
      // PNG support is optional: a conversion failure must preserve the GIF.
      try { image = await finalFrame.convertToBlob({ type: 'image/png' }); } catch {}
      globalThis.postMessage({ bytes, ...(image ? { image } : {}) }, [bytes.buffer]);
    } catch (error) {
      globalThis.postMessage({ error: error.message || failed, name: error.name });
    }
  };
}

export function createWorkerReplayGif(round, createWorker, { signal, onProgress, onImage } = {}) {
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
      else resolve(new Blob([bytes], { type: 'image/gif' }));
    };
    const cancel = () => finish(new DOMException('GIF creation cancelled.', 'AbortError'));
    if (signal?.aborted) return cancel();
    if (typeof Worker !== 'function') return finish(new DOMException(unavailable, 'NotSupportedError'));
    try {
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.error) {
          const error = new Error(data.error);
          error.name = data.name || 'Error';
          finish(error);
        }
        else if (data.bytes) {
          if (data.image instanceof Blob && data.image.type === 'image/png') onImage?.(data.image);
          finish(null, data.bytes);
        }
        else if (Number.isFinite(data.progress)) onProgress?.(Math.max(0, Math.min(1, data.progress)));
      };
      worker.onerror = event => {
        event.preventDefault();
        finish(new Error(failed));
      };
      worker.onmessageerror = () => finish(new Error(failed));
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) return cancel();
      worker.postMessage(round);
    } catch {
      finish(new Error(failed));
    }
  });
}
