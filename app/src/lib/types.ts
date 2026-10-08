/** @fileoverview 画面で使うAPI由来の型と楽観更新の型。 */

import type { RouterOutputs } from "#lib/client/trpc.ts";

export { TAG_COLOR_KEYS } from "./schemas";
export type { TagColorKey, TagInfo, TaskKind } from "./schemas";

export type ListInfo = RouterOutputs["lists"]["list"][number];
export type GetTasksResult = RouterOutputs["tasks"]["list"];
export type TaskInfo = Extract<GetTasksResult, { status: 200 }>["data"][number];
export type AttachmentMeta = TaskInfo["attachments"][number];
export type SearchTaskResult = RouterOutputs["tasks"]["search"][number];
export type GetActiveTasksResult = RouterOutputs["tasks"]["listActive"];
/** 楽観追加後もDOMの識別子を保つ、画面だけのキー。 */
export type TaskListItem = GetActiveTasksResult["tasks"][number] & {
  _key: number;
};
export type TimersResult = RouterOutputs["timers"]["list"];
export type TimerInfo = TimersResult["timers"][number];
export type ScheduleInfo = RouterOutputs["schedules"]["list"][number];
