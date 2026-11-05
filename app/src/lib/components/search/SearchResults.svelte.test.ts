import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import SearchResults from "./SearchResults.svelte";

describe("検索結果の取得失敗", () => {
  it("空成功と区別し再試行できる", async () => {
    const onRetry = vi.fn();
    render(SearchResults, {
      query: "検索語",
      searchResultsByList: new Map(),
      isLoading: false,
      error: "検索結果を取得できませんでした。",
      onRetry,
      onGoToResult: vi.fn(),
    });
    expect(screen.getByRole("alert")).toHaveTextContent("取得できませんでした");
    expect(
      screen.queryByText("該当するタスクがありません"),
    ).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
