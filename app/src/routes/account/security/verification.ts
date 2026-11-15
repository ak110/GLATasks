import type { RouterInputs } from "#lib/client/trpc.ts";

type ManageInput = RouterInputs["security"]["manage"];

/** 期限切れ時に操作へ添える本人確認の証明（パスワードか登録済みパスキーの認証応答）。 */
export type Proof = NonNullable<
  Extract<ManageInput, { action: "codes" }>["proof"]
>;
