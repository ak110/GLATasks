/** 公開するエラーの文面が理由と次の操作を持ち、入口へ両方を返すことを検証する。 */
import { describe, expect, it, vi } from "vitest";

import {
  API_ERRORS,
  ApiError,
  getPublicError,
  type ApiErrorCode,
} from "./api-errors";

const codes = Object.keys(API_ERRORS) as ApiErrorCode[];

describe("API_ERRORS", () => {
  it.each(codes)("%s は空でない理由と次の操作を持つ", (code) => {
    const definition: Record<string, unknown> = API_ERRORS[code];
    expect(typeof definition.reason).toBe("string");
    expect(typeof definition.nextAction).toBe("string");
    expect((definition.reason as string).trim()).not.toBe("");
    expect((definition.nextAction as string).trim()).not.toBe("");
  });

  it.each(codes.filter((code) => code !== "internal_error"))(
    "%s の公開文面は理由と次の操作の両方を含む",
    (code) => {
      const { reason, nextAction } = API_ERRORS[code];
      const { message } = getPublicError(new ApiError(code));
      expect(message).toContain(reason);
      expect(message).toContain(nextAction);
    },
  );

  it("未知の例外はinternal_errorの理由と次の操作を返す", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { code, message } = getPublicError(new Error("内部の詳細"));
    expect(code).toBe("INTERNAL_SERVER_ERROR");
    expect(message).toBe(
      API_ERRORS.internal_error.reason + API_ERRORS.internal_error.nextAction,
    );
    expect(message).not.toContain("内部の詳細");
  });
});
