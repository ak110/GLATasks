import { describe, it, expect } from "vitest";
import type { TagInfo } from "./types";
import { compareTagName } from "./tag-sort";

function makeTag(name: string): TagInfo {
  return { name, color: "slate" };
}

describe("compareTagName", () => {
  it("文字コード順に並べ、接頭辞が同じ場合は短い名前を先にする", () => {
    const tags = [
      "い",
      "abc",
      "あ",
      "_",
      "cherry",
      "Apple",
      "abcd",
      "1",
      "A",
      "!",
      "banana",
      "う",
      "ab",
    ];
    const sorted = tags.map(makeTag).sort(compareTagName);
    expect(sorted.map((tag) => tag.name)).toEqual([
      "!",
      "1",
      "A",
      "Apple",
      "_",
      "ab",
      "abc",
      "abcd",
      "banana",
      "cherry",
      "あ",
      "い",
      "う",
    ]);
  });

  it("同名は0を返す", () => {
    expect(compareTagName(makeTag("x"), makeTag("x"))).toBe(0);
  });

  it("後の名前を左に渡すと正、引数を逆にすると負を返す", () => {
    expect(compareTagName(makeTag("b"), makeTag("a"))).toBeGreaterThan(0);
    expect(compareTagName(makeTag("a"), makeTag("b"))).toBeLessThan(0);
  });
});
