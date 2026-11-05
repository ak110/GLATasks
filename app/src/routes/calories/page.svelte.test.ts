import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { QueryClient } from "@tanstack/svelte-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaloriePageFixture from "#lib/components/calories/CaloriePage.test-fixture.svelte";

const queries = vi.hoisted(() => ({
  items: vi.fn(),
  records: vi.fn(),
  autoRecords: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("#lib/client/trpc.ts", () => ({
  trpc: {
    calories: {
      items: { query: queries.items },
      records: { query: queries.records },
      autoRecords: { query: queries.autoRecords },
      summary: { query: queries.summary },
    },
  },
}));
vi.mock("#lib/components/layout/Header.svelte", () => ({
  default: () => ({}),
}));
vi.mock("#lib/client/query-sync.ts", () => ({
  subscribeQueryEvents: vi.fn(),
  invalidateEventQueries: vi.fn(),
}));

const clients: QueryClient[] = [];
const summary = {
  periods: [],
  goalKcal: 2000,
  achievement: {
    days: [],
    streakDays: 0,
    latestAverageKcal: null,
    todayRemainingKcal: null,
    weeklyChangeKcal: null,
  },
};
afterEach(() => {
  clients.forEach((client) => client.clear());
  vi.resetAllMocks();
});
describe("カロリー画面の取得状態", () => {
  it.each(["items", "records", "autoRecords", "summary"] as const)(
    "%sの初回エラーを空成功と区別し再取得できる",
    async (name) => {
      queries.items.mockResolvedValue([]);
      queries.records.mockResolvedValue({ records: [] });
      queries.autoRecords.mockResolvedValue([]);
      queries.summary.mockResolvedValue(summary);
      const result =
        name === "records"
          ? { records: [] }
          : name === "summary"
            ? summary
            : [];
      queries[name]
        .mockRejectedValueOnce(new Error("試験用取得エラー"))
        .mockResolvedValue(result);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      clients.push(client);
      render(CaloriePageFixture, { client });
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("試験用取得エラー");
      if (name === "records")
        expect(
          screen.queryByText("この期間の記録はありません"),
        ).not.toBeInTheDocument();
      if (name === "items")
        expect(screen.queryByText("品目がありません")).not.toBeInTheDocument();
      if (name === "autoRecords")
        expect(
          screen.queryByText("自動記録の設定はありません"),
        ).not.toBeInTheDocument();
      await fireEvent.click(
        within(alert).getByRole("button", { name: "再試行" }),
      );
      await waitFor(() => expect(queries[name]).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
      );
    },
  );
});
