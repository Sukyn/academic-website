import { visit } from "unist-util-visit";

const TYPE_MAP = {
  NOTE: "note",
  INFO: "info",
  WARNING: "warning",
  TIP: "note",
  IMPORTANT: "info",
  CAUTION: "warning",
};

function escapeHtml(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Turns:
 * > [!NOTE] Title
 * > Text...
 *
 * into an HTML aside with your .callout CSS classes.
 */
export default function remarkCallouts() {
  return (tree) => {
    visit(tree, "blockquote", (node, index, parent) => {
      if (!parent || typeof index !== "number") return;
      if (!node.children || node.children.length === 0) return;

      const first = node.children[0];
      if (!first || first.type !== "paragraph" || !first.children?.length) return;

      const firstTextNode = first.children[0];
      if (!firstTextNode || firstTextNode.type !== "text") return;

      // Match: [!NOTE] optional title...
      const m = firstTextNode.value.match(/^\s*\[!(NOTE|INFO|WARNING|TIP|IMPORTANT|CAUTION)\]\s*(.*)$/i);
      if (!m) return;

      const rawType = m[1].toUpperCase();
      const type = TYPE_MAP[rawType] ?? "note";
      const title = (m[2] ?? "").trim() || rawType;

      // Remove the marker from the first paragraph text
      firstTextNode.value = firstTextNode.value.replace(m[0], "").trimStart();

      // If the first paragraph becomes empty (marker-only), drop it.
      const firstParagraphNowEmpty =
        first.children.length === 1 &&
        first.children[0].type === "text" &&
        first.children[0].value.trim() === "";

      const innerNodes = firstParagraphNowEmpty ? node.children.slice(1) : node.children;

      // Build HTML string. We rely on Astro’s markdown allowing raw HTML.
      const headerHtml = `
<div class="callout__header">
  <span class="callout__icon" aria-hidden="true">${type === "warning" ? "⚠️" : type === "info" ? "ℹ️" : "📝"}</span>
  <strong class="callout__title">${escapeHtml(title)}</strong>
</div>`.trim();

      // Convert inner markdown nodes back to markdown by leaving them in place:
      // easiest robust approach: wrap the blockquote contents in a div via html nodes.
      // We'll keep the content as-is (markdown) but wrap with opening/closing HTML nodes.
      const opening = { type: "html", value: `<aside class="callout callout--${type}" aria-label="${type}">${headerHtml}<div class="callout__body">` };
      const closing = { type: "html", value: `</div></aside>` };

      // Replace the blockquote node with: opening html + its children (as normal mdast) + closing html
      parent.children.splice(index, 1, opening, ...innerNodes, closing);
    });
  };
}
