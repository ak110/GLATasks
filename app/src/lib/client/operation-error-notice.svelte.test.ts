import { afterEach, describe, expect, it, vi } from "vitest";

const { checkConnectivity } = vi.hoisted(() => ({
  checkConnectivity: vi.fn(),
}));
vi.mock("#lib/client/sse/connection-recovery.svelte.ts", () => ({
  checkConnectivity,
}));

const { shouldNotifyFailure } = await import("./operation-error-notice.ts");

afterEach(() => vi.clearAllMocks());

describe("操作失敗の通知可否", () => {
  it.each([
    ["intercepted", false],
    ["healthy", true],
    ["unreachable", true],
  ])("接続の判定が%sなら通知可否は%s", async (health, expected) => {
    checkConnectivity.mockResolvedValue(health);
    expect(await shouldNotifyFailure()).toBe(expected);
    expect(checkConnectivity).toHaveBeenCalledTimes(1);
  });
});
