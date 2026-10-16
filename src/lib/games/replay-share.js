import { createWorkerReplayGif, createWorkerReplayImage } from './replay-gif.js';

/** Prepare the share image immediately; encode the replay only on download. */
export function createReplayShare({ createWorker, get = id => document.getElementById(id) }) {
  const dialog = get('share-dialog');
  const download = get('download-gif');
  const preview = get('share-preview'), copyButton = get('copy-gif'), status = get('share-status');
  let request, imageRequest, copyBlob, url, previewUrl, source, replay;
  let message = '', imageMessage = '';
  const showStatus = () => { status.textContent = message || imageMessage; };
  const canCopy = type => Boolean(navigator.clipboard?.write && typeof ClipboardItem !== 'undefined' &&
    (typeof ClipboardItem.supports === 'function' ? ClipboardItem.supports(type) : type === 'image/png'));

  function dispose() {
    request?.abort();
    imageRequest?.abort();
    request = null;
    imageRequest = null;
    replay = null;
    copyBlob = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (url) URL.revokeObjectURL(url);
    url = previewUrl = null;
    preview.removeAttribute('src');
    preview.hidden = true;
    download.disabled = true;
    copyButton.disabled = true;
    copyButton.textContent = 'Copy image';
    message = imageMessage = '';
    showStatus();
  }

  function close() { dialog.close(); dispose(); }

  async function open(trigger, round, filename) {
    if (dialog.open) return;
    dispose();
    source = trigger;
    replay = { round, filename };
    download.disabled = false;
    dialog.showModal();
    get('close-share').focus();
    const job = imageRequest = new AbortController();
    imageMessage = 'Preparing image…';
    showStatus();
    try {
      const image = await createWorkerReplayImage(round, createWorker, { signal: job.signal });
      if (imageRequest !== job) return;
      previewUrl = URL.createObjectURL(image);
      preview.src = previewUrl;
      preview.hidden = false;
      if (copyBlob?.type !== 'image/gif' && canCopy('image/png')) {
        copyBlob = image;
        copyButton.disabled = false;
      }
      imageMessage = '';
    } catch {
      if (imageRequest !== job) return;
      imageMessage = 'Could not prepare the image. You can still download the replay.';
    } finally {
      if (imageRequest === job) { imageRequest = null; showStatus(); }
    }
  }

  function save() {
    const link = document.createElement('a');
    link.href = url;
    link.download = replay.filename;
    link.hidden = true;
    dialog.appendChild(link);
    link.click();
    link.remove();
  }

  async function downloadReplay() {
    if (!dialog.open || !replay || download.disabled) return;
    if (url) { save(); return; }
    const job = request = new AbortController();
    download.disabled = true;
    message = 'Preparing your replay…';
    showStatus();
    try {
      const blob = await createWorkerReplayGif(replay.round, createWorker, {
        signal: job.signal,
        onProgress: progress => {
          if (request === job) { message = `Preparing your replay… ${Math.round(progress * 100)}%`; showStatus(); }
        },
      });
      if (request !== job) return;
      url = URL.createObjectURL(blob);
      if (canCopy('image/gif')) {
        copyBlob = blob;
        copyButton.textContent = 'Copy the GIF';
        copyButton.disabled = false;
      }
      message = '';
      showStatus();
      save();
    } catch (error) {
      if (request === job) {
        message = error.name === 'NotSupportedError'
          ? 'Replay export isn’t available in this browser. Try another browser.'
          : 'Could not prepare the replay. Please try again.';
        showStatus();
      }
    } finally {
      if (request === job) { request = null; download.disabled = false; }
    }
  }

  async function copy() {
    const ready = copyBlob;
    if (!ready || copyButton.disabled) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ [ready.type]: ready })]);
      if (copyBlob === ready) { message = ready.type === 'image/gif' ? 'GIF copied.' : 'Image copied.'; showStatus(); }
    } catch {
      if (copyBlob === ready) { message = 'Could not copy. Use Download the replay instead.'; showStatus(); }
    }
  }

  get('close-share').addEventListener('click', close);
  download.addEventListener('click', downloadReplay);
  copyButton.addEventListener('click', copy);
  dialog.addEventListener('close', () => {
    if (!dialog.open) { dispose(); source?.focus(); }
  });
  return { open, close };
}
