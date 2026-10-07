/**
 * @fileoverview tRPCエラーからユーザー向けメッセージを抽出する共通処理
 */

/** tRPCエラーからユーザー向けメッセージを抽出する */
export function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "エラーが発生しました";

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

  return error.message || "エラーが発生しました";
}
