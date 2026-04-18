/**
 * @fileoverview タグの並び順ユーティリティ
 */

import type { TagInfo } from "./types";

/**
 * タグ名を文字コード順（UTF-16コード単位の辞書順）で比較する。
 *
 * `localeCompare`はロケール依存で環境によって順序が揺れるため、
 * 本アプリでは常に決定論的な文字コード順に統一する。
 */
export function compareTagName(a: TagInfo, b: TagInfo): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}
