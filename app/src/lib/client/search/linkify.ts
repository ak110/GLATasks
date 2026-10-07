/**
 * @fileoverview テキスト中のURLを自動リンクに変換するユーティリティ。
 * 日本語URLにも対応し、URIに使用できない文字（半角スペース等）で区切る。
 */

/** URLにマッチする正規表現（日本語等マルチバイト文字も許可、CJK句読点で区切り） */
const URL_PATTERN =
  /https?:\/\/[^\s<>"'`{}|\\^。、，．；：！？「」『』【】〈〉《》〔〕（）]+/g;

/** 末尾のURLとして不自然な句読点・括弧を除去 */
const TRAILING_PUNCT = /[,;)]+$/;

/** URLの末尾を整形する */
function trimTrailingPunct(url: string): string {
  return url.replace(TRAILING_PUNCT, "");
}

/** HTML特殊文字をエスケープ */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * テキスト中のURLをクリック可能なリンクに変換する。
 * XSS対策として非URL部分はHTMLエスケープする。
 * @returns HTMLエスケープ済み・リンク付きのHTML文字列
 */
export function linkify(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const url = trimTrailingPunct(rawUrl);
    const start = match.index;
    const end = start + url.length;

    // URL前のテキスト
    if (start > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, start)));
    }

    // リンクタグ（href属性はエスケープ、表示テキストもエスケープ）
    parts.push(
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline dark:text-blue-400">${escapeHtml(url)}</a>`,
    );

    lastIndex = end;
  }

  // 残りのテキスト
  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }

  return parts.join("");
}
