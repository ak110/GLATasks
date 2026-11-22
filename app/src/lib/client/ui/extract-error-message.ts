const FALLBACK_MESSAGE =
  "エラーが発生しました。ページを再読み込みしてから操作をやり直してください";

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
