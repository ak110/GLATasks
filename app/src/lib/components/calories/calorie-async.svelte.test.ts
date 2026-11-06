import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CalorieRecordTable from "./CalorieRecordTable.svelte";
import CalorieItemTable from "./CalorieItemTable.svelte";
import CalorieAutoRecordPanel from "./CalorieAutoRecordPanel.svelte";
import CalorieCsvControls from "./CalorieCsvControls.svelte";
import CalorieBulkControls from "./CalorieBulkControls.svelte";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const items = [
  {
    id: 1,
    name: "食品",
    kcal: 120,
    note: "",
    recordCount: 0,
    autoRecordCount: 0,
  },
  {
    id: 2,
    name: "飲料",
    kcal: 60,
    note: "",
    recordCount: 0,
    autoRecordCount: 0,
  },
];
const records = items.map((item) => ({
  id: item.id,
  itemId: item.id,
  itemName: item.name,
  itemKcal: item.kcal,
  consumedAt: "2026-08-01T01:00:00.000Z",
  quantity: 2,
  totalKcal: item.kcal * 2,
  temporary: false,
}));
const autoRecords = items.map((item) => ({
  id: item.id,
  itemId: item.id,
  itemName: item.name,
  timeOfDay: "08:00",
  quantity: 1,
  enabled: true,
}));
async function editRow(menu: string, index: number) {
  await fireEvent.click(screen.getAllByRole("button", { name: menu })[index]);
  await fireEvent.click(screen.getByRole("menuitem", { name: "編集" }));
}

describe("カロリーの非同期フォーム", () => {
  it.each(["記録", "品目", "自動記録"])(
    "%sの保存中に別の編集を開いても入力を保持する",
    async (kind) => {
      const save = deferred<void>();
      const onUpdate = vi.fn(() => save.promise);
      if (kind === "記録")
        render(CalorieRecordTable, {
          items,
          records,
          windowOffset: 0,
          onWindowChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate,
          onDelete: vi.fn(),
          filterKeywords: [],
          onClearFilter: vi.fn(),
        });
      else if (kind === "品目")
        render(CalorieItemTable, {
          items,
          onCreate: vi.fn(),
          onUpdate,
          onDelete: vi.fn(),
          filterKeywords: [],
          onClearFilter: vi.fn(),
        });
      else
        render(CalorieAutoRecordPanel, {
          items,
          autoRecords,
          onCreate: vi.fn(),
          onUpdate,
          onDelete: vi.fn(),
        });
      await editRow(`${kind}の操作`, 0);
      await fireEvent.click(screen.getByRole("button", { name: "変更" }));
      expect(onUpdate).toHaveBeenCalledOnce();
      const savingDialog = screen.getByRole("dialog");
      expect(within(savingDialog).getByRole("status")).toHaveTextContent(
        "食品",
      );
      expect(within(savingDialog).getByRole("status")).toHaveTextContent(
        "完了まで追加・変更できません",
      );
      expect(
        within(savingDialog).getByRole("button", { name: "保存待ち…" }),
      ).toBeDisabled();
      await fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
      await editRow(`${kind}の操作`, 1);
      expect(
        within(screen.getByRole("dialog")).getByRole("status"),
      ).toHaveTextContent("別の編集・追加の応答待ち");
      save.resolve();
      await waitFor(() =>
        expect(
          screen.getByRole("dialog", { name: `${kind}の編集` }),
        ).toBeInTheDocument(),
      );
      expect(
        screen.getByLabelText(kind === "品目" ? "品目名" : "品目"),
      ).toHaveValue("飲料");
    },
  );

  it("送信後に書き換えた追加入力を残し、同じ送信を重複しない", async () => {
    const save = deferred<void>();
    const onCreate = vi.fn(() => save.promise);
    render(CalorieRecordTable, {
      items,
      records: [],
      windowOffset: 0,
      onWindowChange: vi.fn(),
      onCreate,
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      filterKeywords: [],
      onClearFilter: vi.fn(),
    });
    await fireEvent.input(screen.getByLabelText("品目"), {
      target: { value: "食品" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "追加" }));
    await fireEvent.click(screen.getByRole("button", { name: "追加" }));
    await fireEvent.input(screen.getByLabelText("品目"), {
      target: { value: "飲料" },
    });
    save.resolve();
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("品目")).toHaveValue("飲料");
  });

  it("記録CSVの確認を連打しても一度だけ取り込む", async () => {
    const save = deferred<{ added: number }>();
    const onImportRecords = vi.fn(() => save.promise);
    render(CalorieCsvControls, {
      items,
      onImportItems: vi.fn(),
      onImportRecords,
      onExportRecords: vi.fn(),
    });
    const file = new File([], "records.csv");
    Object.defineProperty(file, "text", {
      value: async () => "日時,品目,数量\r\n2026/08/01 12:00,食品,1\r\n",
    });
    await fireEvent.change(screen.getByTestId("calorie-records-import"), {
      target: { files: [file] },
    });
    const confirm = await screen.findByRole("button", { name: "取り込む" });
    await fireEvent.click(confirm);
    await fireEvent.click(confirm);
    save.resolve({ added: 1 });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("記録を1件追加"),
    );
    expect(onImportRecords).toHaveBeenCalledOnce();
  });

  it("一括削除の確認を連打しても一度だけ削除する", async () => {
    const save = deferred<{ deleted: number }>();
    const onBulkDelete = vi.fn(() => save.promise);
    render(CalorieBulkControls, { items, onBulkCreate: vi.fn(), onBulkDelete });
    const form = screen.getByTestId("calorie-bulk-delete-form");
    await fireEvent.input(within(form).getByLabelText("開始日"), {
      target: { value: "2026-08-01" },
    });
    await fireEvent.input(within(form).getByLabelText("終了日"), {
      target: { value: "2026-08-02" },
    });
    await fireEvent.input(within(form).getByLabelText("品目"), {
      target: { value: "食品" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "一括削除" }));
    const confirm = screen.getByRole("button", { name: "削除" });
    await fireEvent.click(confirm);
    await fireEvent.click(confirm);
    save.resolve({ deleted: 2 });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("2件の記録を削除"),
    );
    expect(onBulkDelete).toHaveBeenCalledOnce();
  });
});

