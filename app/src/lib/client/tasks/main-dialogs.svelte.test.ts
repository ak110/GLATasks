import { expect, it } from "vitest";
import { createMainDialogs } from "./main-dialogs.svelte.ts";

it.each(["close", "reopen"] as const)(
  "送信中の %s 後に古い応答が現在のセッションを変更しない",
  (operation) => {
    const dialogs = createMainDialogs();
    const first = { sourceListId: 1, sourceTitle: "A", taskCount: 3 };
    const second = { sourceListId: 2, sourceTitle: "B", taskCount: 5 };
    expect(dialogs.beginMerge()).toBeUndefined();
    dialogs.openMergeDialog(first);
    expect(dialogs.mergeDialog).toEqual({ phase: "input", session: first });
    const old = dialogs.beginMerge();
    expect(dialogs.mergeDialog).toEqual({
      phase: "submitting",
      session: first,
    });
    expect(dialogs.beginMerge()).toBeUndefined();

    dialogs.closeMergeDialog();
    if (operation === "reopen") dialogs.openMergeDialog(second);
    const before = dialogs.mergeDialog;
    expect(dialogs.finishMerge(old, true)).toBe(false);
    expect(dialogs.finishMerge(old, false)).toBe(false);
    expect(dialogs.mergeDialog).toBe(before);

    dialogs.openMergeDialog(second);
    expect(dialogs.finishMerge(dialogs.beginMerge(), false)).toBe(false);
    expect(dialogs.mergeDialog).toEqual({ phase: "input", session: second });
    expect(dialogs.finishMerge(dialogs.beginMerge(), true)).toBe(true);
    expect(dialogs.mergeDialog).toEqual({ phase: "closed" });
  },
);
