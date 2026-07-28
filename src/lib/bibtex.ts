import bibtexParse from "bibtex-parse-js";

export type Pub = {
  id: string;
  title: string;
  authors: string;
  year?: number;
  venue?: string;
  url?: string;
  doi?: string;
  note?: string;
  pages?: string;
  citation?: string;
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

function outerBracesWrapValue(value: string) {
  if (!value.startsWith("{") || !value.endsWith("}")) return false;

  let depth = 0;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth === 0 && index < value.length - 1) return false;
  }

  return depth === 0;
}

function cleanDisplayText(value: string) {
  let text = value.trim();

  while (outerBracesWrapValue(text)) {
    text = text.slice(1, -1).trim();
  }

  return text;
}

function formatAuthorName(name: string) {
  const parts = name
    .split(",")
    .map((part) => cleanDisplayText(part))
    .filter(Boolean);

  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  if (parts.length === 3) return `${parts[2]} ${parts[1]} ${parts[0]}`;

  return cleanDisplayText(name);
}

function formatAuthors(authors: string) {
  return authors
    .replaceAll("\n", " ")
    .split(/\s+and\s+/i)
    .map(formatAuthorName)
    .join(", ");
}

function extractRawEntries(source: string) {
  const entries = new Map<string, string>();
  let index = 0;

  while (index < source.length) {
    const atIndex = source.indexOf("@", index);
    if (atIndex === -1) break;

    const openIndex = source.slice(atIndex).search(/[({]/);
    if (openIndex === -1) break;

    const bodyStart = atIndex + openIndex;
    const openChar = source[bodyStart];
    const closeChar = openChar === "{" ? "}" : ")";
    const commaIndex = source.indexOf(",", bodyStart + 1);
    if (commaIndex === -1) break;

    const citationKey = source.slice(bodyStart + 1, commaIndex).trim();
    let depth = 0;
    let escaped = false;
    let endIndex = -1;

    for (let cursor = bodyStart; cursor < source.length; cursor += 1) {
      const char = source[cursor];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === openChar) depth += 1;
      if (char === closeChar) depth -= 1;

      if (depth === 0) {
        endIndex = cursor;
        break;
      }
    }

    if (citationKey && endIndex !== -1) {
      entries.set(citationKey, source.slice(atIndex, endIndex + 1).trim());
      index = endIndex + 1;
    } else {
      index = commaIndex + 1;
    }
  }

  return entries;
}

export function parseBibtexToPubs(bibtex: string): Pub[] {
  const entries = bibtexParse.toJSON(bibtex) ?? [];
  const rawEntries = extractRawEntries(bibtex);

  const pubs: Pub[] = entries.map((e: any, index: number) => {
    const t = (e.entryTags ?? {}) as Record<string, any>;

    const yearRaw = getTag(t, "year");
    const year = yearRaw ? Number(yearRaw) : undefined;

    const doi = getTag(t, "doi");
    const url = getTag(t, "url") ?? (doi ? `https://doi.org/${doi}` : undefined);
    const id = e.citationKey ?? `entry-${index + 1}`;

    return {
      id,
      title: cleanDisplayText(getTag(t, "title") ?? "Untitled"),
      authors: formatAuthors(getTag(t, "author") ?? ""),
      year: Number.isFinite(year) ? year : undefined,
      venue: pickVenue(t),
      url,
      doi,
      note: getTag(t, "note"),
      pages: getTag(t, "pages"),
      citation: rawEntries.get(id),
      type: e.entryType,
    };
  });

  pubs.sort((a, b) => (b.year ?? -1) - (a.year ?? -1));
  return pubs;
}
