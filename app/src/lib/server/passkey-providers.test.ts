import { describe, expect, it } from "vitest";
import { passkeyName } from "./passkey-providers.ts";

describe("登録したパスキーの名前", () => {
  it.each([
    ["bada5566-a7aa-401f-bd96-45619a55120d", "1Password"],
    ["08987058-cadc-4b81-b6e1-30de50dcbe96", "Windows Hello"],
    ["ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4", "Googleパスワードマネージャー"],
    ["d3452668-01fd-4c12-926c-83a4204853aa", "Microsoftパスワードマネージャー"],
    ["fbfc3007-154e-4ecc-8c0b-6e020557d7bd", "Appleパスワード"],
    ["dd4ec289-e01d-41c9-bb89-70fa845d4bf2", "iCloudキーチェーン（管理対象）"],
  ])("対応表の識別子 %s は %s になる", (aaguid, expected) => {
    expect(passkeyName(aaguid, "Chrome")).toBe(expected);
  });

  it.each([
    ["対応表に無い識別子", "01234567-89ab-cdef-0123-456789abcdef"],
    ["ゼロ埋めの識別子", "00000000-0000-0000-0000-000000000000"],
    ["識別子なし", undefined],
  ])("%sはブラウザー名になる", (_, aaguid) => {
    expect(passkeyName(aaguid, "Chrome")).toBe("Chrome");
  });
});
