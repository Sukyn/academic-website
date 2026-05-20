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

  let s = input.replaceAll("\\(", "$").replaceAll("\\)", "$");
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner) => `$${inner}$`);

  const parts: string[] = [];

  while (s.includes("$")) {
    const a = s.indexOf("$");
    const b = s.indexOf("$", a + 1);
    if (b === -1) break;

    const before = s.slice(0, a);
    if (before) parts.push(escapeHtml(before));

    const math = s.slice(a + 1, b).trim();
    if (math) {
      parts.push(
        katex.renderToString(math, {
          throwOnError: false,
          displayMode: false,
          output: "html",
          strict: "ignore",
        }),
      );
    }

    s = s.slice(b + 1);
  }

  if (s) parts.push(escapeHtml(s));

  return parts.join("");
}
