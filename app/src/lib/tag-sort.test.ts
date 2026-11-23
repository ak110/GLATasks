import { describe, it, expect } from "vitest";
import type { TagInfo } from "./types";
import { compareTagName } from "./tag-sort";

function makeTag(name: string): TagInfo {
  return { name, color: "slate" };
}

describe("compareTagName", () => {
  it.each([
    {
      label: "ASCIIの大文字と小文字",
      names: ["banana", "Apple", "cherry"],
      expected: ["Apple", "banana", "cherry"],
    },
    {
      label: "数字・記号・英字・ひらがな",
      names: ["あ", "A", "1", "!", "_"],
      expected: ["!", "1", "A", "_", "あ"],
    },
    {
      label: "ひらがな同士",
      names: ["い", "あ", "う"],
      expected: ["あ", "い", "う"],
    },
    {
      label: "一方が他方の接頭辞",
      names: ["abc", "ab", "abcd"],
      expected: ["ab", "abc", "abcd"],
    },
  ])("$label の名前を文字コード順に並べる", ({ names, expected }) => {
    const sorted = names.map(makeTag).sort(compareTagName);
    expect(sorted.map((tag) => tag.name)).toEqual(expected);
  });

  it("同名は0を返す", () => {
    expect(compareTagName(makeTag("x"), makeTag("x"))).toBe(0);
  });

  it("後の名前を左に渡すと正、引数を逆にすると負を返す", () => {
    expect(compareTagName(makeTag("b"), makeTag("a"))).toBeGreaterThan(0);
    expect(compareTagName(makeTag("a"), makeTag("b"))).toBeLessThan(0);
  });
});
