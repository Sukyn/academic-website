import bibtexParse from "bibtex-parse-js";

export type Pub = {
  id: string;
  title: string;
  authors: string;
  year?: number;
  venue?: string;
  url?: string;
  pdf?: string;
  type?: string;
};

function getTag(tags: Record<string, any>, key: string): string | undefined {
  if (!tags) return undefined;

  // exact match
  if (tags[key] != null) return String(tags[key]);

  // case-insensitive match (covers title/TITLE/Title etc.)
  const lowerKey = key.toLowerCase();
  for (const k of Object.keys(tags)) {
    if (k.toLowerCase() === lowerKey) return String(tags[k]);
  }
  return undefined;
}

function pickVenue(tags: Record<string, any>) {
  return (
    getTag(tags, "journal") ||
    getTag(tags, "booktitle") ||
    getTag(tags, "school") ||
    getTag(tags, "publisher") ||
    getTag(tags, "howpublished") ||
    ""
  );
}

export function parseBibtexToPubs(bibtex: string): Pub[] {
  const entries = bibtexParse.toJSON(bibtex) ?? [];

  const pubs: Pub[] = entries.map((e: any) => {
    const t = (e.entryTags ?? {}) as Record<string, any>;

    const yearRaw = getTag(t, "year");
    const year = yearRaw ? Number(yearRaw) : undefined;

    const doi = getTag(t, "doi");
    const url = getTag(t, "url") ?? (doi ? `https://doi.org/${doi}` : undefined);

    return {
      id: e.citationKey ?? cryptoRandomId(),
      title: getTag(t, "title") ?? "Untitled",
      authors: (getTag(t, "author") ?? "").replaceAll("\n", " "),
      year: Number.isFinite(year) ? year : undefined,
      venue: pickVenue(t),
      url,
      pdf: getTag(t, "pdf"),
      type: e.entryType,
    };
  });

  pubs.sort((a, b) => (b.year ?? -1) - (a.year ?? -1));
  return pubs;
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 10);
}
