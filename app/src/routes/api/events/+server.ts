/**
 * @fileoverview SSE エンドポイント（リアルタイム通知用）
 *
 * Cookie 認証済みユーザーに対して SSE 接続を提供する。
 * mutation 完了時にイベント種別（lists:updated 等）のみを配信する。
 *
 * 再接続時はリクエストの `Last-Event-ID` ヘッダー（EventSource 自動再接続）
 * または URL クエリーパラメータ `lastEventId`（明示再接続）を読み取り、
 * `replayEvents()` でサーバー側バッファから差分をcatchupする。
 * 両方が提供された場合はヘッダーを優先する。
 */

import type { RequestHandler } from "./$types";
import { addConnection, removeConnection, replayEvents } from "$lib/server/sse";

export const GET: RequestHandler = async ({ locals, request, url }) => {
  const userId = locals.user_id;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const lastEventId = parseLastEventId(
    request.headers.get("Last-Event-ID"),
    url.searchParams.get("lastEventId"),
  );

  let savedController: ReadableStreamDefaultController | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      savedController = controller;
      addConnection(userId, controller);
      if (lastEventId !== null) {
        // 差分catchup: バッファ外れの場合は `reset` イベントが送信される
        replayEvents(userId, lastEventId, controller);
      } else {
        // 初回接続: 既存挙動を維持し connected で全 invalidate を促す
        controller.enqueue(
          new TextEncoder().encode(`event: connected\ndata: ${Date.now()}\n\n`),
        );
      }
      // 30秒間隔でハートビートイベントを送出する
      // 設計は docs/development/architecture.md のリアルタイム同期節を参照
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(
              `event: heartbeat\ndata: ${Date.now()}\n\n`,
            ),
          );
        } catch {
          /* closed */
        }
      }, 30_000);
    },
    cancel() {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (savedController) removeConnection(userId, savedController);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
};

/** Last-Event-ID をヘッダー優先で数値解釈する。無効値や負数は null とする */
function parseLastEventId(
  headerValue: string | null,
  queryValue: string | null,
): number | null {
  const raw = headerValue ?? queryValue;
  if (raw === null || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}
