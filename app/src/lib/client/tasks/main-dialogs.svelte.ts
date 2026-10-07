import type { TaskKind } from "#lib/schemas.ts";
import type { TagInfo } from "#lib/types.ts";

export function createMainDialogs() {
  // タスク編集ダイアログの状態
  type EditDialog = {
    open: boolean;
    listId: number;
    taskId: number;
    text: string;
    moveTo: string;
    completed: boolean;
    tags: TagInfo[];
    kind: TaskKind;
  };
  let editDialog = $state<EditDialog>({
    open: false,
    listId: 0,
    taskId: 0,
    text: "",
    moveTo: "",
    completed: false,
    tags: [],
    kind: "normal",
  });

  // 定期TODOスケジュール管理ダイアログの対象リストID（null は非表示）
  let schedulesDialogListId = $state<number | null>(null);

  // リスト統合ダイアログの状態
  type MergeDialog = {
    open: boolean;
    sourceListId: number;
    sourceTitle: string;
    taskCount: number;
  };
  let mergeDialog = $state<MergeDialog>({
    open: false,
    sourceListId: 0,
    sourceTitle: "",
    taskCount: 0,
  });

  // リスト削除確認ダイアログの状態
  type ConfirmDeleteListDialog = {
    open: boolean;
    listId: number;
  };
  let confirmDeleteListDialog = $state<ConfirmDeleteListDialog>({
    open: false,
    listId: 0,
  });

  // リストアーカイブ確認ダイアログの状態
  type ConfirmArchiveListDialog = {
    open: boolean;
    listId: number;
  };
  let confirmArchiveListDialog = $state<ConfirmArchiveListDialog>({
    open: false,
    listId: 0,
  });

  // リスト名変更入力ダイアログの状態
  type RenameListDialog = {
    open: boolean;
    listId: number;
    currentTitle: string;
  };
  let renameListDialog = $state<RenameListDialog>({
    open: false,
    listId: 0,
    currentTitle: "",
  });

  return {
    get editDialog() {
      return editDialog;
    },
    set editDialog(value: typeof editDialog) {
      editDialog = value;
    },
    get schedulesDialogListId() {
      return schedulesDialogListId;
    },
    set schedulesDialogListId(value: typeof schedulesDialogListId) {
      schedulesDialogListId = value;
    },
    get mergeDialog() {
      return mergeDialog;
    },
    set mergeDialog(value: typeof mergeDialog) {
      mergeDialog = value;
    },
    get confirmDeleteListDialog() {
      return confirmDeleteListDialog;
    },
    set confirmDeleteListDialog(value: typeof confirmDeleteListDialog) {
      confirmDeleteListDialog = value;
    },
    get confirmArchiveListDialog() {
      return confirmArchiveListDialog;
    },
    set confirmArchiveListDialog(value: typeof confirmArchiveListDialog) {
      confirmArchiveListDialog = value;
    },
    get renameListDialog() {
      return renameListDialog;
    },
    set renameListDialog(value: typeof renameListDialog) {
      renameListDialog = value;
    },
  };
}
