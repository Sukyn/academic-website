/** Own the shared share dialog and its abortable export job, independent of gameplay. */
export function createReplayShare({ createGif, get = id => document.getElementById(id) }) {
  const dialog = get('share-dialog');
  let request, copyBlob, url, previewUrl, source;

  function dispose() {
    request?.abort();
    request = null;
    copyBlob = null;
    if (previewUrl && previewUrl !== url) URL.revokeObjectURL(previewUrl);
    if (url) URL.revokeObjectURL(url);
    url = previewUrl = null;
    get('share-preview').removeAttribute('src');
    get('share-preview').hidden = true;
    get('download-gif').removeAttribute('href');
    get('download-gif').hidden = true;
    get('copy-gif').disabled = true;
    get('copy-gif').textContent = 'Copy image';
    get('share-status').textContent = '';
  }

  function close() { dialog.close(); dispose(); }

  async function open(trigger, round, filename) {
    if (dialog.open) return;
    dispose();
    const job = request = new AbortController();
    source = trigger;
    get('share-status').textContent = 'Making your GIF…';
    dialog.showModal();
    get('close-share').focus();
    try {
      const blob = await createGif(round, {
        signal: job.signal,
        onImage: png => { if (request === job) copyBlob = png; },
        onProgress: progress => {
          if (request === job) get('share-status').textContent = `Making your GIF… ${Math.round(progress * 100)}%`;
        },
      });
      if (request !== job) return;
      url = URL.createObjectURL(blob);
      get('download-gif').href = url;
      get('download-gif').download = filename;
      get('download-gif').hidden = false;
      const canCopy = Boolean(navigator.clipboard?.write && typeof ClipboardItem !== 'undefined');
      const copyGif = canCopy && typeof ClipboardItem.supports === 'function' && ClipboardItem.supports('image/gif');
      const copyImage = canCopy && (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports('image/png'));
      copyBlob = copyGif ? blob : copyImage ? copyBlob : null;
      previewUrl = copyBlob?.type === 'image/png' ? URL.createObjectURL(copyBlob) : url;
      get('share-preview').src = previewUrl;
      get('share-preview').hidden = false;
      get('copy-gif').textContent = copyGif ? 'Copy the GIF' : 'Copy image';
      get('copy-gif').disabled = !canCopy || !copyBlob;
      get('share-status').textContent = '';
    } catch (error) {
      if (request === job) get('share-status').textContent = error.name === 'NotSupportedError'
        ? 'GIF export isn’t available in this browser. Try another browser.'
        : 'Could not make the GIF. Close this window and try again.';
    }
  }

  async function copy() {
    const ready = copyBlob;
    if (!ready || get('copy-gif').disabled) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ [ready.type]: ready })]);
      if (copyBlob === ready) get('share-status').textContent = ready.type === 'image/gif' ? 'GIF copied.' : 'Image copied.';
    } catch {
      if (copyBlob === ready) get('share-status').textContent = 'Could not copy. Use Download GIF instead.';
    }
  }

  get('close-share').addEventListener('click', close);
  get('copy-gif').addEventListener('click', copy);
  dialog.addEventListener('close', () => {
    if (!dialog.open) { dispose(); source?.focus(); }
  });
  return { open, close };
}
