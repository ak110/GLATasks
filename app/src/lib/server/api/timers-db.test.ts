import { afterAll, afterEach, expect, it, vi } from "vitest";
import {
  createFixtureUser,
  cleanupFixtures,
  describeDb,
} from "../db-test-helpers.ts";
import {
  createTimer,
  listTimers,
  startTimer,
  pauseTimer,
  resetTimer,
  adjustTimer,
  stopTimer,
  setTimerTime,
  updateTimer,
} from "./timers.ts";

describeDb("タイマーAPIの状態遷移", () => {
  const userIds: number[] = [];
  afterEach(() => vi.useRealTimers());
  afterAll(async () => cleanupFixtures(userIds));

  it("停止・実行・満了を経て再開した実行を古い停止要求から保護する", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createTimer({
      userId,
      name: "遷移試験",
      mode: "countdown",
      baseSeconds: 120,
      adjustMinutes: 1,
      ringSeconds: 1,
      ephemeral: false,
    });
    const initial = (await listTimers(userId)).timers[0];
    await startTimer(userId, initial.id);
    const first = (await listTimers(userId)).timers[0];
    expect(first.running).toBe(true);
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    await pauseTimer(userId, initial.id);
    expect((await listTimers(userId)).timers[0]).toMatchObject({
      running: false,
      expired: false,
      remainingSeconds: 90,
      startedAt: null,
    });
    await resetTimer(userId, initial.id);
    await startTimer(userId, initial.id);
    const second = (await listTimers(userId)).timers[0];
    expect(second.startedAt).not.toBe(first.startedAt);
    await stopTimer(userId, initial.id, first.startedAt);
    expect((await listTimers(userId)).timers[0]).toMatchObject({
      running: true,
      expired: false,
      startedAt: second.startedAt,
    });
    await expect(
      updateTimer(userId, initial.id, {
        mode: "alarm",
        targetMinutes: 60,
        tzOffsetMinutes: 0,
      }),
    ).rejects.toThrow("timer_is_running");
    await expect(setTimerTime(userId, initial.id, 60)).rejects.toThrow(
      "timer_is_running",
    );
    await adjustTimer(userId, initial.id, 1);
    expect((await listTimers(userId)).timers[0].remainingSeconds).toBe(180);
    vi.setSystemTime(new Date("2026-01-01T00:03:30Z"));
    expect((await listTimers(userId)).timers[0]).toMatchObject({
      running: false,
      expired: true,
      remainingSeconds: 0,
      startedAt: null,
    });
    await setTimerTime(userId, initial.id, 60);
    expect((await listTimers(userId)).timers[0]).toMatchObject({
      running: false,
      expired: false,
      remainingSeconds: 60,
    });
  });
});
