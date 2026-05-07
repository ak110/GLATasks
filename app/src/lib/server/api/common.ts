/**
 * @fileoverview サーバーAPI共通ユーティリティ（DB更新ヘルパー・変換関数・タグ操作）
 */

import { and, eq } from "drizzle-orm";

import { TAG_COLOR_KEYS } from "$lib/types";
import type { TagColorKey, TagInfo } from "$lib/types";
import { compareTagName } from "../../tag-sort";
import { getDb } from "../db";
import { lists } from "../schema";

// ── 日時変換ヘルパー ──

/**
 * DB の TIMESTAMP 型から読み込んだ Date を UTC ISO 文字列に変換する。
 *
 * TIMESTAMP 型は内部的に UTC で保存され、mysql2 が Date オブジェクトとして返す。
 * toISOString() でそのまま UTC 表現になる。
 */
export function toUtcIso(dt: Date): string {
  return dt.toISOString();
}

/**
 * クライアントから受け取った UTC ISO 文字列を DB に保存する Date に変換する。
 *
 * new Date(isoString) で UTC ミリ秒の Date を生成し、
 * TIMESTAMP 型に INSERT すると MariaDB が UTC として格納する。
 */
export function fromUtcIso(isoStr: string): Date {
  return new Date(isoStr);
}

// ── タグのシリアライズ ──

/**
 * DB の tags カラム（JSON文字列）を TagInfo 配列に復元する。
 *
 * 破損データや旧仕様のレコードに備え、パース失敗時は空配列にフォールバックする。
 */
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

/** TagInfo 配列を DB 保存用の JSON 文字列に変換する。 */
export function serializeTags(value: TagInfo[]): string {
  return JSON.stringify(value);
}

// ── タスクの title/notes 分割 ──

// SSOTは $lib/text-split.ts。サーバー・クライアント両方から参照されるため
// このファイルでは re-export のみとし、片側で再実装しない。
export { splitTitle, splitNotes } from "$lib/text-split";

// ── DB 更新ヘルパー ──

/** リストの last_updated を現在時刻に更新する */
export async function touchListUpdated(listId: number): Promise<void> {
  const db = getDb();
  await db
    .update(lists)
    .set({ last_updated: new Date() })
    .where(eq(lists.id, listId));
}

// ── 所有権チェック ──

export async function getOwnedList(listId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.user_id, userId)))
    .limit(1);
  if (rows.length === 0) throw new Error("not_found_or_forbidden");
  return rows[0];
}
