export const TUTORIAL_INTRO = 'Restore the numbered chain by complementing vertices.';

export const TUTORIAL = {
  graph: { vertices: 6, edges: [[0, 1], [0, 2], [0, 4], [0, 5], [1, 2], [1, 4], [1, 5], [3, 4], [3, 5], [4, 5]] },
  steps: [
    { move: { vertex: 1 }, text: 'Click vertex 2. Add missing edges between its neighbours and remove existing ones. Its own edges stay unchanged.' },
    { move: { vertex: 3 }, text: 'Complement vertex 4 to add the edge between vertices 5 and 6.' },
    { move: { vertex: 2 }, text: 'Complement vertex 3. This removes the three edges between its neighbours.' },
    { move: { edge: [3, 4] }, text: 'Advanced: click edge 4–5 to pivot. It applies three local complementations (4, 5, 4) and counts as 3 shots.' },
  ],
};
