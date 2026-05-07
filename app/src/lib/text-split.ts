/**
 * @fileoverview タスクテキスト（`title\n\nnotes` 形式）の分割ユーティリティ
 *
 * サーバー側DB保存値とクライアント側楽観的更新の双方で同一ロジックを使うため、
 * client/server から参照可能な共通モジュールとして配置する。
 */

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
