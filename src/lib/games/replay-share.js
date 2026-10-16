/** Own the shared share dialog and its abortable export job, independent of gameplay. */
export function createReplayShare({ createGif, get = id => document.getElementById(id) }) {
  const dialog = get('share-dialog');
  const download = get('download-gif');
  const preview = get('share-preview'), copyButton = get('copy-gif'), status = get('share-status');
  let request, copyBlob, url, previewUrl, source, replay;

  function dispose() {
    request?.abort();
    request = null;
    replay = null;
    copyBlob = null;
    if (previewUrl && previewUrl !== url) URL.revokeObjectURL(previewUrl);
    if (url) URL.revokeObjectURL(url);
    url = previewUrl = null;
    preview.removeAttribute('src');
    preview.hidden = true;
    download.disabled = true;
    copyButton.disabled = true;
    copyButton.textContent = 'Copy image';
    status.textContent = '';
  }

  function close() { dialog.close(); dispose(); }

  function open(trigger, round, filename) {
    if (dialog.open) return;
    dispose();
    source = trigger;
    replay = { round, filename };
    download.disabled = false;
    dialog.showModal();
    get('close-share').focus();
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
    copyBlob = null;
    download.disabled = true;
    status.textContent = 'Preparing your replay…';
    try {
      const canCopy = Boolean(navigator.clipboard?.write && typeof ClipboardItem !== 'undefined');
      const copyGif = canCopy && typeof ClipboardItem.supports === 'function' && ClipboardItem.supports('image/gif');
      const copyImage = !copyGif && canCopy && (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports('image/png'));
      const blob = await createGif(replay.round, {
        signal: job.signal,
        onImage: copyImage ? png => { if (request === job) copyBlob = png; } : undefined,
        onProgress: progress => {
          if (request === job) status.textContent = `Preparing your replay… ${Math.round(progress * 100)}%`;
        },
      });
      if (request !== job) return;
      url = URL.createObjectURL(blob);
      if (copyGif) copyBlob = blob;
      previewUrl = copyBlob?.type === 'image/png' ? URL.createObjectURL(copyBlob) : url;
      preview.src = previewUrl;
      preview.hidden = false;
      copyButton.textContent = copyGif ? 'Copy the GIF' : 'Copy image';
      copyButton.disabled = !copyBlob;
      status.textContent = '';
      save();
    } catch (error) {
      if (request === job) status.textContent = error.name === 'NotSupportedError'
        ? 'Replay export isn’t available in this browser. Try another browser.'
        : 'Could not prepare the replay. Please try again.';
    } finally {
      if (request === job) download.disabled = false;
    }
  }

  async function copy() {
    const ready = copyBlob;
    if (!ready || copyButton.disabled) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ [ready.type]: ready })]);
      if (copyBlob === ready) status.textContent = ready.type === 'image/gif' ? 'GIF copied.' : 'Image copied.';
    } catch {
      if (copyBlob === ready) status.textContent = 'Could not copy. Use Download the replay instead.';
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
