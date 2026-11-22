import type { TagInfo, TagColorKey } from "./types";
import { TAG_COLOR_KEYS } from "./types";

export { TAG_COLOR_KEYS };
export type { TagColorKey };

const COLOR_CLASS_MAP: Record<TagColorKey, string> = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
  emerald:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  yellow:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-200",
  slate: "bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-200",
};

export function getTagColorClass(color: string): string {
  return COLOR_CLASS_MAP[color as TagColorKey] ?? COLOR_CLASS_MAP.slate;
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function pickTagColor(
  name: string,
  usedColors: readonly string[],
): TagColorKey {
  const used = new Set(usedColors);
  const unused = TAG_COLOR_KEYS.filter((c) => !used.has(c));
  const pool = unused.length > 0 ? unused : TAG_COLOR_KEYS;
  return pool[hashString(name) % pool.length];
}

export function resolveTagColor(
  name: string,
  existing: readonly TagInfo[],
): TagColorKey {
  const trimmed = name.trim();
  const sameName = existing.find((t) => t.name === trimmed);
  if (sameName) return sameName.color;
  return pickTagColor(
    trimmed,
    existing.map((t) => t.color),
  );
}
