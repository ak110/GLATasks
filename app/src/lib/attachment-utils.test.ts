/**
 * @fileoverview attachment-utilsの単体テスト
 *
 * ClipboardEvent・DataTransferはvitestの既定Node環境では未定義のため、
 * `extractImageFilesFromClipboard`が実際に触れる`event.clipboardData?.files`のみを備えた
 * 最小モックを使って検証する（実行時形状はブラウザ側と同じFileListライクなオブジェクトを与える）。
 */

import { describe, it, expect } from "vitest";
import {
  isImageAttachment,
  extractImageFilesFromClipboard,
} from "./attachment-utils";

describe("isImageAttachment", () => {
  it("image/pngは画像と判定する", () => {
    expect(isImageAttachment("image/png")).toBe(true);
  });

  it("text/plainは画像と判定しない", () => {
    expect(isImageAttachment("text/plain")).toBe(false);
  });
});

/** `event.clipboardData?.files`のみを備えたClipboardEventモックを組み立てる */
function makeClipboardEvent(files: File[] | null): ClipboardEvent {
  const clipboardData =
    files === null
      ? null
      : {
          // FileListライク: length + 数値インデックス。Array.fromで走査するので配列でも動作する
          files,
        };
  return { clipboardData } as unknown as ClipboardEvent;
}

describe("extractImageFilesFromClipboard", () => {
  it("画像ファイルを含む場合はそのFileを返す（File.name有り）", () => {
    const png = new File([new Uint8Array([1, 2, 3])], "photo.png", {
      type: "image/png",
    });
    const event = makeClipboardEvent([png]);
    const result = extractImageFilesFromClipboard(event);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("photo.png");
    expect(result[0].type).toBe("image/png");
  });

  it("画像を1件も含まない場合は空配列を返す", () => {
    const txt = new File(["hello"], "memo.txt", { type: "text/plain" });
    const event = makeClipboardEvent([txt]);
    expect(extractImageFilesFromClipboard(event)).toEqual([]);
  });

  it("File.nameが空の場合はclipboard-<日時>-<seq>.<ext>形式で自動命名する", () => {
    const png = new File([new Uint8Array([1])], "", { type: "image/png" });
    const event = makeClipboardEvent([png]);
    const result = extractImageFilesFromClipboard(event);
    expect(result).toHaveLength(1);
    expect(result[0].name).toMatch(/^clipboard-\d{8}-\d{6}-\d{3}\.png$/);
    expect(result[0].type).toBe("image/png");
  });

  it("同一秒内で名前空の画像を複数貼り付けたときseqが連番採番される", () => {
    const png1 = new File([new Uint8Array([1])], "", { type: "image/png" });
    const png2 = new File([new Uint8Array([2])], "", { type: "image/png" });
    const result = extractImageFilesFromClipboard(
      makeClipboardEvent([png1, png2]),
    );
    expect(result).toHaveLength(2);
    const match1 = result[0].name.match(/-(\d{3})\.png$/);
    const match2 = result[1].name.match(/-(\d{3})\.png$/);
    expect(match1).not.toBeNull();
    expect(match2).not.toBeNull();
    const seq1 = Number(match1![1]);
    const seq2 = Number(match2![1]);
    expect(seq2).toBe(seq1 + 1);
  });

  it("clipboardData未設定の場合は空配列を返す", () => {
    const event = makeClipboardEvent(null);
    expect(extractImageFilesFromClipboard(event)).toEqual([]);
  });
});
