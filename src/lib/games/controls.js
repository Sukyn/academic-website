import { ignoresShortcut as ignoresGameShortcut } from '../browser/shortcuts.js';
export { ignoresGameShortcut };

export function updateModeMenu(get, mode, disabled = false, saving = false) {
  for (const name of ['tutorial', 'campaign', 'random', 'daily']) {
    const button = get('mode-' + name);
    if (!button) continue;
    button.setAttribute('aria-pressed', String(name === mode));
    button.disabled = disabled;
  }
  const dailyGames = get('daily-games'), checkDaily = get('check-daily-puzzles');
  if (dailyGames) { dailyGames.hidden = mode !== 'daily'; dailyGames.inert = saving; }
  if (checkDaily) { checkDaily.hidden = mode !== 'daily'; checkDaily.disabled = saving; }
}

/** Campaign and result navigation use the same level and completion state. */
export function updateLevelControls(get, { mode, level, count, loading, canAdvance }) {
  const campaign = mode === 'campaign', last = level === count;
  get('campaign-controls').hidden = !campaign;
  if (campaign) get('level').value = String(level);
  get('level').disabled = loading;
  get('previous-level').disabled = loading || !campaign || level === 1;
  get('next-level').disabled = loading || !campaign || !canAdvance || last;
  get('result-next').disabled = get('next-level').disabled;
  get('result-next').hidden = !campaign || last;
}

/** Daily results expose replay and sharing; Advanced keeps nickname settings. */
export function updateResultMenu(get, isDaily) {
  const actions = get('result-replay-actions'), daily = get('daily-result-actions');
  const advanced = get('result-advanced-features');
  const destination = isDaily ? daily : advanced;
  if (actions.parentElement !== destination) destination.appendChild(actions);
  daily.hidden = !isDaily;
  advanced.hidden = isDaily && get('nickname-form').hidden;
}

/** Common overlay actions; each game still decides which controls are enabled. */
export function bindGameDialogs(get = id => document.getElementById(id), extraDialogs = []) {
  const win = get('win-dialog'), dialogs = [win];
  for (const name of ['rules', ...extraDialogs]) {
    const dialog = get(name + '-dialog'), show = get('show-' + name);
    show.addEventListener('click', () => { if (!show.disabled && !dialog.open) dialog.showModal(); });
    get('close-' + name).addEventListener('click', () => dialog.close());
    dialogs.push(dialog);
  }
  get('close-win').addEventListener('click', () => win.close());
  const checkDaily = get('check-daily-puzzles'), dailyGames = get('daily-games');
  if (checkDaily && dailyGames) checkDaily.addEventListener('click', () => {
    if (checkDaily.hidden || checkDaily.disabled || !win.open) return;
    win.close();
    dailyGames.scrollIntoView({ block: 'start' });
    dailyGames.focus({ preventScroll: true });
  });
  for (const dialog of dialogs) dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}

/** Return true when no game-specific shortcut should handle this event. */
export function handleRoundShortcut(event, { blocked = false, undo, reset }) {
  if (blocked || ignoresGameShortcut(event)) return true;
  if (event.ctrlKey || event.metaKey) {
    if (!event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
    return true;
  }
  if (event.key === 'Backspace') { event.preventDefault(); undo(); return true; }
  if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); return true; }
  return false;
}

/** Call after handleRoundShortcut, for an active board or its gate palette. */
export function handleGateShortcut(event, { blocked = false, choices, place, erase, navigate }) {
  if (blocked) return false;
  const number = /^Digit[1-9]$/.test(event.code) ? Number(event.code.at(-1)) : /^[1-9]$/.test(event.key) ? Number(event.key) : 0;
  const gate = number ? choices[number - 1] : event.key.toUpperCase();
  if (choices.includes(gate)) { event.preventDefault(); place(gate); return true; }
  if (event.key === 'Delete' && erase) { event.preventDefault(); erase(); return true; }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && navigate) {
    event.preventDefault(); navigate(event.key); return true;
  }
  return false;
}

/** Prefer controls in the same row/column, then the nearest forward control. */
export function directionalControl(origin, candidates, key) {
  if (!origin || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return null;
  const bounds = origin.getBoundingClientRect();
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  let nearest = null, across = Infinity, forward = Infinity;
  for (const candidate of candidates) {
    if (candidate === origin) continue;
    const rect = candidate.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - bounds.left - bounds.width / 2;
    const dy = rect.top + rect.height / 2 - bounds.top - bounds.height / 2;
    const nextForward = direction * (horizontal ? dx : dy), nextAcross = Math.abs(horizontal ? dy : dx);
    if (nextForward > 1 && (nextAcross < across || (nextAcross === across && nextForward < forward))) {
      nearest = candidate; across = nextAcross; forward = nextForward;
    }
  }
  return nearest;
}

export function rectangleCells(anchorKey, targetKey) {
  const [firstRow, firstColumn] = anchorKey.split(':').map(Number), [lastRow, lastColumn] = targetKey.split(':').map(Number);
  const selected = new Set();
  for (let row = Math.min(firstRow, lastRow); row <= Math.max(firstRow, lastRow); row++) {
    for (let column = Math.min(firstColumn, lastColumn); column <= Math.max(firstColumn, lastColumn); column++) selected.add(row + ':' + column);
  }
  return selected;
}
