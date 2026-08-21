export type PublicationLink = {
  label: string;
  href: string;
};

export type PublicationUpdate = {
  label: string;
  html: string;
};

export type PublicationNote = {
  status: string;
  summary: string;
  fullVersionUrl?: string;
  links?: PublicationLink[];
  updates?: PublicationUpdate[];
};

export const publicationNotesById: Record<string, PublicationNote> = {
  blake2026completenessprimedimensionalphaseaffinecircuits: {
    status: "Preprint",
    summary:
      "Presents complete PROP presentations and normal forms for affine circuits with bounded-degree phase-polynomial extensions over prime fields.",
  },
  "blake:LIPIcs.MFCS.2026.6": {
    status: "MFCS 2026 proceedings; Best Student Paper award",
    summary:
      "Gives a finite dimension-uniform equational presentation for exact qudit circuits using primitive value-control in a polycontrolled PROP.",
    fullVersionUrl: "https://arxiv.org/abs/2602.09873",
  },
  "blake:LIPIcs.FSCD.2026.6": {
    status: "FSCD 2026 proceedings",
    summary:
      "Transfers six circuit-fragment completeness theorems to PROP presentations with structural permutations and proves minimality results for the resulting axiom systems.",
    fullVersionUrl: "https://arxiv.org/abs/2602.09874",
    links: [
      {
        label: "Heuristics tool",
        href: "https://github.com/Sukyn/minimality-auto/",
      },
    ],
    updates: [
      {
        label: "Update 1",
        html: `For Clifford+T, rule (TX) can use <span class="math-inline">#{H, ω<sup>8</sup>}<sub>2</sub></span> instead of the <span class="math-inline">#{H, T, ω<sup>8</sup>}<sub>2</sub></span> used in the paper.`,
      },
      {
        label: "Update 2",
        html: `The Heuristics tool below implements more arguments than the paper uses, including the amalgam normal form, which seems especially useful for Euler-style equations, and a Spin-group interpretation that separates pattern (19) on <span class="math-inline"><var>n</var></span> wires in the recent real Clifford+CH presentation, where this was left open.`,
      },
      {
        label: "Update 3",
        html: `Thanks to Alexandre Clément, who gave a meta-argument for the remaining qutrit Clifford equation (I), validating the conjecture that the presentation in the paper is minimal for every <span class="math-inline"><var>n</var></span>.`,
      },
    ],
  },
};
