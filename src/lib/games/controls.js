export function updateModeMenu(get, mode, disabled = false) {
  for (const name of ['tutorial', 'campaign', 'random', 'daily']) {
    const button = get('mode-' + name);
    button.setAttribute('aria-pressed', String(name === mode));
    button.disabled = disabled;
  }
}

/** Common overlay actions; each game still decides which controls are enabled. */
export function bindGameDialogs(get = id => document.getElementById(id)) {
  const rules = get('rules-dialog'), win = get('win-dialog'), showRules = get('show-rules');
  showRules.addEventListener('click', () => { if (!showRules.disabled && !rules.open) rules.showModal(); });
  get('close-rules').addEventListener('click', () => rules.close());
  get('close-win').addEventListener('click', () => win.close());
  for (const dialog of [rules, win]) dialog.addEventListener('click', event => {
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
