/** Escapes text for safe inclusion inside HTML element content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders human-authored postmortem text as HTML. Deliberately minimal: no
 * markdown dependency, just paragraph breaks on blank lines and escaping of
 * everything else, because a status page's postmortem should read like a
 * plain incident report, not a rendered blog post.
 */
export function renderPostmortem(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`).join("\n");
}
