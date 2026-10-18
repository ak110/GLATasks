/**
 * @fileoverview tRPCエラーからユーザー向けメッセージを抽出する共通処理
 */

/** 送出元が文面を持たない失敗の既定文 */
const FALLBACK_MESSAGE =
  "エラーが発生しました。ページを再読み込みしてから操作をやり直してください";

/** tRPCエラーからユーザー向けメッセージを抽出する */
export function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return FALLBACK_MESSAGE;

  if (
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "validationIssues" in error.data
  ) {
    const issues = error.data.validationIssues;
    if (Array.isArray(issues)) {
      const issue: unknown = issues[0];
      if (
        typeof issue === "object" &&
        issue !== null &&
        "message" in issue &&
        typeof issue.message === "string"
      )
        return issue.message;
    }
  }

  return error.message || FALLBACK_MESSAGE;
}
