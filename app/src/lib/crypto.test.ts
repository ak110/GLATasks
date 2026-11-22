import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./crypto";

describe("crypto (browser)", () => {
  const testKey = "dGVzdGtleWZvcnRlc3Rpbmcxa2V5MTIzNDU2Nzg5MDE=";

  it("encrypt / decrypt で暗号化・復号化できる", async () => {
    const original = "Hello, World!";
    const encrypted = await encrypt(original, testKey);

    expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(encrypted).not.toContain("Hello");

    const decrypted = await decrypt(encrypted, testKey);
    expect(decrypted).toBe(original);
  });

  it("異なる鍵で復号化すると失敗する", async () => {
    const original = "test message";
    const encrypted = await encrypt(original, testKey);

    const wrongKey = "d3JvbmdrZXlmb3J0ZXN0aW5nMWtleTEyMzQ1Njc4OTA=";
    await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
  });

  it("同じデータを暗号化しても毎回異なる暗号文になる（IV使用）", async () => {
    const original = "same data";
    const encrypted1 = await encrypt(original, testKey);
    const encrypted2 = await encrypt(original, testKey);

    expect(encrypted1).not.toBe(encrypted2);

    const decrypted1 = await decrypt(encrypted1, testKey);
    const decrypted2 = await decrypt(encrypted2, testKey);
    expect(decrypted1).toBe(original);
    expect(decrypted2).toBe(original);
  });
});
