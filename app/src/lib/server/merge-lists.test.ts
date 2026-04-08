/**
 * @fileoverview リスト統合のマージアルゴリズムのユニットテスト
 */

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
    // [0] Oct, [1] Dec(矛盾!), [2] Jan(矛盾!), [3] Aug
    // 矛盾区間は [0]~[2]（[3] の Aug は [0] の Oct 以下ではないので区間に含まれない）
    // → 区間 [Oct, Dec, Jan] を降順ソート → [Jan, Dec, Oct]
    // [3] の Aug はそのまま
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
    // [0] Sep, [1] Dec(矛盾!), [2] Nov(矛盾!)
    // 区間 [Sep, Dec, Nov] を降順ソート → [Dec, Nov, Sep]
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
    // [0] Sep / [1] Oct(矛盾!) / [2] Aug
    // 矛盾区間は [0]~[1]（[2] の Aug は [0] の Sep 以下のため区間外）
    // 区間 [Sep, Oct] を降順ソート → [Oct, Sep]
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
    // ListA: swap後 [0]=Oct, [1]=Sep, [2]=Aug
    // ListB: [0]=Sep
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
    // A[0](Oct) > B[0](Sep) → A[0]
    // A[1](Sep) >= B[0](Sep) → A[1]
    // B[0](Sep) > A[2](Aug) → B[0]
    // 残り: A[2]
    expect(result.map((r) => r.id)).toEqual(["A0", "A1", "B0", "A2"]);
  });
});
