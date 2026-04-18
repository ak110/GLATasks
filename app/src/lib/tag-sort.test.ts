/**
 * @fileoverview タグ並び順ユーティリティのテスト
 */

import { describe, it, expect } from "vitest";
import type { TagInfo } from "./types";
import { compareTagName } from "./tag-sort";

function makeTag(name: string): TagInfo {
  return { name, color: "slate" };
}

describe("compareTagName", () => {
  it("ASCII大文字は小文字より前に来る（コード順）", () => {
    const sorted = [
      makeTag("banana"),
      makeTag("Apple"),
      makeTag("cherry"),
    ].sort(compareTagName);
    expect(sorted.map((t) => t.name)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("数字・記号・英字・日本語がコード順に並ぶ", () => {
    const sorted = [
      makeTag("あ"),
      makeTag("A"),
      makeTag("1"),
      makeTag("!"),
      makeTag("_"),
    ].sort(compareTagName);
    // コードポイント: "!"=0x21, "1"=0x31, "A"=0x41, "_"=0x5F, "あ"=0x3042
    expect(sorted.map((t) => t.name)).toEqual(["!", "1", "A", "_", "あ"]);
  });

  it("同名は0を返す", () => {
    expect(compareTagName(makeTag("x"), makeTag("x"))).toBe(0);
  });

  it("日本語のひらがな同士はコード順になる", () => {
    const sorted = [makeTag("い"), makeTag("あ"), makeTag("う")].sort(
      compareTagName,
    );
    expect(sorted.map((t) => t.name)).toEqual(["あ", "い", "う"]);
  });

  it("先頭が同じで長さが異なる場合は短い方が前に来る", () => {
    const sorted = [makeTag("abc"), makeTag("ab"), makeTag("abcd")].sort(
      compareTagName,
    );
    expect(sorted.map((t) => t.name)).toEqual(["ab", "abc", "abcd"]);
  });
});
