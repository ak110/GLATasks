import { describe, it, expect } from "vitest";
import { adjustUpdatedTimestamps, mergeByTimestamp } from "./merge-utils";

describe("adjustUpdatedTimestamps", () => {
  it("空配列を処理できる", () => {
    expect(adjustUpdatedTimestamps([])).toEqual([]);
  });

  it("単一要素はそのまま返す", () => {
    const result = adjustUpdatedTimestamps([
      { updated: new Date("2026-09-01") },
    ]);
    expect(result).toEqual([new Date("2026-09-01").getTime()]);
  });

  it("矛盾がなければそのまま返す（単調非増加）", () => {
    const result = adjustUpdatedTimestamps([
      { updated: new Date("2026-10-01") },
      { updated: new Date("2026-09-01") },
      { updated: new Date("2026-08-01") },
    ]);
    expect(result).toEqual([
      new Date("2026-10-01").getTime(),
      new Date("2026-09-01").getTime(),
      new Date("2026-08-01").getTime(),
    ]);
  });

  it("矛盾箇所を降順ソート（swap）で補正する", () => {
    const result = adjustUpdatedTimestamps([
      { updated: new Date("2026-10-01") },
      { updated: new Date("2026-12-01") },
      { updated: new Date("2027-01-01") },
      { updated: new Date("2026-08-01") },
    ]);
    expect(result).toEqual([
      new Date("2027-01-01").getTime(),
      new Date("2026-12-01").getTime(),
      new Date("2026-10-01").getTime(),
      new Date("2026-08-01").getTime(),
    ]);
  });

  it("末尾まで矛盾する場合も降順ソートで補正する", () => {
    const result = adjustUpdatedTimestamps([
      { updated: new Date("2026-09-01") },
      { updated: new Date("2026-12-01") },
      { updated: new Date("2026-11-01") },
    ]);
    expect(result).toEqual([
      new Date("2026-12-01").getTime(),
      new Date("2026-11-01").getTime(),
      new Date("2026-09-01").getTime(),
    ]);
  });

  it("ユーザーの例: sort_orderと矛盾するupdatedが補正される", () => {
    const result = adjustUpdatedTimestamps([
      { updated: new Date("2026-09-01") },
      { updated: new Date("2026-10-01") },
      { updated: new Date("2026-08-01") },
    ]);
    expect(result).toEqual([
      new Date("2026-10-01").getTime(),
      new Date("2026-09-01").getTime(),
      new Date("2026-08-01").getTime(),
    ]);
  });
});

describe("mergeByTimestamp", () => {
  it("空リスト同士のマージ", () => {
    expect(mergeByTimestamp([], [])).toEqual([]);
  });

  it("片方が空の場合はもう一方をそのまま返す", () => {
    const a = [{ id: 1, adjusted: 100 }];
    expect(mergeByTimestamp(a, [])).toEqual(a);
    expect(mergeByTimestamp([], a)).toEqual(a);
  });

  it("adjusted降順でインターリーブする", () => {
    const a = [
      { id: 1, adjusted: 100 },
      { id: 2, adjusted: 50 },
    ];
    const b = [
      { id: 3, adjusted: 75 },
      { id: 4, adjusted: 25 },
    ];
    const result = mergeByTimestamp(a, b);
    expect(result.map((r) => r.id)).toEqual([1, 3, 2, 4]);
  });

  it("同じadjustedではlistAが先にピックされる", () => {
    const a = [{ id: 1, adjusted: 100 }];
    const b = [{ id: 2, adjusted: 100 }];
    const result = mergeByTimestamp(a, b);
    expect(result.map((r) => r.id)).toEqual([1, 2]);
  });

  it("ユーザーの例: 統合結果が期待通り", () => {
    const oct = new Date("2026-10-01").getTime();
    const sep = new Date("2026-09-01").getTime();
    const aug = new Date("2026-08-01").getTime();
    const a = [
      { id: "A0", adjusted: oct },
      { id: "A1", adjusted: sep },
      { id: "A2", adjusted: aug },
    ];
    const b = [{ id: "B0", adjusted: sep }];
    const result = mergeByTimestamp(a, b);
    expect(result.map((r) => r.id)).toEqual(["A0", "A1", "B0", "A2"]);
  });
});
