import { describe, expect, it } from "vitest";

import { base64ToBytes } from "$lib/base64";

describe("base64ToBytes", () => {
  it("空文字列を空のUint8Arrayへ変換する", () => {
    const bytes = base64ToBytes("");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(0);
  });

  it("1バイトのbase64を1要素のUint8Arrayへ変換する", () => {
    const bytes = base64ToBytes("AQ==");
    expect(Array.from(bytes)).toEqual([1]);
  });

  it("複数バイト（パディングなし）を正しく変換する", () => {
    const bytes = base64ToBytes("AAECAwQFBgcICQ==");
    expect(Array.from(bytes)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("2バイト（1文字パディング）を正しく変換する", () => {
    const bytes = base64ToBytes("//8=");
    expect(Array.from(bytes)).toEqual([0xff, 0xff]);
  });

  it("バイナリ全域（0x00〜0xff）を欠落なく往復する", () => {
    const source = new Uint8Array(256);
    for (let i = 0; i < 256; i++) source[i] = i;
    const encoded = btoa(String.fromCharCode(...source));
    const bytes = base64ToBytes(encoded);
    expect(Array.from(bytes)).toEqual(Array.from(source));
  });
});
