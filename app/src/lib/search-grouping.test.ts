import { describe, expect, it } from "vitest";
import type { SearchTaskResult } from "./types";
import { groupSearchResultsByList } from "./search-grouping";

function makeResult(
  listId: number,
  listTitle: string,
  id: number,
): SearchTaskResult {
  return {
    id,
    listId,
    listTitle,
    title: `タスク${id}`,
    notes: "",
    status: "active",
    kind: "normal",
    tags: [],
    attachments: [],
  };
}

describe("groupSearchResultsByList", () => {
  const results = [
    makeResult(2, "リストB", 21),
    makeResult(1, "リストA", 11),
    makeResult(3, "リストC", 31),
  ];

  it("選択中リストのグループを先頭へ移動する", () => {
    const grouped = groupSearchResultsByList(results, 1);

    expect([...grouped.keys()]).toEqual([1, 2, 3]);
    expect(grouped.get(1)?.tasks.map((task) => task.id)).toEqual([11]);
  });

  it.each([null, 99])(
    "選択中リストが結果に無い場合（%s）は受信順を維持する",
    (selectedListId) => {
      const grouped = groupSearchResultsByList(results, selectedListId);

      expect([...grouped.keys()]).toEqual([2, 1, 3]);
    },
  );
});
