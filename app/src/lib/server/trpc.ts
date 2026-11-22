import { initTRPC, TRPCError } from "@trpc/server";
import type { Cookies } from "@sveltejs/kit";
import { ManageSecuritySchema } from "#lib/passkey-schemas.ts";
import { security } from "./operations/security";
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
  ListTaskPageSchema,
  FindArchivePageSchema,
  SearchTaskPageSchema,
  ReorderArchivePageSchema,
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

interface Context {
  cookies?: Cookies;
  userId: number | null;
  tabId: string | null;
}

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

const withEncryption = t.middleware(async ({ getRawInput, next }) => {
  const rawInput = await getRawInput();

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

  const result = await next({
    getRawInput: async () => decryptedInput,
  });

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

function assignEncryptedData(
  result: unknown,
  data: { encrypted: string },
): void {
  (result as unknown as Record<string, unknown>).data = data;
}

const protectedProcedure = t.procedure.use(isAuthed).use(withApiErrors);
const encryptedProcedure = protectedProcedure.use(withEncryption);

export const appRouter = t.router({
  security: t.router({
    list: encryptedProcedure.query(({ ctx }) => security.list(ctx)),
    beginVerification: encryptedProcedure.mutation(({ ctx }) =>
      security.beginVerification(ctx),
    ),
    manage: encryptedProcedure
      .input(ManageSecuritySchema)
      .mutation(({ ctx, input }) => security.manage(ctx, input)),
  }),
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

  tasks: t.router({
    list: encryptedProcedure
      .input(GetListTasksSchema)
      .query(({ ctx, input }) => operations.tasks.list(ctx, input)),

    archiveTagCandidates: encryptedProcedure
      .input(GetListTasksSchema.pick({ listId: true }))
      .query(({ ctx, input }) =>
        operations.tasks.archiveTagCandidates(ctx, input),
      ),

    listPage: encryptedProcedure
      .input(ListTaskPageSchema)
      .query(({ ctx, input }) => operations.tasks.listPage(ctx, input)),

    findArchivePage: encryptedProcedure
      .input(FindArchivePageSchema)
      .query(({ ctx, input }) => operations.tasks.findArchivePage(ctx, input)),

    searchPage: encryptedProcedure
      .input(SearchTaskPageSchema)
      .query(({ ctx, input }) => operations.tasks.searchPage(ctx, input)),

    reorderArchivePage: encryptedProcedure
      .input(ReorderArchivePageSchema)
      .mutation(({ ctx, input }) =>
        operations.tasks.reorderArchivePage(ctx, input),
      ),

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
