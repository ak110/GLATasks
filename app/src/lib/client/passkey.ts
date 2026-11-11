import {
  browserSupportsWebAuthn,
  WebAuthnError,
} from "@simplewebauthn/browser";
import type { z } from "zod";
import type { PublicPasskeySchema } from "#lib/passkey-schemas.ts";
import type { publicPasskey } from "#lib/server/api/passkey-public.ts";

export function requireWebAuthn() {
  if (!browserSupportsWebAuthn())
    throw new Error(
      "このブラウザーはパスキーに対応していません。対応ブラウザーで開くか、パスワードでログインしてください。",
    );
}
export function passkeyError(error: unknown) {
  if (error instanceof WebAuthnError) {
    if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED")
      return "この認証器には既にパスキーがあります。別の端末・セキュリティキー・パスワードマネージャーを選んでください。";
    return "パスキー操作が取り消されたか、この環境では実行できません。開始ボタンからやり直すか、別の対応ブラウザー・端末で開いてください。";
  }
  if (
    error instanceof Error &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  )
    return "パスキー操作が取り消されたか、時間切れになりました。開始ボタンからやり直してください。";
  // 通信断（fetchのTypeError）と応答の解析失敗（SyntaxError）はブラウザー由来の英語の文面になり、
  // 次の操作が分からないため置き換える。tRPC経由ではこれらをcauseに持つTRPCClientErrorになる。
  // サーバーが返した案内付きのエラーはcauseを持たないため、そのまま表示する。
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  if (cause instanceof TypeError)
    return "サーバーへ接続できませんでした。通信状況を確かめてから、開始ボタンからやり直してください。";
  if (cause instanceof SyntaxError)
    return "サーバーの応答を読み取れませんでした。時間をおいてから、開始ボタンからやり直してください。";
  return error instanceof Error
    ? error.message
    : "パスキー操作に失敗しました。開始ボタンからやり直してください。";
}
export async function publicPasskeyRequest(
  input: z.infer<typeof PublicPasskeySchema>,
): Promise<Awaited<ReturnType<typeof publicPasskey>>> {
  const response = await fetch("/auth/passkey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error ?? "認証に失敗しました。操作をやり直してください。",
    );
  return result;
}
