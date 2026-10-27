export const TUTORIAL_INTRO = 'H and T rotate the qubit state on the Bloch sphere. The gold region marks the target and its allowed error.';

export const GOLF_TUTORIAL = Object.freeze({
  level: 8,
  moves: Object.freeze([
    { gate: 'T', text: 'T rotates the state 45° about the z axis, which joins |0⟩ and |1⟩ on the Bloch sphere.' },
    { gate: 'H', text: 'The Hadamard gate H rotates 180° about the axis halfway between |0⟩ and |+⟩.' },
    { gate: 'T', text: 'This T rotation changes the azimuth, the angle around z, while preserving the z coordinate.' },
    { gate: 'H', text: 'H exchanges the x and z coordinates and reverses y.' },
    { gate: 'T', text: 'A further T gate rotates another 45° about z.' },
    { gate: 'H', text: 'This H rotation sets the latitude for the final four T gates.' },
    { gate: 'T', text: 'Four consecutive T gates rotate 180° about z; this first gate contributes 45°.' },
    { gate: 'T', text: 'The second T brings this final rotation to 90°.' },
    { gate: 'T', text: 'The third T brings it to 135°.' },
    { gate: 'T', text: 'The fourth T completes the half-turn and reaches the gold region, which marks the allowed error.' },
  ]),
});
