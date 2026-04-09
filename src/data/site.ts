export const siteProfile = {
  name: "Colin Blake",
  affiliation: "PhD student, Inria MOCQUA",
  researchArea: "Qudit circuit theory, rewriting, and compilation",
  email: "colin.blake@inria.fr",
  scholarUrl:
    "https://scholar.google.com/citations?user=ocfCHPcAAAAJ&hl=fr&oi=sra",
  linkedinUrl: "https://www.linkedin.com/in/colin-blake/",
} as const;

export const profileLinks = [
  { label: "Google Scholar", href: siteProfile.scholarUrl },
  { label: "LinkedIn", href: siteProfile.linkedinUrl },
] as const;

export const internalQuickLinks = [
  { label: "Publications", href: "/publications" },
  { label: "Research ideas", href: "/offers" },
] as const;
