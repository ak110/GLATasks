/**
 * @fileoverview カロリーの自動記録の追加欄が、保存後に初期値へ戻った後の作業中判定を妨げないことのテスト
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import {
  isUserBusy,
  startEditedFieldTracking,
} from "#lib/client/ui/user-busy.ts";
import CalorieAutoRecordPanel from "./CalorieAutoRecordPanel.svelte";

describe("CalorieAutoRecordPanel", () => {
  it("入力した追加欄は作業中とみなし、追加に成功して初期値へ戻ると作業中でなくなる", async () => {
    // 自動の再読み込みの見送り判定は、data-clean-valueと異なる欄だけを未保存の入力とみなす
    const stopTracking = startEditedFieldTracking();
    try {
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(CalorieAutoRecordPanel, {
        items: [{ id: 1, name: "食品" }],
        autoRecords: [],
        onCreate,
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      });
      const time = screen.getByLabelText("時刻") as HTMLInputElement;
      const item = screen.getByLabelText("品目") as HTMLInputElement;
      const quantity = screen.getByLabelText("数量") as HTMLInputElement;
      await fireEvent.input(time, { target: { value: "08:00" } });
      await fireEvent.input(item, { target: { value: "食品" } });
      await fireEvent.input(quantity, { target: { value: "3" } });
      expect(isUserBusy()).toBe(true);

      await fireEvent.click(screen.getByRole("button", { name: "追加" }));

      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: 1, quantity: 3 }),
      );
      await waitFor(() => expect(quantity.value).toBe("1"));
      expect(isUserBusy()).toBe(false);
    } finally {
      stopTracking();
    }
  });
});
