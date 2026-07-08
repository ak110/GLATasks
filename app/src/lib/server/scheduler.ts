/**
 * @fileoverview 定期TODOスケジューラー（起動時フィルフォワード + 定周期ポーリング）
 *
 * `hooks.server.ts` の `init` エクスポートから `startScheduler()` を呼び出し、
 * サーバー起動時に一度だけ起動する。以降は60秒間隔のポーリングで発火予定を検出し、
 * `postTask` でTODOタスクを生成する。
 *
 * 発火判定処理は `now` を引数化しており（`processSchedules`）、サーバー側vitestから
 * 任意の時刻を注入してテストできる（Playwrightの仮想時計はサーバー側の `setInterval` を
 * 制御できないため、E2Eではなくサーバー側vitestで検証する設計とした）。
 */

import { eq } from "drizzle-orm";
import { rrulestr } from "rrule";

import { getDb } from "./db";
import { lists, schedules } from "./schema";
import { parseTags } from "./api/common";
import { postTask } from "./api/tasks";
import { sendEvent } from "./sse";
import { SSE_EVENTS } from "$lib/sse-events";

/** ポーリング間隔（ミリ秒） */
const POLL_INTERVAL_MS = 60 * 1000;

/**
 * 1回のフィルフォワードで生成するタスクの上限件数。
 *
 * 長期未発火の日次スケジュールでも全発火予定を配列化せず、`rrule` の `between()` の
 * iterator経路で先頭 `FILL_FORWARD_LIMIT` 件のみをメモリ上に保持する。
 * 上限を超える分はスキップされ、次回検出されない（重複可・上限超過分は生成されない
 * というユーザー選好の許容範囲内）。
 */
const FILL_FORWARD_LIMIT = 30;

/** 同一プロセス内の起動済みフラグ。二重に `init` が呼ばれても多重登録しない。 */
let started = false;

/** 実行中の1tickが完了する前に次のtickが開始しないようにする再入防止フラグ */
let processing = false;

/**
 * 指定スケジュールの `after` 以降 `now` 以前の発火予定を、先頭 `FILL_FORWARD_LIMIT`
 * 件までiterator経路で収集する。
 *
 * 上限境界（`now`）は常に含める。ちょうど現在時刻に一致する発火予定を次回tickまで
 * 待たせず即座に発火させるためであり、`processSchedules` 側で `last_fired` を
 * 計算する `rule.before(now, true)`（inclusive）とも整合させる。
 *
 * 下限境界（`after`）は呼び出し元の状態で意味が異なるため `includeAfterBoundary` で
 * 明示的に切り替える。
 *
 * - 初回チェック（`last_fired` が未設定で `after` にはスケジュール作成日時が渡る）:
 *   作成日時ちょうどに発火予定が重なる場合も未発火として扱うため境界を含める
 * - 2回目以降（`after` には直前の `last_fired` が渡る）:
 *   `last_fired` の値自体は前回既に発火済みの発火予定であるため境界を除外し、
 *   同一発火予定への重複発火を防ぐ
 */
function collectDueOccurrences(
  rrule: string,
  after: Date,
  now: Date,
  includeAfterBoundary: boolean,
): Date[] {
  const rule = rrulestr(rrule, { tzid: "Asia/Tokyo" });
  const occurrences: Date[] = [];
  rule.between(after, now, true, (date) => {
    if (!includeAfterBoundary && date.getTime() === after.getTime()) {
      return true;
    }
    occurrences.push(date);
    return occurrences.length < FILL_FORWARD_LIMIT;
  });
  return occurrences;
}

/**
 * 発火・フィルフォワード・重複防止のロジック本体。
 *
 * `schedules` と `lists` をJOINして `enabled` な全スケジュールと対象リストの
 * `user_id` を取得し、各スケジュールを個別の `try/catch` で処理する。
 * 不正な `rrule` など1件の処理失敗が他スケジュールの処理を止めないようにする。
 *
 * 複数プロセスワーカー構成への拡張時の注意: 現行のDocker Compose構成は
 * アプリケーションサーバーが単一プロセスであるため、本関数は同時に1プロセスからのみ
 * 呼び出される前提で動作する。複数プロセス化する場合、同一スケジュールへの並行発火は
 * `list.user_id` と `last_fired` の更新競合により重複タスク生成が起こり得るが、
 * これは上記フィルフォワード上限と同様に「重複可」の許容範囲に収まる。
 */
export async function processSchedules(now: Date): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ schedule: schedules, userId: lists.user_id })
    .from(schedules)
    .innerJoin(lists, eq(schedules.list_id, lists.id))
    .where(eq(schedules.enabled, 1));

  for (const { schedule, userId } of rows) {
    try {
      const after = schedule.last_fired ?? schedule.created;
      const occurrences = collectDueOccurrences(
        schedule.rrule,
        after,
        now,
        schedule.last_fired === null,
      );
      if (occurrences.length === 0) continue;

      const tagList = parseTags(schedule.tags);
      for (const _occurrence of occurrences) {
        await postTask(
          userId,
          schedule.list_id,
          schedule.title,
          tagList,
          "todo",
        );
      }

      // last_fired は収集済みiteratorの打ち切り結果ではなく、rule.before(now, true) で
      // 現在時刻以前の直近の発火予定を求め直す。これにより次回tickでの再検出（二重発火）を防ぐ。
      const rule = rrulestr(schedule.rrule, { tzid: "Asia/Tokyo" });
      const lastOccurrence = rule.before(now, true);
      await db
        .update(schedules)
        .set({ last_fired: lastOccurrence ?? now, updated: now })
        .where(eq(schedules.id, schedule.id));

      sendEvent(userId, SSE_EVENTS.tasksUpdated);
      sendEvent(userId, SSE_EVENTS.schedulesUpdated);
    } catch (error) {
      console.error(
        `[scheduler] スケジュール ${schedule.id} の処理に失敗しました`,
        error,
      );
    }
  }
}

/** 再入防止しつつ `processSchedules` を1tick分実行する */
async function tick(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    await processSchedules(new Date());
  } finally {
    processing = false;
  }
}

/**
 * スケジューラーを起動する。
 *
 * 即時に1tick実行（起動時フィルフォワード）したのち、60秒間隔でポーリングを繰り返す。
 * 同一プロセス内での多重起動を防ぐため、起動済みフラグを持つ。
 */
export function startScheduler(): void {
  if (started) return;
  started = true;
  void tick();
  setInterval(() => void tick(), POLL_INTERVAL_MS);
}
