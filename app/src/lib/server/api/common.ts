import { ApiError } from "../api-errors";

import { and, eq } from "drizzle-orm";

import { TAG_COLOR_KEYS } from "#lib/schemas.ts";
import type { TagColorKey, TagInfo } from "#lib/schemas.ts";
import { compareTagName } from "../../tag-sort";
import { getDb } from "../db";
import { lists } from "../schema";

type Database = ReturnType<typeof getDb>;
export type DbConnection =
  Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export function toUtcIso(dt: Date): string {
  return dt.toISOString();
}

export function fromUtcIso(isoStr: string): Date {
  return new Date(isoStr);
}

export function parseTags(raw: string | null | undefined): TagInfo[] {
  if (!raw) return [];
  const knownColors = new Set<string>(TAG_COLOR_KEYS);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: TagInfo[] = [];
    for (const v of parsed) {
      if (
        typeof v === "object" &&
        v !== null &&
        typeof (v as { name: unknown }).name === "string" &&
        typeof (v as { color: unknown }).color === "string" &&
        knownColors.has((v as { color: string }).color)
      ) {
        const item = v as { name: string; color: string };
        result.push({ name: item.name, color: item.color as TagColorKey });
      }
    }
    result.sort(compareTagName);
    return result;
  } catch {
    return [];
  }
}

export function serializeTags(value: TagInfo[]): string {
  return JSON.stringify(value);
}

// SSOTは #lib/text-split.ts。サーバー・クライアント両方から参照されるため
// このファイルでは re-export のみとし、片側で再実装しない。
export { splitTitle, splitNotes } from "#lib/text-split.ts";

export async function touchListUpdated(
  listId: number,
  db: DbConnection = getDb(),
): Promise<void> {
  await db
    .update(lists)
    .set({ last_updated: new Date() })
    .where(eq(lists.id, listId));
}

export async function getOwnedList(
  listId: number,
  userId: number,
  db: DbConnection = getDb(),
) {
  const rows = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.user_id, userId)))
    .limit(1);
  if (rows.length === 0) throw new ApiError("not_found_or_forbidden");
  return rows[0];
}
