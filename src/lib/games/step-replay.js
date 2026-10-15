/** Review discrete snapshots; clearing cancels playback without rendering. */
export function createStepReplay({ length, canReview, onEnter, onChange }) {
  let step = null, timer = null, revision = 0;
  function clear() {
    clearTimeout(timer); timer = null; step = null; revision++;
  }
  function inspect(next) {
    if (!canReview() || !Number.isInteger(next) || next < 0 || next > length()) return false;
    clear(); step = next; onEnter(); onChange(); return true;
  }
  function play() {
    if (!canReview() || !length()) return false;
    clear(); step = 0;
    const current = revision;
    const advance = () => {
      if (revision !== current) return;
      step++;
      timer = step < length() ? setTimeout(advance, 650) : null;
      onChange();
    };
    timer = setTimeout(advance, 650);
    onEnter(); onChange(); return true;
  }
  return { get step() { return step; }, get playing() { return timer !== null; }, inspect, play, clear };
}
