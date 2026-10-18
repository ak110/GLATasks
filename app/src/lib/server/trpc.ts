/**
 * @fileoverview tRPC ルーター定義と暗号化ミドルウェア
 */

import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { ApiError, getPublicError } from "./api-errors";
import {
  CreateAttachmentSchema,
  CreateListSchema,
  CreateTaskSchema,
  CreateTimerSchema,
  DeleteAttachmentSchema,
  DownloadAttachmentSchema,
  GetActiveTasksSchema,
  GetListTasksSchema,
  MergeListSchema,
  ShowTypeSchema,
  UpdateListSchema,
  UpdateTaskSchema,
  UpdateTimerSchema,
  TimerIdSchema,
  TimerStopSchema,
  AdjustTimerSchema,
  SetTimerTimeSchema,
  StartTimerSchema,
  ResetTimerSchema,
  SearchTasksSchema,
  ReorderTasksSchema,
  ReorderTimersSchema,
  UserPreferencesSchema,
  CreateCalorieItemSchema,
  UpdateCalorieItemSchema,
  CalorieItemIdSchema,
  CreateCalorieRecordSchema,
  UpdateCalorieRecordSchema,
  CalorieRecordIdSchema,
  ListCalorieRecordsSchema,
  GetCalorieSummarySchema,
  ImportCalorieItemsSchema,
  ImportCalorieRecordsSchema,
  BulkCreateCalorieRecordsSchema,
  BulkDeleteCalorieRecordsSchema,
  CreateCalorieAutoRecordSchema,
  UpdateCalorieAutoRecordSchema,
  CalorieAutoRecordIdSchema,
} from "#lib/schemas.ts";
import {
  CreateScheduleSchema,
  DeleteScheduleSchema,
  ListSchedulesSchema,
  UpdateScheduleSchema,
} from "./schedule-schemas";
import * as operations from "./operations";
import { decryptToString, encryptObject } from "./crypto";

// ── Context 型定義 ──

interface Context {
  userId: number | null;
  tabId: string | null;
}

// ── tRPC 初期化 ──

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const validationIssues =
      error.cause instanceof ZodError ? error.cause.issues : null;
    return {
      ...shape,
      message: validationIssues
        ? "入力内容が不正です。data.validationIssuesの各項目が示す値を直して送り直してください"
        : shape.message,
      data: { ...shape.data, validationIssues },
    };
  },
});

// ── ミドルウェア ──

/**
 * 認証必須ミドルウェア
 */
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "ログインが必要です。/auth/loginでログインしてから操作をやり直してください",
    });
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
    },
  });
});

/**
 * 暗号化ミドルウェア: 入力を復号化し、出力を暗号化する
 */
const withEncryption = t.middleware(async ({ getRawInput, next }) => {
  // getRawInput() で生の入力を取得（tRPC v11 API）
  const rawInput = await getRawInput();

  // 入力が暗号化されている場合は復号化
  let decryptedInput = rawInput;
  if (
    typeof rawInput === "object" &&
    rawInput !== null &&
    "encrypted" in rawInput &&
    typeof (rawInput as Record<string, unknown>).encrypted === "string"
  ) {
    try {
      const decryptedStr = await decryptToString(
        (rawInput as Record<string, unknown>).encrypted as string,
      );
      decryptedInput = JSON.parse(decryptedStr);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "送信内容を復号できませんでした。サーバーの暗号鍵が変わった可能性があります。ページを再読み込みして暗号鍵を取得し直し、操作をやり直してください",
        cause: error,
      });
    }
  }

  // 次のミドルウェア/プロシージャを実行（復号化した入力を渡す）
  const result = await next({
    getRawInput: async () => decryptedInput,
  });

  // 出力を暗号化して返す（result を直接変更し型推論を保持する）
  if (result.ok) {
    assignEncryptedData(result, {
      encrypted: await encryptObject(result.data),
    });
  }

  return result;
});

const withApiErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (
    !result.ok &&
    (result.error.cause instanceof ApiError ||
      result.error.code === "INTERNAL_SERVER_ERROR")
  ) {
    const mapped = getPublicError(result.error.cause ?? result.error);
    throw new TRPCError({
      code: mapped.code,
      message: mapped.message,
      cause: result.error.cause,
    });
  }
  return result;
});

// ── ヘルパー関数 ──

/**
 * `withEncryption` ミドルウェアがハンドラーの平文 `data` フィールドを暗号化済みの値で上書きするためのヘルパー。
 *
 * なぜこの上書きが必要か:
 *   `withEncryption` ミドルウェアは、ハンドラーが返した平文の `data` フィールドを
 *   暗号化後の値（`{ encrypted: string }` 形式）で置き換えてクライアントへ返す必要がある。
 *
 * なぜキャストが必要か:
 *   tRPC の内部結果型（`TRPCResultMessage` 等）は `unknown` 扱いであり、
 *   Drizzle/Zod から推論されるハンドラーの戻り値型と直接合わない。
 *   型推論を壊さずに `data` フィールドだけを差し替えるため、二重キャストでアクセスする。
 *
 * 制約:
 *   呼び出し側（`withEncryption` ミドルウェア）は、`result` が `{ data: <平文の値> }` 形式であることを
 *   ミドルウェアの位置（`result.ok` チェック後）で保証している。
 */
