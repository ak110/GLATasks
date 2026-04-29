/**
 * @fileoverview サーバーAPI再エクスポートバレル
 *
 * 呼び出し側（trpc.ts 等）の import パスを維持するための再エクスポートのみを含む。
 * 実装は api/ 配下の各ドメインファイルに分割されている。
 */

export type { UserInfo } from "./api/auth";
export { validateCredentials, registerUser } from "./api/auth";

export type { ListInfo } from "./api/lists";
export {
  getLists,
  postList,
  clearList,
  renameList,
  deleteList,
  archiveList,
  mergeLists,
  unarchiveList,
} from "./api/lists";

export type {
  TagInfo,
  TaskInfo,
  SearchTaskResult,
  GetTasksResult,
} from "./api/tasks";
export {
  getListTasks,
  postTask,
  patchTask,
  searchTasks,
  reorderTasks,
} from "./api/tasks";

export {
  getTimers,
  createTimer,
  updateTimer,
  deleteTimer,
  startTimer,
  pauseTimer,
  resetTimer,
  adjustTimer,
  stopTimer,
  setTimerTime,
  reorderTimers,
} from "./api/timers";

export { getUserPreferences, updateUserPreferences } from "./api/users";
