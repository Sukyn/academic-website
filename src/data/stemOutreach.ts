export type StemOutreachLink = {
  label: string;
  href: string;
};

export type StemOutreachItem = {
  id: string;
  title: string;
  date: string;
  meta?: string;
  summary: string;
  links: StemOutreachLink[];
};

export const stemOutreach: StemOutreachItem[] = [
  {
    id: "les-chevaliers-du-quantique",
    title: "Les Chevaliers du Quantique",
    date: "2025-04-04",
    meta: "Scientific Game Jam Nancy 2025 | First prize",
    summary:
      "Playable outreach game built from my research on quantum-circuit simplification, designed to introduce circuit rewriting through an accessible puzzle format for middle-school students and above.",
    links: [
      {
        label: "Play online",
        href: "https://sukyn.itch.io/les-chevaliers-du-quantique",
      },
      {
        label: "NanSciNum article",
        href: "/outreach/les-chevaliers-du-quantique-nanscinum-2025-04-04.html",
      },
      {
        label: "Pixees article",
        href: "https://pixees.fr/les-chevaliers-du-quantique-1er-prix-de-la-scientific-game-jam/",
      },
      {
        label: "Press clipping (PDF)",
        href: "/outreach/les-chevaliers-du-quantique-press-clipping-2025-03-05.pdf",
      },
    ],
  },
  {
    id: "village-des-sciences-2025",
    title: "Village des Sciences - Fete de la Science 2025",
    date: "2025-10-10",
    meta: "10-11 October 2025 | Faculte des Sciences et Technologies, Vandoeuvre-les-Nancy",
    summary:
      "Public-facing workshop built around Les Chevaliers du Quantique during the Village des Sciences, combining the playable game with a hands-on tile activity to help school groups and the general public explore qubits and quantum-circuit simplification.",
    links: [
      {
        label: "Event page",
        href: "https://www.loria.fr/event/village-des-sciences-de-la-faculte-des-sciences-et-technologies/",
      },
      {
        label: "Loria article",
        href: "https://www.loria.fr/fr/2025/09/le-loria-fete-la-culture-scientifique-2/",
      },
      {
        label: "NanSciNum article",
        href: "https://iww.inria.fr/NanSciNum/fete-de-la-science-2025-a-nancy-cap-sur-les-sciences-du-numerique/",
      },
      {
        label: "LinkedIn recap",
        href: "https://www.linkedin.com/posts/faeatedelascience-maezdiationscientifique-ugcPost-7382433059251310592-EQmy/",
      },
    ],
  },
  {
    id: "cap-sur-le-numerique-bercy-2025",
    title: "Cap sur le numerique a Bercy - Semaine NSI 2025",
    date: "2025-12-08",
    meta: "8 December 2025 | Ministere de l'Economie et des Finances, Paris",
    summary:
      "Outreach appearance for the opening event of Semaine NSI 2025, where I presented quantum-computing research and research careers to middle-school, high-school, and BTS students as part of Inria's broader scientific-mediation programme.",
    links: [
      {
        label: "Inria article",
        href: "https://www.inria.fr/fr/inria-rendez-vous-de-la-semaine-du-numerique-et-des-sciences-informatiques-2025",
      },
      {
        label: "LinkedIn recap",
        href: "https://www.linkedin.com/posts/inria_semainensi-activity-7403821113727688705-Wful",
      },
    ],
  },
];
