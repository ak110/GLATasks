/**
 * @fileoverview common.ts の純粋関数ユニットテスト
 *
 * DB 依存のない parseTags / serializeTags を対象にする。
 */

import { describe, expect, it } from "vitest";

import { parseTags, serializeTags } from "./common.js";

describe("parseTags", () => {
  it("null を渡すと空配列を返す", () => {
    expect(parseTags(null)).toEqual([]);
  });

  it("undefined を渡すと空配列を返す", () => {
    expect(parseTags(undefined)).toEqual([]);
  });

  it("空文字を渡すと空配列を返す", () => {
    expect(parseTags("")).toEqual([]);
  });

  it("単一タグを正しくパースする", () => {
    const raw = JSON.stringify([{ name: "仕事", color: "blue" }]);
    const result = parseTags(raw);
    expect(result).toEqual([{ name: "仕事", color: "blue" }]);
  });

  it("複数タグを正しくパースしてソートする", () => {
    const raw = JSON.stringify([
      { name: "仕事", color: "blue" },
      { name: "個人", color: "emerald" },
      { name: "買い物", color: "red" },
    ]);
    const result = parseTags(raw);
    expect(result).toHaveLength(3);
    // ソート後も全要素が存在することを確認（ソート順は compareTagName に依存）
    expect(result.map((t) => t.name)).toContain("仕事");
    expect(result.map((t) => t.name)).toContain("個人");
    expect(result.map((t) => t.name)).toContain("買い物");
  });

  it("特殊文字を含むタグ名も正しくパースする", () => {
    const raw = JSON.stringify([{ name: "タグ#1&2", color: "amber" }]);
    const result = parseTags(raw);
    expect(result).toEqual([{ name: "タグ#1&2", color: "amber" }]);
  });

  it("不正なJSONは空配列にフォールバックする", () => {
    expect(parseTags("not-json")).toEqual([]);
  });

  it("配列でないJSONは空配列にフォールバックする", () => {
    expect(parseTags(JSON.stringify({ name: "仕事", color: "blue" }))).toEqual(
      [],
    );
  });

  it("不正なcolorキーを持つ要素は除外される", () => {
    const raw = JSON.stringify([
      { name: "有効", color: "blue" },
      { name: "無効", color: "invalid-color" },
    ]);
    const result = parseTags(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("有効");
  });

  it("nameが文字列でない要素は除外される", () => {
    const raw = JSON.stringify([
      { name: 123, color: "blue" },
      { name: "有効", color: "blue" },
    ]);
    const result = parseTags(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("有効");
  });

  it("空の配列は空配列を返す", () => {
    expect(parseTags(JSON.stringify([]))).toEqual([]);
  });
});

describe("serializeTags", () => {
  it("空配列は '[]' に変換される", () => {
    expect(serializeTags([])).toBe("[]");
  });

  it("単一タグを正しくシリアライズする", () => {
    const tags = [{ name: "仕事", color: "blue" as const }];
    const result = serializeTags(tags);
    expect(JSON.parse(result)).toEqual(tags);
  });

  it("複数タグを正しくシリアライズする", () => {
    const tags = [
      { name: "仕事", color: "blue" as const },
      { name: "個人", color: "emerald" as const },
    ];
    const result = serializeTags(tags);
    expect(JSON.parse(result)).toEqual(tags);
  });
});

describe("parseTags / serializeTags ラウンドトリップ", () => {
  it("serializeTags → parseTags でデータが保持される（単一タグ）", () => {
    const original = [{ name: "仕事", color: "blue" as const }];
    const serialized = serializeTags(original);
    const parsed = parseTags(serialized);
    expect(parsed).toEqual(original);
  });

  it("serializeTags → parseTags でデータが保持される（複数タグ）", () => {
    const original = [
      { name: "個人", color: "emerald" as const },
      { name: "仕事", color: "blue" as const },
    ];
    const serialized = serializeTags(original);
    const parsed = parseTags(serialized);
    // parseTags はソートを行うので順序が変わる場合がある。要素の存在を確認する
    expect(parsed).toHaveLength(original.length);
    for (const tag of original) {
      expect(parsed).toContainEqual(tag);
    }
  });

  it("serializeTags → parseTags でデータが保持される（特殊文字含み）", () => {
    // JSON.stringify がダブルクォートやアングルブラケットを適切にエスケープすることを確認する
    const original = [{ name: 'タグ"1"&2', color: "amber" as const }];
    const serialized = serializeTags(original);
    const parsed = parseTags(serialized);
    expect(parsed).toEqual(original);
  });

  it("空配列のラウンドトリップ", () => {
    const original: { name: string; color: "blue" }[] = [];
    const serialized = serializeTags(original);
    const parsed = parseTags(serialized);
    expect(parsed).toEqual([]);
  });
});
