import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ScheduleDialog from "./ScheduleDialog.svelte";
import { tick } from "svelte";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  refetch: vi.fn(),
  query: { data: undefined, isPending: false, isError: false },
}));

vi.mock("@tanstack/svelte-query", () => ({
  createQuery: () => ({ ...mocks.query, refetch: mocks.refetch }),
  createMutation: (
    options: () => { mutationFn: (input: unknown) => Promise<unknown> },
  ) => ({
    mutateAsync: (input: unknown) => options().mutationFn(input),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("#lib/client/trpc.ts", () => ({
  trpc: { schedules: { create: { mutate: mocks.create } } },
}));

describe("ScheduleDialogの非同期応答", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.isError = false;
  });

  it("保存中に始めた次の入力を古い成功で閉じない", async () => {
    const save = Promise.withResolvers<unknown>();
    mocks.create.mockReturnValue(save.promise);
    const props = { open: true, listId: 1, onClose: vi.fn() };
    render(ScheduleDialog, props);
    await fireEvent.click(screen.getByTestId("schedule-add-btn"));
    await fireEvent.input(screen.getByLabelText("タイトル"), {
      target: { value: "A" },
    });
    await fireEvent.submit(screen.getByTestId("recurrence-editor"));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await fireEvent.click(screen.getByTestId("schedule-add-btn"));
    await fireEvent.input(screen.getByLabelText("タイトル"), {
      target: { value: "B" },
    });
    save.resolve({});
    await save.promise;
    await tick();
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("タイトル")).toHaveValue("B");
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      listId: 1,
      title: "A",
    });
  });

  it("初回取得失敗は空一覧と区別し再試行できる", async () => {
    mocks.query.isError = true;
    render(ScheduleDialog, { open: true, listId: 1, onClose: vi.fn() });
    expect(screen.getByRole("alert")).toHaveTextContent("取得できませんでした");
    expect(screen.queryByText("定期TODOはありません")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
