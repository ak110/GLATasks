export function splitTitle(text: string): string {
  return text
    .split("\n", 1)[0]
    .replace(/^[\r\n]+/, "")
    .trimEnd();
}

export function splitNotes(text: string): string {
  const idx = text.indexOf("\n");
  return idx === -1
    ? ""
    : text
        .slice(idx + 1)
        .replace(/^[\r\n]+/, "")
        .trimEnd();
}
