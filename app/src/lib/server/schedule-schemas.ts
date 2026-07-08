/**
 * @fileoverview 定期TODOスケジュール操作のZodスキーマ定義
 *
 * `rrule`（RFC5545パーサー）はCJSモジュールでありnamed exportの解決がNode実行系
 * （Vite変換を経ないPlaywright e2eテスト実行系など）に依存する。`$lib/schemas.ts`
 * は `attachment.test.ts` から直接importされVite変換を経ずにNodeへ読み込まれるため、
 * 当該ファイルへ `rrule` への依存を持ち込むと読み込みに失敗する。
 * 本ファイルはサーバー側実装（`trpc.ts`・`api/schedules.ts`）専用とし、
 * Vite SSR経由でのみ読み込まれる前提を維持することでこの制約を切り分ける。
 */

import { z } from "zod";
import { rrulestr } from "rrule";
import { TagsSchema } from "$lib/schemas";

/** RFC5545構文としての妥当性を検証する（Asia/Tokyo基準で復元できるかを確認する） */
const RruleStringSchema = z.string().refine(
  (v) => {
    try {
      rrulestr(v, { tzid: "Asia/Tokyo" });
      return true;
    } catch {
      return false;
    }
  },
  { message: "invalid RRULE" },
);

export const CreateScheduleSchema = z.object({
  listId: z.number().int().positive(),
  title: z.string().min(1, "タイトルは必須です").max(255),
  tags: TagsSchema.optional(),
  rrule: RruleStringSchema,
});

export const UpdateScheduleSchema = z
  .object({
    scheduleId: z.number().int().positive(),
    title: z.string().min(1, "タイトルは必須です").max(255).optional(),
    tags: TagsSchema.optional(),
    rrule: RruleStringSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.tags !== undefined ||
      data.rrule !== undefined ||
      data.enabled !== undefined,
    { message: "更新する項目が指定されていません" },
  );

export const DeleteScheduleSchema = z.object({
  scheduleId: z.number().int().positive(),
});

export const ListSchedulesSchema = z.object({
  listId: z.number().int().positive(),
});

export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;
export type DeleteScheduleInput = z.infer<typeof DeleteScheduleSchema>;
export type ListSchedulesInput = z.infer<typeof ListSchedulesSchema>;
