/**
 * @fileoverview attachmentsルーターのSSE通知を検証する単体テスト
 *
 * DB接続を排除するため、API関数（`$lib/server/api`）とSSE送信（`$lib/server/sse`）を
 * モック化し、`createCaller`で組み立てた呼び出し元から `attachments.create`・
 * `attachments.delete` を呼び出して `sendEvent` の呼び出し引数を確認する。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";

import { SSE_EVENTS } from "$lib/sse-events";

vi.mock("$lib/server/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/server/api")>();
  return {
    ...actual,
    createAttachment: vi.fn().mockResolvedValue({ attachmentId: 1 }),
    deleteAttachment: vi.fn().mockResolvedValue(undefined),
    getCalorieItems: vi.fn().mockResolvedValue([]),
    createCalorieItem: vi.fn().mockResolvedValue(undefined),
    getCalorieRecords: vi
      .fn()
      .mockResolvedValue({ records: [], window_offset: 0 }),
    getCalorieSummary: vi.fn().mockResolvedValue({
      goal_kcal: 1615,
      periods: [],
    }),
  };
});

vi.mock("$lib/server/sse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/server/sse")>();
  return {
    ...actual,
    sendEvent: vi.fn(),
  };
});

vi.mock("$lib/server/crypto", () => ({
  encryptObject: vi
    .fn()
    .mockImplementation(async (data: unknown) => JSON.stringify(data)),
  decryptToString: vi.fn().mockImplementation(async (s: string) => s),
}));

const { appRouter } = await import("./trpc");
const { createAttachment, deleteAttachment } = await import("$lib/server/api");
const { createCalorieItem, getCalorieRecords } =
  await import("$lib/server/api");
const { sendEvent } = await import("$lib/server/sse");

/** 認証済み利用者を模したtRPCコンテキストを組み立てる */
function makeCtx(userId: number, tabId: string | null) {
  return {
    userId,
    tabId,
    encryptKey: "test-encrypt-key",
    event: {} as RequestEvent,
  };
}

describe("attachmentsルーターのSSE通知", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createで対象userIdへtasksUpdatedイベントが送出される", async () => {
    const caller = appRouter.createCaller(makeCtx(42, "tab-1"));

    await caller.attachments.create({
      taskId: 1,
      filename: "memo.txt",
      mimeType: "text/plain",
      data: "aGVsbG8=",
    });

    expect(createAttachment).toHaveBeenCalledWith({
      userId: 42,
      taskId: 1,
      filename: "memo.txt",
      mimeType: "text/plain",
      data: "aGVsbG8=",
    });
    expect(sendEvent).toHaveBeenCalledWith(
      42,
      SSE_EVENTS.tasksUpdated,
      "tab-1",
    );
  });

  it("deleteで対象userIdへtasksUpdatedイベントが送出される", async () => {
    const caller = appRouter.createCaller(makeCtx(7, null));

    await caller.attachments.delete({ attachmentId: 5 });

    expect(deleteAttachment).toHaveBeenCalledWith({
      userId: 7,
      attachmentId: 5,
    });
    expect(sendEvent).toHaveBeenCalledWith(7, SSE_EVENTS.tasksUpdated, null);
  });
});

describe("withApiErrorsのエラーマッピング", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attachment_too_largeがBAD_REQUESTへマッピングされる", async () => {
    vi.mocked(createAttachment).mockRejectedValueOnce(
      new Error("attachment_too_large"),
    );
    const caller = appRouter.createCaller(makeCtx(42, "tab-1"));

    const result = caller.attachments.create({
      taskId: 1,
      filename: "large.bin",
      mimeType: "application/octet-stream",
      data: "aGVsbG8=",
    });

    await expect(result).rejects.toThrow("ファイルサイズが上限を超えています");
    await expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("caloriesルーター", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("30日窓入力をAPIへ渡し、caloriesUpdatedを送出する", async () => {
    const caller = appRouter.createCaller(makeCtx(42, "tab-calorie"));

    await caller.calories.records({
      window_offset: 2,
      tz_offset_minutes: 540,
    });
    await caller.calories.createItem({
      name: "食品",
      kcal: 100,
      note: "備考",
    });

    expect(getCalorieRecords).toHaveBeenCalledWith(42, {
      window_offset: 2,
      tz_offset_minutes: 540,
    });
    expect(createCalorieItem).toHaveBeenCalledWith(42, {
      name: "食品",
      kcal: 100,
      note: "備考",
    });
    expect(sendEvent).toHaveBeenCalledWith(
      42,
      SSE_EVENTS.caloriesUpdated,
      "tab-calorie",
    );
  });

  it("品目名衝突をBAD_REQUESTへ変換する", async () => {
    vi.mocked(createCalorieItem).mockRejectedValueOnce(
      new Error("calorie_item_name_conflict"),
    );
    const caller = appRouter.createCaller(makeCtx(42, null));

    const result = caller.calories.createItem({
      name: "食品",
      kcal: 100,
      note: "",
    });

    await expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(result).rejects.toThrow("同じ名前の品目が既にあります");
  });
});
