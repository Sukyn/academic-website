export const TUTORIAL_INTRO = 'Reach the gold target with H and T.';

export const GOLF_TUTORIAL = Object.freeze({
  level: 8,
  moves: Object.freeze([
    { gate: 'T', text: 'T rotates the state 45° around z, the axis through |0⟩ and |1⟩.' },
    { gate: 'H', text: 'H makes a half-turn around the axis halfway between |0⟩ and |+⟩.' },
    { gate: 'T', text: 'Apply T. The angle around z changes; the z coordinate stays fixed.' },
    { gate: 'H', text: 'Apply H to change the z coordinate.' },
    { gate: 'T', text: 'Apply T again.' },
    { gate: 'H', text: 'Apply H to set the z coordinate for the last four T gates.' },
    { gate: 'T', text: 'Apply the first of four T gates: together they make a half-turn around z.' },
    { gate: 'T', text: 'Apply the second T: 90° in total.' },
    { gate: 'T', text: 'Apply the third T: 135° in total.' },
    { gate: 'T', text: 'Apply the fourth T to enter the target. An approximate match is enough.' },
  ]),
});