function assignEncryptedData(
  result: unknown,
  data: { encrypted: string },
): void {
  (result as unknown as Record<string, unknown>).data = data;
}

// ── プロシージャ定義 ──

const protectedProcedure = t.procedure.use(isAuthed).use(withApiErrors);
const encryptedProcedure = protectedProcedure.use(withEncryption);

// ── ルーター定義 ──

export const appRouter = t.router({
  // ── 利用者設定 ──
  users: t.router({
    getPreferences: encryptedProcedure.query(({ ctx }) =>
      operations.users.getPreferences(ctx),
    ),

    updatePreferences: encryptedProcedure
      .input(UserPreferencesSchema)
      .mutation(({ ctx, input }) =>
        operations.users.updatePreferences(ctx, input),
      ),
  }),

  // ── カロリー計算 ──
  calories: t.router({
    items: encryptedProcedure.query(({ ctx }) =>
      operations.calories.items(ctx),
    ),

    createItem: encryptedProcedure
      .input(CreateCalorieItemSchema)
      .mutation(({ ctx, input }) => operations.calories.createItem(ctx, input)),

    updateItem: encryptedProcedure
      .input(UpdateCalorieItemSchema)
      .mutation(({ ctx, input }) => operations.calories.updateItem(ctx, input)),

    deleteItem: encryptedProcedure
      .input(CalorieItemIdSchema)
      .mutation(({ ctx, input }) => operations.calories.deleteItem(ctx, input)),

    records: encryptedProcedure
      .input(ListCalorieRecordsSchema)
      .query(({ ctx, input }) => operations.calories.records(ctx, input)),

    allRecords: encryptedProcedure.query(({ ctx }) =>
      operations.calories.allRecords(ctx),
    ),

    createRecord: encryptedProcedure
      .input(CreateCalorieRecordSchema)
      .mutation(({ ctx, input }) =>
        operations.calories.createRecord(ctx, input),
      ),

    updateRecord: encryptedProcedure
      .input(UpdateCalorieRecordSchema)
      .mutation(({ ctx, input }) =>
        operations.calories.updateRecord(ctx, input),
      ),

    deleteRecord: encryptedProcedure
      .input(CalorieRecordIdSchema)
      .mutation(({ ctx, input }) =>
        operations.calories.deleteRecord(ctx, input),
      ),

    summary: encryptedProcedure
      .input(GetCalorieSummarySchema)
      .query(({ ctx, input }) => operations.calories.summary(ctx, input)),

    importItems: encryptedProcedure
      .input(ImportCalorieItemsSchema)
      .mutation(({ ctx, input }) =>
        operations.calories.importItems(ctx, input),
      ),

    importRecords: encryptedProcedure
      .input(ImportCalorieRecordsSchema)
      .mutation(({ ctx, input }) =>
        operations.calories.importRecords(ctx, input),
      ),

    bulkCreateRecords: encryptedProcedure
      .input(BulkCreateCalorieRecordsSchema)
      .mutation(({ ctx, input }) =>
        operations.calories.bulkCreateRecords(ctx, input),
      ),

    bulkDeleteRecords: encryptedProcedure
      .input(BulkDeleteCalorieRecordsSchema)
      .mutation(({ ctx, input }) =>
        operations.calories.bulkDeleteRecords(ctx, input),
      ),

    autoRecords: encryptedProcedure.query(({ ctx }) =>
      operations.calories.autoRecords(ctx),
    ),

    createAutoRecord: encryptedProcedure
      .input(CreateCalorieAutoRecordSchema)
      .mutation(({ ctx, input }) =>
        operations.calories.createAutoRecord(ctx, input),
      ),

    updateAutoRecord: encryptedProcedure
      .input(UpdateCalorieAutoRecordSchema)
      .mutation(({ ctx, input }) =>
        operations.calories.updateAutoRecord(ctx, input),
      ),

    deleteAutoRecord: encryptedProcedure
      .input(CalorieAutoRecordIdSchema)
      .mutation(({ ctx, input }) =>
        operations.calories.deleteAutoRecord(ctx, input),
      ),
  }),

  // ── リスト操作 ──
  lists: t.router({
    list: encryptedProcedure
      .input(ShowTypeSchema)
      .query(({ ctx, input }) => operations.lists.list(ctx, input)),

    create: encryptedProcedure
      .input(CreateListSchema)
      .mutation(({ ctx, input }) => operations.lists.create(ctx, input)),

    rename: encryptedProcedure
      .input(UpdateListSchema)
      .mutation(({ ctx, input }) => operations.lists.rename(ctx, input)),

    delete: encryptedProcedure
      .input(UpdateListSchema.pick({ listId: true }))
      .mutation(({ ctx, input }) => operations.lists.delete(ctx, input)),

    archive: encryptedProcedure
      .input(UpdateListSchema.pick({ listId: true }))
      .mutation(({ ctx, input }) => operations.lists.archive(ctx, input)),

    unarchive: encryptedProcedure
      .input(UpdateListSchema.pick({ listId: true }))
      .mutation(({ ctx, input }) => operations.lists.unarchive(ctx, input)),

    clear: encryptedProcedure
      .input(UpdateListSchema.pick({ listId: true }))
      .mutation(({ ctx, input }) => operations.lists.clear(ctx, input)),

    merge: encryptedProcedure
      .input(MergeListSchema)
      .mutation(({ ctx, input }) => operations.lists.merge(ctx, input)),
  }),

  // ── タスク操作 ──
  tasks: t.router({
    list: encryptedProcedure
      .input(GetListTasksSchema)
      .query(({ ctx, input }) => operations.tasks.list(ctx, input)),

    listActive: encryptedProcedure
      .input(GetActiveTasksSchema)
      .query(({ ctx, input }) => operations.tasks.listActive(ctx, input)),

    create: encryptedProcedure
      .input(CreateTaskSchema)
      .mutation(({ ctx, input }) => operations.tasks.create(ctx, input)),

    update: encryptedProcedure
      .input(UpdateTaskSchema)
      .mutation(({ ctx, input }) => operations.tasks.update(ctx, input)),

    search: encryptedProcedure
      .input(SearchTasksSchema)
      .query(({ ctx, input }) => operations.tasks.search(ctx, input)),

    reorder: encryptedProcedure
      .input(ReorderTasksSchema)
      .mutation(({ ctx, input }) => operations.tasks.reorder(ctx, input)),
  }),

  // ── 添付ファイル操作 ──
  attachments: t.router({
    create: encryptedProcedure
      .input(CreateAttachmentSchema)
      .mutation(({ ctx, input }) => operations.attachments.create(ctx, input)),

    delete: encryptedProcedure
      .input(DeleteAttachmentSchema)
      .mutation(({ ctx, input }) => operations.attachments.delete(ctx, input)),

    download: encryptedProcedure
      .input(DownloadAttachmentSchema)
      .query(({ ctx, input }) => operations.attachments.download(ctx, input)),
  }),

  // ── 定期TODOスケジュール操作 ──
  schedules: t.router({
    list: encryptedProcedure
      .input(ListSchedulesSchema)
      .query(({ ctx, input }) => operations.schedules.list(ctx, input)),

    create: encryptedProcedure
      .input(CreateScheduleSchema)
      .mutation(({ ctx, input }) => operations.schedules.create(ctx, input)),

    update: encryptedProcedure
      .input(UpdateScheduleSchema)
      .mutation(({ ctx, input }) => operations.schedules.update(ctx, input)),

    delete: encryptedProcedure
      .input(DeleteScheduleSchema)
      .mutation(({ ctx, input }) => operations.schedules.delete(ctx, input)),
  }),

  // ── タイマー操作 ──
  timers: t.router({
    list: encryptedProcedure.query(({ ctx }) => operations.timers.list(ctx)),

    reorder: encryptedProcedure
      .input(ReorderTimersSchema)
      .mutation(({ ctx, input }) => operations.timers.reorder(ctx, input)),

    create: encryptedProcedure
      .input(CreateTimerSchema)
      .mutation(({ ctx, input }) => operations.timers.create(ctx, input)),

    update: encryptedProcedure
      .input(UpdateTimerSchema)
      .mutation(({ ctx, input }) => operations.timers.update(ctx, input)),

    delete: encryptedProcedure
      .input(TimerIdSchema)
      .mutation(({ ctx, input }) => operations.timers.delete(ctx, input)),

    start: encryptedProcedure
      .input(StartTimerSchema)
      .mutation(({ ctx, input }) => operations.timers.start(ctx, input)),

    pause: encryptedProcedure
      .input(TimerIdSchema)
      .mutation(({ ctx, input }) => operations.timers.pause(ctx, input)),

    reset: encryptedProcedure
      .input(ResetTimerSchema)
      .mutation(({ ctx, input }) => operations.timers.reset(ctx, input)),

    adjust: encryptedProcedure
      .input(AdjustTimerSchema)
      .mutation(({ ctx, input }) => operations.timers.adjust(ctx, input)),

    setTime: encryptedProcedure
      .input(SetTimerTimeSchema)
      .mutation(({ ctx, input }) => operations.timers.setTime(ctx, input)),

    stop: encryptedProcedure
      .input(TimerStopSchema)
      .mutation(({ ctx, input }) => operations.timers.stop(ctx, input)),
  }),
});

export type AppRouter = typeof appRouter;
