export type TopicKey =
  | "qudit-clifford"
  | "linear-optics"
  | "outreach"
  | "algebraic-viewpoints"
  | "equational-theory"
  | "zx-zh"
  | "circuit-fragments";

export type OfferSummary = {
  id: string;
  topicKey: TopicKey;
  title: string;
  status: string;
  statusClass: string;
  fitBadge: string;
  fit: string;
  background: string;
  scope: string;
  output: string;
  firstMilestone: string;
};

export const offerSummaries: OfferSummary[] = [
  {
    id: "offer-arbitrary-d-clifford",
    topicKey: "qudit-clifford",
    title: "Axiomatization of Clifford circuits for qudits (arbitrary dimension d, including composite)",
    status: "Open / exploratory",
    statusClass: "pill--open",
    fitBadge: "Fit: advanced M2 or PhD",
    fit: "Best for someone comfortable with ambiguity, because part of the job is deciding the right formal setting.",
    background: "Clifford/stabilizer structure, composite dimensions, and proof-oriented programming.",
    scope: "Scope: deep",
    output: "A dimension-generic framework with at least one concrete benchmark family.",
    firstMilestone: "Fix a clean composite-d gate convention and map a minimal benchmark suite.",
  },
  {
    id: "offer-even-d-clifford",
    topicKey: "qudit-clifford",
    title: "Axiomatization of Clifford circuits in even dimensions (power-of-two and beyond)",
    status: "Tomorrow-problem",
    statusClass: "pill--incubating",
    fitBadge: "Fit: strong M2 or PhD",
    fit: "Good for someone who likes identifying exactly where a prime-dimensional argument breaks.",
    background: "Odd-prime Clifford theory and willingness to chase subtle counterexamples in even d.",
    scope: "Scope: deep and open-ended",
    output: "Either a targeted axiomatization for even d or a sharp map of the main obstructions.",
    firstMilestone: "Catalogue the identities that fail in d = 4 and isolate one fragment that still rewrites cleanly.",
  },
  {
    id: "offer-lov-hadamard",
    topicKey: "linear-optics",
    title: "Generalized Hadamard (Fourier) gates in LOv-calculus (prime & composite dimensions)",
    status: "Open / exploratory",
    statusClass: "pill--open",
    fitBadge: "Fit: M2/PhD or independent project",
    fit: "A strong match for someone who likes explicit constructions, matrix identities, and turning them into a generator.",
    background: "Linear algebra, some coding, and patience for convention-fixing.",
    scope: "Scope: medium to deep",
    output: "A circuit generator, verifier, and resource benchmarks.",
    firstMilestone: "Generate and verify H_d circuits for d = 2, 3, and 5.",
  },
  {
    id: "offer-chevaliers",
    topicKey: "outreach",
    title: 'Extend the outreach game "Les Chevaliers du Quantique" (new content + challenge packs + guided solutions)',
    status: "Actively looking for help",
    statusClass: "pill--open",
    fitBadge: "Fit: side project or collaboration",
    fit: "Best for someone who wants a useful deliverable quickly and enjoys pedagogy as much as code.",
    background: "Web development, scientific communication, or educational design.",
    scope: "Scope: small to medium",
    output: "New extension content for the playable web version plus clearer guided learning material.",
    firstMilestone: "Ship one polished extension pack or level sequence with explicit learning goals and a short guided solution.",
  },
  {
    id: "offer-qutrit-few-roots",
    topicKey: "algebraic-viewpoints",
    title: 'Generalise "With a Few Square Roots, Quantum Computing is as Easy as π" to qutrits (cube roots of unity)',
    status: "Open / exploratory",
    statusClass: "pill--open",
    fitBadge: "Fit: advanced M2 or PhD",
    fit: "Good for someone who wants a theorem-first project with a plausible exact-synthesis payoff.",
    background: "Exact synthesis, algebraic number theory, or strong symbolic manipulation.",
    scope: "Scope: deep",
    output: "Either a constructive theorem or a convincing obstruction.",
    firstMilestone: "Test a few candidate cube-root rings on small qutrit unitaries.",
  },
  {
    id: "offer-geometric-algebra-qudits",
    topicKey: "algebraic-viewpoints",
    title: "Geometric algebra / (generalised) Clifford algebra frameworks for qudits",
    status: "Tomorrow-problem",
    statusClass: "pill--incubating",
    fitBadge: "Fit: self-directed M2 or PhD",
    fit: "Best for someone comfortable learning a new formalism and deciding whether it actually buys us anything.",
    background: "Strong algebra and patience for survey-heavy early work.",
    scope: "Scope: exploratory",
    output: "A survey with one candidate bridge to compiler or rewrite tooling.",
    firstMilestone: "Translate one familiar qudit gate family into the algebraic formalism and see what simplifies.",
  },
  {
    id: "offer-scaling-generators",
    topicKey: "equational-theory",
    title: "Reduce the scaling generators in prime-dimensional affine / phase calculi",
    status: "Current focus",
    statusClass: "pill--focus",
    fitBadge: "Fit: M1 or M2",
    fit: "A nice entry project if you want a concrete completeness problem with manageable scope.",
    background: "Finite fields, rewriting arguments, and comfort with small symbolic calculations.",
    scope: "Scope: medium",
    output: "A smaller presentation with cleaner generators.",
    firstMilestone: "Replace the full scaling family in a toy fragment and check which local rewrites survive.",
  },
  {
    id: "offer-beyond-prime-dimensions",
    topicKey: "equational-theory",
    title: "Beyond prime dimensions: affine-plus-diagonal calculi over prime powers and finite rings",
    status: "Current focus",
    statusClass: "pill--focus",
    fitBadge: "Fit: ambitious M2 or PhD",
    fit: "Best for someone who likes choosing the right mathematical setting before proving anything.",
    background: "Finite fields, rings, and completeness-style proofs.",
    scope: "Scope: deep",
    output: "A generalized calculus or a precise obstruction explaining why one fails.",
    firstMilestone: "Pick prime powers or rings as the first target and write the minimal generator list.",
  },
  {
    id: "offer-higher-degree-phase-hierarchies",
    topicKey: "equational-theory",
    title: "Higher-degree phase fragments and refined phase hierarchies for qudits",
    status: "Current focus",
    statusClass: "pill--focus",
    fitBadge: "Fit: advanced M2 or PhD",
    fit: "A good fit if you like phase polynomials, hierarchy questions, and examples that turn into general structure.",
    background: "Phase gadgets, combinatorics, and qudit circuit structure.",
    scope: "Scope: deep",
    output: "A new fragment together with higher-degree generators or hierarchy results.",
    firstMilestone: "Work out the degree-4 case in one prime dimension and identify the first forced generator.",
  },
  {
    id: "offer-qudit-zx-extraction",
    topicKey: "zx-zh",
    title: "Circuit extraction from qudit ZX-calculus diagrams (arbitrary d)",
    status: "Backlog / parked",
    statusClass: "pill--parked",
    fitBadge: "Fit: implementation-heavy M2 or PhD",
    fit: "Best for someone who wants to build tooling and is comfortable making pragmatic choices about fragments.",
    background: "ZX calculus, graph algorithms, and benchmarking.",
    scope: "Scope: deep",
    output: "An extraction pipeline with a concrete target gate set.",
    firstMilestone: "Define one extractable normal form and run extraction on small diagrams.",
  },
  {
    id: "offer-qutrit-zx-extraction",
    topicKey: "zx-zh",
    title: "Circuit extraction from qutrit ZX-calculus diagrams",
    status: "Backlog / parked",
    statusClass: "pill--parked",
    fitBadge: "Fit: M2+ or independent implementation project",
    fit: "A reasonable implementation project if you want something smaller and more concrete than the arbitrary-d version.",
    background: "Qutrit ZX basics and practical coding.",
    scope: "Scope: medium to deep",
    output: "A qutrit-only prototype with small benchmarks.",
    firstMilestone: "Adapt one qutrit simplification pass and extract circuits on a toy dataset.",
  },
  {
    id: "offer-two-level-zx",
    topicKey: "zx-zh",
    title: "A ZX-like calculus built around two-level gates (hardware-native qudit operations)",
    status: "Backlog / parked",
    statusClass: "pill--parked",
    fitBadge: "Fit: strong M2 or PhD",
    fit: "Best for someone who wants a foundational calculus project with direct hardware flavor.",
    background: "Diagrammatic reasoning plus hardware-aware gate synthesis.",
    scope: "Scope: deep and foundational",
    output: "A candidate calculus with first rewrite rules.",
    firstMilestone: "Choose generators and semantics for a strict two-level fragment.",
  },
  {
    id: "offer-single-qupit-clifford-t",
    topicKey: "circuit-fragments",
    title: "Axiomatization of single-qupit Clifford+(T) / cyclotomic circuits (one wire)",
    status: "Current focus",
    statusClass: "pill--focus",
    fitBadge: "Fit: M2",
    fit: "A good project if you want exact synthesis on a contained one-wire setting.",
    background: "Exact synthesis and algebraic gate sets.",
    scope: "Scope: medium",
    output: "A normal form plus a small exact synthesizer.",
    firstMilestone: "Fix a concrete gate set and implement exact synthesis on one wire.",
  },
  {
    id: "offer-controlled-x-algorithms",
    topicKey: "circuit-fragments",
    title: "Exploit generalised qudit controlled-X decompositions to improve algorithms (compression/storage tradeoffs)",
    status: "Current focus",
    statusClass: "pill--focus",
    fitBadge: "Fit: M1/M2 or independent project",
    fit: "Best for someone who enjoys benchmarks, concrete tradeoffs, and a more systems-facing project.",
    background: "Circuit synthesis, benchmarking, and enough coding to compare implementations.",
    scope: "Scope: medium",
    output: "A tradeoff study with a benchmark suite.",
    firstMilestone: "Choose one arithmetic or oracle block and compare qubit versus qudit encodings.",
  },
  {
    id: "offer-fault-tolerance-by-construction",
    topicKey: "circuit-fragments",
    title: '"Fault Tolerance by Construction": extend the framework to qudit circuits',
    status: "Current focus",
    statusClass: "pill--focus",
    fitBadge: "Fit: PhD",
    fit: "Best for someone who wants a high-risk project at the intersection of rewriting and fault tolerance.",
    background: "Noise models, rewrite systems, and fault-tolerant circuit theory.",
    scope: "Scope: deep",
    output: "A qudit-safe rewrite criterion and a first prototype pipeline.",
    firstMilestone: "Define a minimal qudit fault-equivalence notion and test it on a tiny rewrite set.",
  },
  {
    id: "offer-clifford-ancilla-minimisation",
    topicKey: "circuit-fragments",
    title: "Clifford+ancilla minimisation (gate count/depth vs number of ancillas)",
    status: "Current focus",
    statusClass: "pill--focus",
    fitBadge: "Fit: advanced M2 or PhD",
    fit: "A good fit for someone who likes optimization problems, solver thinking, and quantitative tradeoffs.",
    background: "Circuit metrics, optimization, and ideally some SAT or search experience.",
    scope: "Scope: deep",
    output: "A Pareto-style optimizer or strong lower/upper bounds.",
    firstMilestone: "Model one small Clifford family and produce a first ancilla-versus-depth frontier.",
  },
];

export const offerSummaryById = Object.fromEntries(
  offerSummaries.map((offer) => [offer.id, offer])
) as Record<string, OfferSummary>;

export const offerSummariesByTopic = offerSummaries.reduce(
  (acc, offer) => {
    acc[offer.topicKey].push(offer);
    return acc;
  },
  {
    "qudit-clifford": [],
    "linear-optics": [],
    outreach: [],
    "algebraic-viewpoints": [],
    "equational-theory": [],
    "zx-zh": [],
    "circuit-fragments": [],
  } as Record<TopicKey, OfferSummary[]>
);
