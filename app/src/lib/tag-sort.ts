import type { TagInfo } from "./types";

export function compareTagName(a: TagInfo, b: TagInfo): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}
