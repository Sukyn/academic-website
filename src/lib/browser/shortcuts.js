/** Leave native editing and modal keyboard handling to their own controls. */
export function ignoresShortcut(event, allowRepeat = false) {
  return Boolean(event.defaultPrevented || event.altKey || (!allowRepeat && event.repeat) || event.target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || document.querySelector('dialog[open]'));
}
