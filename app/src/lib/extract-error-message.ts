/**
 * @fileoverview tRPCエラーからユーザー向けメッセージを抽出する共通処理
 */

/** tRPCエラーからユーザー向けメッセージを抽出する */
export function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "エラーが発生しました";

  // tRPC の ZodValidationError: message が JSON 配列文字列になっている
  try {
    const parsed = JSON.parse(error.message);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].message) {
      return parsed[0].message;
    }
  } catch {
    // JSON でなければそのまま使う
  }

  return error.message || "エラーが発生しました";
}
