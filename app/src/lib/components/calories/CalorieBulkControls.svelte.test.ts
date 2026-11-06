import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CalorieBulkControls from "./CalorieBulkControls.svelte";

async function submit(kind: "create" | "delete") {
  const form = screen.getByTestId(`calorie-bulk-${kind}-form`);
  for (const label of ["開始日", "終了日"]) {
    await fireEvent.input(within(form).getByLabelText(label), {
      target: { value: "2026-08-01" },
    });
  }
  await fireEvent.input(within(form).getByLabelText("品目"), {
    target: { value: "食品" },
  });
  if (kind === "create") {
    await fireEvent.input(within(form).getByLabelText("時刻"), {
      target: { value: "08:00" },
    });
  }
  await fireEvent.submit(form);
}

async function confirmDelete() {
  await fireEvent.click(
    within(screen.getByRole("dialog", { name: "記録の一括削除" })).getByRole(
      "button",
      { name: /^削除$/ },
    ),
  );
}

async function expectResult(message: string) {
  await waitFor(() =>
    expect(screen.getByTestId("calorie-bulk-status").textContent?.trim()).toBe(
      message,
    ),
  );
}

describe("一括操作の最後に完了した結果", () => {
  it.each([
    ["create", new Error("通信失敗")],
    ["delete", new Error("対象の業務エラー")],
    ["create", "追加失敗"],
    ["delete", "削除失敗"],
  ] as const)(
    "%sの失敗で原因と反映確認を案内する: %s",
    async (kind, failure) => {
      render(CalorieBulkControls, {
        items: [{ id: 1, name: "食品" }],
        onBulkCreate: vi.fn().mockRejectedValue(failure),
        onBulkDelete: vi.fn().mockRejectedValue(failure),
      });
      await submit(kind);
      if (kind === "delete") await confirmDelete();
      await expectResult(
        `${failure instanceof Error ? failure.message : failure}。反映されたか記録の一覧を確認してから、再操作してください`,
      );
    },
  );
  it.each(["create", "delete"] as const)(
    "%sの後に反対の操作を完了すると結果を置換する",
    async (first) => {
      render(CalorieBulkControls, {
        items: [{ id: 1, name: "食品" }],
        onBulkCreate: vi.fn().mockResolvedValue({ added: 3 }),
        onBulkDelete: vi.fn().mockResolvedValue({ deleted: 2 }),
      });
      for (const kind of [
        first,
        first === "create" ? "delete" : "create",
      ] as const) {
        await submit(kind);
        if (kind === "delete") await confirmDelete();
        await expectResult(
          kind === "create"
            ? "3件の記録を追加しました"
            : "2件の記録を削除しました",
        );
      }
    },
  );

  it.each(["create", "delete"] as const)(
    "並行送信で%sが後に完了するとその結果だけを表示する",
    async (last) => {
      const create = Promise.withResolvers<{ added: number }>();
      const remove = Promise.withResolvers<{ deleted: number }>();
      render(CalorieBulkControls, {
        items: [{ id: 1, name: "食品" }],
        onBulkCreate: () => create.promise,
        onBulkDelete: () => remove.promise,
      });
      await submit("create");
      await submit("delete");
      await confirmDelete();
      if (last === "create") {
        remove.resolve({ deleted: 2 });
        await expectResult("2件の記録を削除しました");
        expect(screen.getByRole("button", { name: "追加中…" })).toBeDisabled();
        create.resolve({ added: 3 });
        await expectResult("3件の記録を追加しました");
      } else {
        create.resolve({ added: 3 });
        await expectResult("3件の記録を追加しました");
        expect(screen.getByRole("button", { name: "一括削除" })).toBeDisabled();
        remove.resolve({ deleted: 2 });
        await expectResult("2件の記録を削除しました");
      }
    },
  );

  it("追加失敗でも削除の確認を保持し、削除完了時に失敗表示を置換する", async () => {
    const create = Promise.withResolvers<{ added: number }>();
    render(CalorieBulkControls, {
      items: [{ id: 1, name: "食品" }],
      onBulkCreate: () => create.promise,
      onBulkDelete: vi.fn().mockResolvedValue({ deleted: 2 }),
    });
    await submit("create");
    await submit("delete");
    create.reject(new Error("追加失敗"));
    await expectResult(
      "追加失敗。反映されたか記録の一覧を確認してから、再操作してください",
    );
    expect(
      screen.getByRole("dialog", { name: "記録の一括削除" }),
    ).toBeVisible();
    await confirmDelete();
    await expectResult("2件の記録を削除しました");
  });
});
