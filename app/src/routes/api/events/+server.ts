/**
 * @fileoverview SSE エンドポイント（リアルタイム通知用）
 *
 * Cookie 認証済みユーザーに対して SSE 接続を提供する。
 * mutation 完了時にイベント種別（lists:updated 等）のみを配信する。
 */

import type { RequestHandler } from "./$types";
import { addConnection, removeConnection } from "$lib/server/sse";

export const GET: RequestHandler = async ({ locals }) => {
  const userId = locals.user_id;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  let savedController: ReadableStreamDefaultController | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      savedController = controller;
      addConnection(userId, controller);
      // 接続確立を通知（暫定オフセット計算用にサーバー時刻を含む）
      controller.enqueue(
        new TextEncoder().encode(`event: connected\ndata: ${Date.now()}\n\n`),
      );
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
