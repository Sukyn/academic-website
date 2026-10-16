/** Controllable worker messages, including replies queued before termination. */
export function replayWorkers() {
  const images = [], gifs = [];
  class ReplayWorker {
    constructor(url, options) {
      this.url = url; this.options = options; this.terminated = false;
    }
    postMessage(request) {
      this.request = request;
      const deliver = this.onmessage;
      const job = {
        round: request.round, worker: this,
        progress: progress => deliver({ data: { progress } }),
        async resolve(blob) {
          const data = request.imageOnly ? { image: blob } : { bytes: new Uint8Array(await blob.arrayBuffer()) };
          deliver({ data });
        },
        reject: error => deliver({ data: { error: error.message, name: error.name } }),
      };
      (request.imageOnly ? images : gifs).push(job);
    }
    terminate() { this.terminated = true; }
  }
  return { ReplayWorker, images, gifs };
}
