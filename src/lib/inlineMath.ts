import katex from "katex";

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderInlineMath(input: string) {
  if (!input) return "";
  const parts: string[] = [];
  let textStart = 0;
  let opening: { delimiter: string; index: number; end: number } | undefined;
  const plainText = (text: string) => escapeHtml(text.replaceAll("\\$", "$"));

  // Scan delimiters once. Escaped dollars remain text; unmatched delimiters
  // remain readable. All supported math delimiters use the same inline style.
  for (const match of input.matchAll(/\\[\s\S]|\$\$?/g)) {
    const delimiter = match[0];
    const index = match.index!;
    if (!opening) {
      if (delimiter === "$" || delimiter === "$$" || delimiter === "\\(") {
        opening = { delimiter, index, end: index + delimiter.length };
      }
      continue;
    }
    const closing = opening.delimiter === "\\(" ? "\\)" : opening.delimiter;
    if (delimiter !== closing) continue;

    parts.push(plainText(input.slice(textStart, opening.index)));
    const math = input.slice(opening.end, index).trim();
    if (math) parts.push(katex.renderToString(math, {
      throwOnError: false,
      displayMode: false,
      output: "htmlAndMathml",
      strict: "ignore",
      trust: false,
    }));
    textStart = index + delimiter.length;
    opening = undefined;
  }
  parts.push(plainText(input.slice(textStart)));
  return parts.join("");
}
