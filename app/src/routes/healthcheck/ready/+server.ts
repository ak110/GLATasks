/** DB接続と定期処理の健全性を確認する運用監視用エンドポイント。 */
import { json } from "@sveltejs/kit";
import { sql } from "drizzle-orm";
import { getDb } from "#lib/server/db.ts";
import { getSchedulerHealth } from "#lib/server/scheduler.ts";

/** 不健全な応答で返す、状態ごとの次の操作。運用者がホストで実行する確認先を示す */
const DATABASE_ERROR_ACTION =
  "DBが2秒以内に応答しません。make psでdbコンテナーの稼働を、make logsでdbのログを確認してください。";
const SCHEDULER_ACTIONS = {
  ok: undefined,
  starting:
    "起動後の定期処理がまだ完了していません。2分後に再確認し、続く場合はmake logs-appで[scheduler]の行を確認してください。",
  error:
    "直前の定期処理が失敗しました。make logs-appで[scheduler]の行の失敗した予定と例外を確認してください。次の周期で再試行します。",
  stale:
    "定期処理が2周期を超えて実行されていません。make logs-appで[scheduler]の行を確認し、止まっている場合はmake restart-appでアプリを再起動してください。",
} as const;

export async function GET() {
  let database: "ok" | "error" = "ok";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`SELECT 1`),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("DB確認の時間切れ")), 2000);
      }),
    ]);
  } catch {
    database = "error";
  } finally {
    clearTimeout(timeout);
  }
  const scheduler = getSchedulerHealth();
  const healthy = database === "ok" && scheduler.status === "ok";
  const nextAction = healthy
    ? undefined
    : database === "error"
      ? DATABASE_ERROR_ACTION
      : SCHEDULER_ACTIONS[scheduler.status];
  return json(
    {
      status: healthy ? "ok" : "error",
      database,
      scheduler,
      ...(nextAction ? { next_action: nextAction } : {}),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
