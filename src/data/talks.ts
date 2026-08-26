export type TalkLink = {
  label: string;
  href: string;
};

export type TalkAppearance = {
  id?: string;
  date?: string;
  dateLabel?: string;
  event?: string;
  slidesHref?: string;
  links?: TalkLink[];
  isUpcoming?: boolean;
};

export type Talk = {
  id: string;
  title: string;
  appearances: TalkAppearance[];
};

export const talks: Talk[] = [
  {
    id: "controlled-gates-in-qudits",
    title: "Controlled Gates in Qudits",
    appearances: [
      {
        id: "nanqi-2026-controlled-gates-in-qudits",
        date: "2026-09-03",
        event: "NANQI 2026 - Workshop calcul et communications quantiques, Nancy",
        links: [
          {
            label: "Abstract",
            href: "https://nanqi.sciencesconf.org/data/program/colin_blake.pdf",
          },
        ],
      },
    ],
  },
  {
    id: "completeness-prime-dimensional-phase-affine-circuits",
    title: "Completeness for Prime-Dimensional Phase-Affine Circuits",
    appearances: [
      {
        id: "qpl-2026-phase-affine-circuits",
        date: "2026-08-17",
        event: "QPL 2026 - 23rd International Conference on Quantum Physics and Logic, Amsterdam",
        slidesHref: "/notes/qpl-2026-phase-affine-circuits.pdf",
      },
    ],
  },
  {
    id: "polycontrolled-props-qudit-circuits",
    title: "A Complete Equational Presentation of Qudit Circuits via Polycontrolled PROPs",
    appearances: [
      {
        id: "mfcs-2026-polycontrolled-props-qudit-circuits",
        date: "2026-08-27",
        event:
          "MFCS 2026 - 51st International Symposium on Mathematical Foundations of Computer Science, Paris",
        slidesHref: "/notes/mfcs-2026-polycontrolled-props-qudit-circuits.pdf",
        isUpcoming: false,
      },
      {
        id: "polycontrolled-props-qudit-circuits-fmqc-2026",
        date: "2026-07-18",
        event: "FMQC 2026 - Second Workshop on Formal Methods in Quantum Computing, Lisbon",
        slidesHref: "/notes/fmqc-2026-polycontrolled-props-qudit-circuits.pdf",
      },
    ],
  },
  {
    id: "simpler-presentations-fragments",
    title: "Simpler Presentations for Many Fragments of Quantum Circuits",
    appearances: [
      {
        date: "2026-07-23",
        event:
          "FSCD 2026 - 11th International Conference on Formal Structures for Computation and Deduction, Lisbon",
        slidesHref: "/notes/fscd-2026-simpler-presentations.pdf",
      },
      {
        date: "2026-06-17",
        event: "LIQCS 2026 - Logic in Quantum Computer Science, Inria de Paris",
        slidesHref: "/notes/liqcs-2026-completeness-not-enough.pdf",
        links: [
          {
            label: "Extended abstract",
            href: "https://liqcs2026.github.io/assets/pdfs/LIQCS_2026_extended_abstract_24.pdf",
          },
        ],
      },
    ],
  },
  {
    id: "reasoning-for-qudit-circuits",
    title: "Reasoning for Qudit Circuits",
    appearances: [
      {
        date: "2026-05-13",
        event: "Department of Formal Methods PhD Day - Nancy",
        slidesHref: "/notes/slides_phd_presentation_2026.pdf",
      },
      {
        date: "2026-03-26",
        event: "MOCQUA PhD Day - Nancy",
        slidesHref: "/notes/slides_phd_presentation_2026.pdf",
      },
    ],
  },
  {
    id: "quantum-computing-and-zx-calculus",
    title: "Quantum computing and ZX-calculus",
    appearances: [
      {
        date: "2025-11-26",
        event: "Séminaires Jeunes chercheurs et chercheuses - Marne la Vallée",
        slidesHref: "/notes/zx-calculus-is-graphs.pdf",
      },
    ],
  },
  {
    id: "escape-the-matrix",
    title: "Escape the Matrix: Graphical Reasoning and Minimal Axioms for Quantum Circuits",
    appearances: [
      {
        date: "2025-05-06",
        event: "Département des méthodes formelles PhD Day - Nancy",
        slidesHref: "/notes/presentation-minimality.pdf",
      },
    ],
  },
];
