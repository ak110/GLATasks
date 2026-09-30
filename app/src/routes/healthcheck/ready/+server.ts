/** DB接続と定期処理の健全性を確認する運用監視用エンドポイント。 */
import { json } from "@sveltejs/kit";
import { sql } from "drizzle-orm";
import { getDb } from "$lib/server/db";
import { getSchedulerHealth } from "$lib/server/scheduler";

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
  return json(
    { status: healthy ? "ok" : "error", database, scheduler },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
