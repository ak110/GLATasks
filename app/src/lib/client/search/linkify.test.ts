import { describe, expect, it } from "vitest";
import { linkify } from "#lib/client/search/linkify.ts";

describe("linkify", () => {
  it("URLを含まないテキストはエスケープのみ", () => {
    expect(linkify("hello world")).toBe("hello world");
  });

  it("HTML特殊文字をエスケープする", () => {
    expect(linkify('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
  });

  it("HTTPSリンクを変換する", () => {
    const result = linkify("see https://example.com here");
    expect(result).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer"',
    );
    expect(result).toContain(">https://example.com</a>");
    expect(result).toContain("see ");
    expect(result).toContain(" here");
  });

  it("HTTPリンクを変換する", () => {
    const result = linkify("http://example.com");
    expect(result).toContain('href="http://example.com"');
  });

  it("パス・クエリ・フラグメント付きURLを扱う", () => {
    const url = "https://example.com/path?q=1&b=2#section";
    const result = linkify(url);
    expect(result).toContain(
      'href="https://example.com/path?q=1&amp;b=2#section"',
    );
    expect(result).toContain(
      ">https://example.com/path?q=1&amp;b=2#section</a>",
    );
  });

  it("日本語URLに対応する", () => {
    const url = "https://ja.wikipedia.org/wiki/東京都";
    const result = linkify(`参照: ${url}`);
    expect(result).toContain(`href="${url}"`);
    expect(result).toContain(`>${url}</a>`);
  });

  it("末尾の全角句読点を除外する", () => {
    const result = linkify("URLはhttps://example.com。こちら");
    expect(result).toContain(">https://example.com</a>");
    expect(result).toContain("。こちら");
  });

  it("末尾の読点を除外する", () => {
    const result = linkify("https://example.com、次");
    expect(result).toContain(">https://example.com</a>");
    expect(result).toContain("、次");
  });

  it("末尾の半角カンマを除外する", () => {
    const result = linkify("https://example.com, next");
    expect(result).toContain(">https://example.com</a>");
    expect(result).toContain(", next");
  });

  it("末尾の閉じ括弧を除外する", () => {
    const result = linkify("(https://example.com)");
    expect(result).toContain(">https://example.com</a>");
    expect(result).toContain(")");
  });

  it("末尾の全角閉じ括弧を除外する", () => {
    const result = linkify("（https://example.com）");
    expect(result).toContain(">https://example.com</a>");
    expect(result).toContain("）");
  });

  it("複数のURLを変換する", () => {
    const result = linkify("https://example.com and https://example.org/path");
    expect(result).toContain(">https://example.com</a>");
    expect(result).toContain(">https://example.org/path</a>");
  });

  it("半角スペースでURLが区切られる", () => {
    const result = linkify("https://example.com/path rest");
    expect(result).toContain(">https://example.com/path</a>");
    expect(result).toContain(" rest");
  });

  it("改行でURLが区切られる", () => {
    const result = linkify("https://example.com\nnext line");
    expect(result).toContain(">https://example.com</a>");
    expect(result).toContain("\nnext line");
  });

  it("空文字列を処理できる", () => {
    expect(linkify("")).toBe("");
  });

  it("URL単体（前後テキストなし）を処理できる", () => {
    const result = linkify("https://example.com");
    expect(result).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline dark:text-blue-400">https://example.com</a>',
    );
  });

  it("ポート番号付きURLを処理できる", () => {
    const result = linkify("https://example.com:8080/path");
    expect(result).toContain(">https://example.com:8080/path</a>");
  });

  it("セミコロン末尾を除外する", () => {
    const result = linkify("https://example.com;");
    expect(result).toContain(">https://example.com</a>");
    expect(result).toContain(";");
  });
});