describe("保存対象と確認対象の寿命", () => {
  it.each(["品目", "自動記録"])(
    "%sの同じフォームを書き換えても古い成功で消去しない",
    async (kind) => {
      const save = deferred<void>();
      const onCreate = vi.fn(() => save.promise);
      if (kind === "品目")
        render(CalorieItemTable, {
          items,
          onCreate,
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
          filterKeywords: [],
          onClearFilter: vi.fn(),
        });
      else
        render(CalorieAutoRecordPanel, {
          items,
          autoRecords,
          onCreate,
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        });
      const label = kind === "品目" ? "品目名" : "品目";
      await fireEvent.input(screen.getByLabelText(label), {
        target: { value: "食品" },
      });
      await fireEvent.input(
        screen.getByLabelText(kind === "品目" ? "kcal" : "時刻"),
        { target: { value: kind === "品目" ? "120" : "08:30" } },
      );
      await fireEvent.click(screen.getByRole("button", { name: "追加" }));
      await fireEvent.input(screen.getByLabelText(label), {
        target: { value: "飲料" },
      });
      save.resolve();
      await waitFor(() =>
        expect(screen.queryByText("保存中…")).not.toBeInTheDocument(),
      );
      expect(onCreate).toHaveBeenCalledOnce();
      expect(screen.getByLabelText(label)).toHaveValue("飲料");
    },
  );

  it.each(["品目", "自動記録"])(
    "%sの削除中に開いた別の確認を閉じない",
    async (kind) => {
      const save = deferred<void>();
      const onDelete = vi.fn(() => save.promise);
      if (kind === "品目")
        render(CalorieItemTable, {
          items,
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete,
          filterKeywords: [],
          onClearFilter: vi.fn(),
        });
      else
        render(CalorieAutoRecordPanel, {
          items,
          autoRecords,
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete,
        });
      await fireEvent.click(
        screen.getAllByRole("button", { name: `${kind}の操作` })[0],
      );
      await fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));
      await fireEvent.click(screen.getByRole("button", { name: "削除" }));
      await fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
      await fireEvent.click(
        screen.getAllByRole("button", { name: `${kind}の操作` })[1],
      );
      await fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));
      save.resolve();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "削除" })).not.toBeDisabled(),
      );
      expect(
        screen.getByRole("dialog", { name: `${kind}の削除` }),
      ).toHaveTextContent("飲料");
      expect(onDelete).toHaveBeenCalledExactlyOnceWith(1);
    },
  );

  it.each([false, true])(
    "変換確認の送信を固定し新しい編集を保持する（一時項目=%s）",
    async (temporary) => {
      const save = deferred<void>();
      const onUpdate = vi.fn(() => save.promise);
      render(CalorieRecordTable, {
        items,
        records: [
          {
            ...records[0],
            temporary,
            itemId: temporary ? null : 1,
            itemKcal: temporary ? null : 120,
          },
          records[1],
        ],
        windowOffset: 0,
        onWindowChange: vi.fn(),
        onCreate: vi.fn(),
        onUpdate,
        onDelete: vi.fn(),
        filterKeywords: [],
        onClearFilter: vi.fn(),
      });
      await editRow("記録の操作", 0);
      await fireEvent.click(
        screen.getByRole("button", {
          name: temporary ? "通常項目に変換" : "一時項目に変換",
        }),
      );
      const dialog = screen.getByRole("dialog", {
        name: temporary ? "通常項目への変換" : "一時項目への変換",
      });
      const confirm = within(dialog).getByRole("button", { name: "変換" });
      await fireEvent.click(confirm);
      await fireEvent.click(confirm);
      expect(dialog).toHaveTextContent("食品");
      expect(dialog).toHaveTextContent(
        "変換中です。完了まで追加・変更できません",
      );
      expect(
        within(dialog).getByRole("button", { name: "変換待ち…" }),
      ).toBeDisabled();
      expect(onUpdate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining(
          temporary
            ? { recordId: 1, itemId: 1, quantity: 1 }
            : { recordId: 1, temporaryName: "食品", quantity: 240 },
        ),
      );
      await fireEvent.click(
        within(dialog).getByRole("button", { name: "キャンセル" }),
      );
      await fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
      await editRow("記録の操作", 1);
      save.resolve();
      await waitFor(() =>
        expect(screen.queryByText("保存中…")).not.toBeInTheDocument(),
      );
      expect(screen.getByLabelText("品目")).toHaveValue("飲料");
    },
  );
});
