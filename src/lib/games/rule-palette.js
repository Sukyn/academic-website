/** Keep equation buttons and their legal moves in sync across the circuit games. */
export function createRulePalette(buttons, { apply, ruleOf = move => move.rule, choose = null }) {
  const entries = [...buttons], matches = new Map();
  function order(priority) {
    const parent = entries[0]?.parentElement;
    if (!parent || entries.some(button => button.parentElement !== parent)) return;
    const rank = button => button.dataset.rule === priority ? 0 : !button.disabled && !button.hidden ? 1 : 2;
    const ordered = [...entries].sort((a, b) => rank(a) - rank(b));
    const focused = parent.ownerDocument?.activeElement;
    let current = parent.firstElementChild;
    for (const button of ordered) {
      if (button === current) current = current.nextElementSibling;
      else (parent.moveBefore ?? parent.insertBefore).call(parent, button, current);
    }
    // Older browsers can blur a moved button; keep keyboard users on that control.
    if (entries.includes(focused) && parent.ownerDocument.activeElement !== focused) focused.focus({ preventScroll: true });
  }
  for (const button of entries) button.addEventListener('click', () => {
    const moves = matches.get(button.dataset.rule);
    if (button.disabled || button.hidden || !moves?.length) return;
    if (moves.length > 1 && choose) choose(moves, button);
    else apply(moves[0]);
  });
  return {
    update(moves, { allowed, disabled = false } = {}) {
      matches.clear();
      if (!disabled) for (const move of moves) {
        const rule = ruleOf(move);
        if (!matches.has(rule)) matches.set(rule, []);
        matches.get(rule).push(move);
      }
      for (const button of entries) {
        button.hidden = Boolean(allowed && !allowed.includes(button.dataset.rule));
        button.disabled = disabled || button.hidden || !matches.has(button.dataset.rule);
      }
      if (!disabled) order();
    },
    // A tutorial locks all other buttons after normal availability is rendered.
    prioritize(rule) { if (rule) order(rule); },
  };
}
