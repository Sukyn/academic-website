export const games = [
  { title: 'Circuit simplification', path: 'circuit-reduction', image: 'circuit-simplification' },
  { title: 'ZX simplification', path: 'zx-calculus', image: 'zx-calculus', imageFormat: 'svg' },
  { title: 'Quantum golf', path: 'quantum-golf', image: 'quantum-golf' },
  { title: 'Quantum signals', path: 'quantum-signals', image: 'quantum-signals' },
  { title: 'Graph states', path: 'graph-states', image: 'graph-states' },
];

export const gameImage = game => `/images/games/${game.image}.${game.imageFormat ?? 'webp'}`;
