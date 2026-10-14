import bibtexParse from "bibtex-parse-js";
import { webUrl } from "./links";

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

function pickVenue(tags: Record<string, string>) {
  return (
    tags.journal ||
    tags.booktitle ||
    tags.school ||
    tags.publisher ||
    tags.howpublished ||
    ""
  );
}

function findClosingDelimiter(source: string, start: number, open: string, close: string) {
  let depth = 0;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === open) depth += 1;
    if (char === close) depth -= 1;

    if (depth === 0) return index;
  }

  return -1;
}

function outerBracesWrapValue(value: string) {
  return (
    value.startsWith("{") &&
    value.endsWith("}") &&
    findClosingDelimiter(value, 0, "{", "}") === value.length - 1
  );
}

function cleanDisplayText(value: string) {
  let text = value.trim();

  while (outerBracesWrapValue(text)) {
    text = text.slice(1, -1).trim();
  }

  return text;
}

function formatAuthorName(name: string) {
  // Braces make an organisation a single author, including commas and "and".
  if (outerBracesWrapValue(name.trim())) return cleanDisplayText(name);
  const parts = name
    .split(",")
    .map((part) => cleanDisplayText(part))
    .filter(Boolean);

  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  if (parts.length === 3) return `${parts[2]} ${parts[0]}, ${parts[1]}`;

  return cleanDisplayText(name);
}

function formatAuthors(authors: string) {
  const text = authors.replace(/\s+/g, " ").trim();
  const names: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") { index += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (depth === 0 && text.slice(index, index + 5).toLowerCase() === " and ") {
      names.push(text.slice(start, index));
      index += 4;
      start = index + 1;
    }
  }
  names.push(text.slice(start));
  return names.map(formatAuthorName).filter(Boolean).join(", ");
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
    const endIndex = findClosingDelimiter(source, bodyStart, openChar, closeChar);

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
  // The parser scans % comments until a newline, including at end of input.
  // The sentinel prevents a trailing comment from trapping the build in a loop.
  let entries: Array<{ citationKey: string; entryType: string; entryTags?: Record<string, string> }>;
  try {
    entries = bibtexParse.toJSON(`${bibtex}\n`);
  } catch (error) {
    throw new Error("Invalid publication BibTeX.", { cause: error });
  }
  const rawEntries = extractRawEntries(bibtex);

  const pubs: Pub[] = entries.filter((entry) => entry.entryTags).map((e, index) => {
    // Normalise once, rather than scanning every tag for each requested field.
    const t = Object.fromEntries(Object.entries(e.entryTags!).map(([key, value]) => [key.toLowerCase(), value]));

    const yearRaw = t.year;
    const year = yearRaw ? Number(yearRaw) : undefined;

    const doi = t.doi;
    const url = webUrl(t.url) ?? (doi ? webUrl(`https://doi.org/${doi}`) : undefined);
    const id = e.citationKey ?? `entry-${index + 1}`;

    return {
      id,
      title: cleanDisplayText(t.title ?? "Untitled"),
      authors: formatAuthors(t.author ?? ""),
      year: Number.isFinite(year) ? year : undefined,
      venue: pickVenue(t),
      url,
      doi,
      note: t.note,
      pages: t.pages,
      citation: rawEntries.get(id),
      type: e.entryType,
    };
  });

  pubs.sort((a, b) => (b.year ?? -1) - (a.year ?? -1));
  return pubs;
}
