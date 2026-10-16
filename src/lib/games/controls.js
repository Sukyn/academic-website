export function updateModeMenu(get, mode, disabled = false, saving = false) {
  for (const name of ['tutorial', 'campaign', 'random', 'daily']) {
    const button = get('mode-' + name);
    button.setAttribute('aria-pressed', String(name === mode));
    button.disabled = disabled;
  }
  get('daily-games').hidden = mode !== 'daily';
  get('daily-games').inert = saving;
  get('check-daily-puzzles').hidden = mode !== 'daily';
  get('check-daily-puzzles').disabled = saving;
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
  get('check-daily-puzzles').addEventListener('click', () => {
    if (get('check-daily-puzzles').hidden || get('check-daily-puzzles').disabled || !win.open) return;
    win.close();
    get('daily-games').scrollIntoView({ block: 'start' });
    get('daily-games').focus({ preventScroll: true });
  });
  for (const dialog of dialogs) dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}

/** Leave native editing and modal keyboard handling to their own controls. */
export function ignoresGameShortcut(event) {
  return Boolean(event.defaultPrevented || event.altKey || event.repeat || event.target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || document.querySelector('dialog[open]'));
}
