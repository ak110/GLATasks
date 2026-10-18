import { getEncryptKey } from "#lib/server/env.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url }) => {
  // パスを参照すると、SvelteKitは画面遷移のたびにこのloadを再実行してデータ応答を返す。
  // データ応答の`x-sveltekit-version`で、`version.json`の定期確認を待たず遷移時にも新版を検知できる。
  // 開発サーバーは定期確認を行わないため、更新案内を表示させる経路はこの応答だけである。
  void url.pathname;
  if (!locals.user_id) return {};

  return {
    encrypt_key: getEncryptKey(),
    logged_in: true,
  };
};
