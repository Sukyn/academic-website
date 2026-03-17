export type PublicationNote = {
  status: string;
  summary: string;
};

export const publicationNotesById: Record<string, PublicationNote> = {
  blake2026completenessprimedimensionalphaseaffinecircuits: {
    status: "Preprint",
    summary:
      "Gives a complete equational theory for prime-dimensional phase-affine circuits in a form meant to be uniform and rewrite-friendly.",
  },
  blake2026polycontrolledpropsquditcircuits: {
    status: "Preprint",
    summary:
      "Builds a uniform PROP-level account of controlled structure for qudit circuits across arbitrary finite dimension.",
  },
  blake2026simplerpresentationsfragmentsquantum: {
    status: "Preprint",
    summary:
      "Looks for leaner presentations of familiar circuit fragments so the algebra is easier to read, compare, and automate.",
  },
};
