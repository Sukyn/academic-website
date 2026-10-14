/** Own the shared share dialog and its abortable export job, independent of gameplay. */
export function createReplayShare({ createGif, get = id => document.getElementById(id) }) {
  const dialog = get('share-dialog');
  let request, file, url, source;

  function dispose() {
    request?.abort();
    request = null;
    file = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
    get('share-preview').removeAttribute('src');
    get('share-preview').hidden = true;
    get('download-gif').removeAttribute('href');
    get('download-gif').hidden = true;
    get('copy-gif').disabled = true;
    get('native-share-gif').hidden = true;
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
      const blob = await createGif(round, { signal: job.signal, onProgress: progress => {
        if (request === job) get('share-status').textContent = `Making your GIF… ${Math.round(progress * 100)}%`;
      } });
      if (request !== job) return;
      file = new File([blob], filename, { type: 'image/gif' });
      url = URL.createObjectURL(file);
      get('share-preview').src = url;
      get('share-preview').hidden = false;
      get('download-gif').href = url;
      get('download-gif').download = filename;
      get('download-gif').hidden = false;
      const canCopy = Boolean(navigator.clipboard?.write && typeof ClipboardItem !== 'undefined' &&
        (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports('image/gif')));
      get('copy-gif').disabled = !canCopy;
      let nativeShare = false;
      try { nativeShare = Boolean(navigator.share && navigator.canShare?.({ files: [file] })); } catch {}
      get('native-share-gif').hidden = !nativeShare;
      get('share-status').textContent = '';
    } catch (error) {
      if (request === job) get('share-status').textContent = error.name === 'NotSupportedError'
        ? 'GIF export isn’t available in this browser. Try another browser.'
        : 'Could not make the GIF. Close this window and try again.';
    }
  }

  async function copy() {
    const ready = file;
    if (!ready || get('copy-gif').disabled) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/gif': ready })]);
      if (file === ready) get('share-status').textContent = 'GIF copied.';
    } catch {
      if (file === ready) get('share-status').textContent = 'Could not copy the GIF. Use Download GIF instead.';
    }
  }

  async function nativeShare() {
    const ready = file;
    if (!ready) return;
    try { await navigator.share({ files: [ready] }); }
    catch (error) {
      if (file === ready && error.name !== 'AbortError') get('share-status').textContent = 'Could not share the GIF. Use Download GIF instead.';
    }
  }

  get('close-share').addEventListener('click', close);
  get('copy-gif').addEventListener('click', copy);
  get('native-share-gif').addEventListener('click', nativeShare);
  dialog.addEventListener('close', () => {
    if (!dialog.open) { dispose(); source?.focus(); }
  });
  return { open, close, dispose };
}
