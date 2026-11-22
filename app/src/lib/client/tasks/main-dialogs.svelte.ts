import type { TaskKind } from "#lib/schemas.ts";
import type { TagInfo } from "#lib/types.ts";

export function createMainDialogs() {
  type EditDialog = {
    sessionId: number;
    open: boolean;
    listId: number;
    taskId: number;
    text: string;
    moveTo: string;
    completed: boolean;
    savedCompleted: boolean;
    tags: TagInfo[];
    kind: TaskKind;
  };
  let editDialog = $state<EditDialog>({
    sessionId: 0,
    open: false,
    listId: 0,
    taskId: 0,
    text: "",
    moveTo: "",
    completed: false,
    savedCompleted: false,
    tags: [],
    kind: "normal",
  });

  let schedulesDialogListId = $state<number | null>(null);

  type MergeSource = {
    sourceListId: number;
    sourceTitle: string;
    taskCount: number;
  };
  type MergeDialog =
    | { phase: "closed" }
    | { phase: "input" | "submitting"; session: MergeSource };
  let mergeDialog = $state.raw<MergeDialog>({ phase: "closed" });

  function openMergeDialog(session: MergeSource): void {
    mergeDialog = { phase: "input", session: { ...session } };
  }

  function closeMergeDialog(): void {
    mergeDialog = { phase: "closed" };
  }

  function beginMerge() {
    if (mergeDialog.phase !== "input") return;
    const submission = {
      phase: "submitting",
      session: mergeDialog.session,
    } as const;
    mergeDialog = submission;
    return submission;
  }

  function finishMerge(
    submission: ReturnType<typeof beginMerge>,
    succeeded: boolean,
  ): boolean {
    if (!submission || mergeDialog !== submission) return false;
    if (succeeded) {
      closeMergeDialog();
    } else {
      mergeDialog = { phase: "input", session: submission.session };
    }
    return succeeded;
  }

  type ConfirmDeleteListDialog = {
    open: boolean;
    listId: number;
  };
  let confirmDeleteListDialog = $state<ConfirmDeleteListDialog>({
    open: false,
    listId: 0,
  });

  type ConfirmArchiveListDialog = {
    open: boolean;
    listId: number;
  };
  let confirmArchiveListDialog = $state<ConfirmArchiveListDialog>({
    open: false,
    listId: 0,
  });

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
    openMergeDialog,
    closeMergeDialog,
    beginMerge,
    finishMerge,
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
