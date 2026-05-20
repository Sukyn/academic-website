export type PublicationNote = {
  status: string;
  summary: string;
};

export const publicationNotesById: Record<string, PublicationNote> = {
  blake2026completenessprimedimensionalphaseaffinecircuits: {
    status: "Preprint",
    summary:
      "Presents complete PROP presentations and normal forms for affine circuits with bounded-degree phase-polynomial extensions over prime fields.",
  },
  blake2026polycontrolledpropsquditcircuits: {
    status: "Preprint",
    summary:
      "Gives a finite dimension-uniform equational presentation for exact qudit circuits using primitive value-control in a polycontrolled PROP.",
  },
  blake2026simplerpresentationsfragmentsquantum: {
    status: "FSCD 2026 proceedings",
    summary:
      "Transfers six circuit-fragment completeness theorems to PROP presentations with structural permutations and proves minimality results for the resulting axiom systems.",
  },
};
