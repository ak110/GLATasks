import { json } from "@sveltejs/kit";

/**
 * OAuthの失敗応答の`error_description`。理由と次の操作を別々の必須の値として受け取る。
 *
 * RFC 6749 5.2は`error_description`の文字を%x20-21・%x23-5B・%x5D-7EのASCIIに限るため、
 * 英語で書き、`"`と`\`を含めない。受け取るのはMCPクライアントとその開発者である。
 */
export interface OAuthErrorDescription {
  /** 起きた事実。ピリオドで終える */
  reason: string;
  /** クライアントが次に行う操作。ピリオドで終える */
  nextAction: string;
}

/** 理由と次の操作をつないで`error_description`の値にする。 */
export function formatOAuthErrorDescription(
  description: OAuthErrorDescription,
): string {
  return `${description.reason} ${description.nextAction}`;
}

export function errorResponse(
  code: string,
  description: OAuthErrorDescription,
  status = 400,
  headers?: HeadersInit,
): Response {
  return json(
    {
      error: code,
      error_description: formatOAuthErrorDescription(description),
    },
    { status, headers },
  );
}

/** 認可をクライアントからやり直す操作。コードやトークンを取得し直す失敗で共通に使う */
export const RESTART_AUTHORIZATION =
  "Restart the authorization from the MCP client to obtain a new authorization code.";
