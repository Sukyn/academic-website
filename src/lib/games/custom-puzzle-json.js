const MAX_LENGTH = 65_536;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function encodeCustomPuzzle(puzzle) {
  if (!object(puzzle)) throw new RangeError('Use a puzzle JSON object.');
  const source = JSON.stringify(puzzle, null, 2);
  if (source.length > MAX_LENGTH) throw new RangeError('Use a puzzle JSON smaller than 64 KB.');
  return source;
}

export function decodeCustomPuzzle(source) {
  if (typeof source !== 'string' || source.length > MAX_LENGTH) throw new RangeError('Use a puzzle JSON smaller than 64 KB.');
  let value;
  try { value = JSON.parse(source); }
  catch { throw new RangeError('Use valid puzzle JSON.'); }
  if (!object(value)) throw new RangeError('Use a puzzle JSON object.');
  return value;
}

export function createCustomPuzzleJson({ get, game, exportPuzzle, importPuzzle }) {
  const dialog = get('puzzle-json-dialog'), text = get('puzzle-json-text'), status = get('puzzle-json-status');
  let kind = 'input', inputText = '', generation = 0;
  function close() { if (dialog.open) dialog.close(); }
  function open(next) {
    generation++; kind = next; status.textContent = '';
    const sharing = kind === 'share';
    get('puzzle-json-title').textContent = sharing ? 'Share the json' : 'Input a json';
    text.readOnly = sharing;
    for (const id of ['puzzle-json-copy', 'puzzle-json-download']) get(id).hidden = !sharing;
    for (const id of ['puzzle-json-apply', 'puzzle-json-file-label']) get(id).hidden = sharing;
    text.value = sharing ? '' : inputText;
    if (sharing) {
      try { text.value = encodeCustomPuzzle(exportPuzzle()); }
      catch (error) { status.textContent = error.message; }
    }
    for (const id of ['puzzle-json-copy', 'puzzle-json-download']) get(id).disabled = !text.value;
    if (!dialog.open) dialog.showModal();
    text.focus();
    if (sharing) { text.selectionStart = text.selectionEnd = 0; text.scrollTop = text.scrollLeft = 0; }
  }
  get('share-json').addEventListener('click', () => open('share'));
  get('input-json').addEventListener('click', () => open('input'));
  get('puzzle-json-close').addEventListener('click', close);
  text.addEventListener('input', () => { if (kind === 'input') { inputText = text.value; generation++; } });
  get('puzzle-json-form').addEventListener('submit', event => {
    event.preventDefault();
    if (kind !== 'input') return;
    try { importPuzzle(decodeCustomPuzzle(text.value)); inputText = text.value; close(); }
    catch (error) { status.textContent = error.message; }
  });
  get('puzzle-json-file').addEventListener('change', async event => {
    const file = event.target.files?.[0], ticket = ++generation;
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_LENGTH) throw new RangeError('Use a puzzle JSON smaller than 64 KB.');
      const source = await file.text();
      if (ticket !== generation || !dialog.open || kind !== 'input') return;
      text.value = inputText = source; status.textContent = '';
    } catch (error) { if (ticket === generation && dialog.open) status.textContent = error.message; }
  });
  get('puzzle-json-copy').addEventListener('click', async () => {
    const ticket = generation, source = text.value;
    try {
      await navigator.clipboard.writeText(source);
      if (ticket === generation && dialog.open) status.textContent = 'Copied.';
    } catch {
      if (ticket !== generation || !dialog.open) return;
      text.focus(); text.select(); status.textContent = 'Copy the selected JSON.';
    }
  });
  get('puzzle-json-download').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([text.value], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = game + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  return {
    close,
    update({ visible, disabled = false, canShare = true }) {
      get('custom-json-actions').hidden = !visible;
      get('share-json').disabled = disabled || !canShare;
      get('input-json').disabled = disabled;
      if (!visible) close();
    },
  };
}
