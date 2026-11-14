import { describe, expect, test } from "vitest";
import { defaultPasskeyName, passkeyError } from "./passkey.ts";

describe("追加するパスキーの表示名", () => {
  test.each([
    ["Mozilla Chrome/150.0 Safari/537.36 Edg/150.0", "Edgeのパスキー"],
    ["Mozilla Chrome/150.0 Safari/537.36", "Chromeのパスキー"],
    ["Mozilla Version/26.0 Safari/605.1", "Safariのパスキー"],
    ["Mozilla Firefox/150.0", "Firefoxのパスキー"],
    ["", "このブラウザーのパスキー"],
  ])("%s の表示名を生成する", (userAgent, expected) => {
    expect(defaultPasskeyName(userAgent)).toBe(expected);
  });
});

describe("passkeyError", () => {
  test("通信断はブラウザーの文面ではなく、通信の確認とやり直しを案内する", () => {
    const network = new TypeError("Failed to fetch");
    for (const error of [
      network,
      new Error("Failed to fetch", { cause: network }),
    ])
      expect(passkeyError(error)).toBe(
        "サーバーへ接続できませんでした。通信状況を確かめてから、開始ボタンからやり直してください。",
      );
  });

  test("JSONでない応答は読み取れなかったことと、やり直しを案内する", () => {
    expect(passkeyError(new SyntaxError("Unexpected token '<'"))).toBe(
      "サーバーの応答を読み取れませんでした。時間をおいてから、開始ボタンからやり直してください。",
    );
  });

  test("サーバーが返した案内付きのエラーはそのまま表示する", () => {
    const message = "認証に失敗しました。操作をやり直してください。";
    expect(passkeyError(new Error(message))).toBe(message);
  });
});
