const URL_PATTERN =
  /https?:\/\/[^\s<>"'`{}|\\^。、，．；：！？「」『』【】〈〉《》〔〕（）]+/g;

const TRAILING_PUNCT = /[,;)]+$/;

function trimTrailingPunct(url: string): string {
  return url.replace(TRAILING_PUNCT, "");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function linkify(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const url = trimTrailingPunct(rawUrl);
    const start = match.index;
    const end = start + url.length;

    if (start > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, start)));
    }

    parts.push(
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline dark:text-blue-400">${escapeHtml(url)}</a>`,
    );

    lastIndex = end;
  }

  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }

  return parts.join("");
}
