export const TUTORIAL = {
  graph: { vertices: 6, edges: [[0, 1], [0, 2], [0, 4], [0, 5], [1, 2], [1, 4], [1, 5], [3, 4], [3, 5], [4, 5]] },
  steps: [
    { move: { vertex: 1 }, text: 'Local complementation at vertex 2 adds missing edges between its neighbours and removes existing ones. Edges touching vertex 2 stay unchanged.' },
    { move: { vertex: 3 }, text: 'Local complementation at vertex 4 adds the edge between vertices 5 and 6.' },
    { move: { vertex: 2 }, text: 'Local complementation at vertex 3 removes the three edges between its neighbours.' },
    { move: { edge: [3, 4] }, text: 'Pivoting edge 4–5 performs three local complementations at vertices 4, 5, then 4, for 3 shots.' },
  ],
};
