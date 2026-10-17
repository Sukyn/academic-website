/** Review snapshots, optionally waiting for a cancellable move animation. */
export function createStepReplay({ length, canReview, onEnter, onChange, transition = null, interval = 650 }) {
  let step = null, timer = null, animation = null, revision = 0;
  function clear() {
    revision++;
    clearTimeout(timer); timer = null; step = null;
    const current = animation; animation = null; current?.cancel();
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
      timer = null;
      const complete = () => {
        step++;
        timer = step < length() ? setTimeout(advance, interval) : null;
        onChange();
      };
      if (!transition) { complete(); return; }
      const job = animation = transition(step);
      onChange();
      job.finished.then(completed => {
        if (revision !== current || animation !== job) return;
        animation = null;
        if (completed) complete(); else onChange();
      });
    };
    timer = setTimeout(advance, interval);
    onEnter(); onChange(); return true;
  }
  return { get step() { return step; }, get playing() { return timer !== null || animation !== null; }, inspect, play, clear };
}
