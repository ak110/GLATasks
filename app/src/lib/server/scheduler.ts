import { eq } from "drizzle-orm";
import { rrulestr } from "rrule";
import { SCHEDULE_TIMEZONE } from "#lib/date-time.ts";

import { getDb } from "./db";
import { processInterval, processState } from "./process-state";
import { lists, schedules } from "./schema";
import { processCalorieAutoRecords } from "./calorie-scheduler";
import { parseTags } from "./api/common";
import { createTask } from "./api/tasks";
import {
  notifyScheduleExecution,
  notifyCalorieExecution,
} from "./operations/scheduler";

const POLL_INTERVAL_MS = 60 * 1000;

const FILL_FORWARD_LIMIT = 30;

interface SchedulerState {
  started: boolean;
  processing: boolean;
  lastSuccessAt: Date | undefined;
  lastFinishedAt: Date | undefined;
  lastRunFailed: boolean;
}

const state = processState<SchedulerState>("scheduler", () => ({
  started: false,
  processing: false,
  lastSuccessAt: undefined,
  lastFinishedAt: undefined,
  lastRunFailed: false,
}));

const poll = processInterval("scheduler.poll", POLL_INTERVAL_MS, () => {
  void tick();
});

export function getSchedulerHealth(now = new Date()) {
  const { lastSuccessAt, lastFinishedAt, lastRunFailed } = state;
  let status: "ok" | "starting" | "error" | "stale";
  if (lastRunFailed) {
    status = "error";
  } else if (!lastSuccessAt) {
    status = "starting";
  } else {
    status =
      now.getTime() - lastSuccessAt.getTime() > POLL_INTERVAL_MS * 2
        ? "stale"
        : "ok";
  }
  return {
    status,
    last_success_at: lastSuccessAt?.toISOString() ?? null,
    last_finished_at: lastFinishedAt?.toISOString() ?? null,
  };
}

function collectDueOccurrences(
  rrule: string,
  after: Date,
  now: Date,
  includeAfterBoundary: boolean,
): Date[] {
  const rule = rrulestr(rrule, { tzid: SCHEDULE_TIMEZONE });
  const occurrences: Date[] = [];
  rule.between(toRRuleDate(after), toRRuleDate(now), true, (rruleDate) => {
    const date = fromRRuleDate(rruleDate);
    if (!includeAfterBoundary && date.getTime() === after.getTime()) {
      return true;
    }
    occurrences.push(date);
    return occurrences.length < FILL_FORWARD_LIMIT;
  });
  return occurrences;
}

/**
 * 真の時刻を、rruleへ渡す境界の表現へ変換する。
 *
 * rruleは`tzid`を指定すると、プロセスの時刻帯の壁時計の時刻をUTCの成分に持つ日時で
 * 境界を受け取り、結果も同じ表現で返す（rruleのREADME「Important: Use UTC dates」）。
 * 本番イメージは`TZ=Asia/Tokyo`で動くため、変換しないと発火予定が時差の分だけずれる。
 * プロセスの時刻帯がUTCなら値は変わらない。
 */
function toRRuleDate(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds(),
    ),
  );
}

function fromRRuleDate(date: Date): Date {
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}

export async function processSchedules(now: Date): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ schedule: schedules, userId: lists.user_id })
    .from(schedules)
    .innerJoin(lists, eq(schedules.list_id, lists.id))
    .where(eq(schedules.enabled, 1));

  let succeeded = true;
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
      const rule = rrulestr(schedule.rrule, { tzid: SCHEDULE_TIMEZONE });
      const lastRRuleDate = rule.before(toRRuleDate(now), true);
      const lastOccurrence = lastRRuleDate && fromRRuleDate(lastRRuleDate);
      await db.transaction(async (tx) => {
        for (const _occurrence of occurrences) {
          await createTask(
            userId,
            schedule.list_id,
            schedule.title,
            tagList,
            "todo",
            tx,
          );
        }
        await tx
          .update(schedules)
          .set({ last_fired: lastOccurrence ?? now, updated: now })
          .where(eq(schedules.id, schedule.id));
      });

      notifyScheduleExecution(userId);
    } catch (error) {
      succeeded = false;
      console.error(
        `[scheduler] スケジュール ${schedule.id} の処理に失敗しました。他の予定の処理は続け、この予定は次の周期で再試行します。続く例外と、この予定のrruleとDBの状態を確認してください`,
        error,
      );
    }
  }
  return succeeded;
}

async function tick(): Promise<void> {
  if (state.processing) return;
  state.processing = true;
  try {
    const now = new Date();
    const schedulesSucceeded = await processSchedules(now);
    const caloriesResult = await processCalorieAutoRecords(now);
    for (const userId of caloriesResult.userIds) {
      notifyCalorieExecution(userId);
    }
    state.lastRunFailed = !schedulesSucceeded || !caloriesResult.succeeded;
    if (!state.lastRunFailed) state.lastSuccessAt = new Date();
  } catch (error) {
    state.lastRunFailed = true;
    console.error(
      "[scheduler] 定期処理に失敗しました。DB接続と直前のログを確認してください。次の周期で再試行します。",
      error,
    );
  } finally {
    state.lastFinishedAt = new Date();
    state.processing = false;
  }
}

export function startScheduler(): void {
  if (state.started) return;
  state.started = true;
  void tick();
  poll.start();
}

export function stopScheduler(): void {
  poll.stop();
  state.started = false;
}
