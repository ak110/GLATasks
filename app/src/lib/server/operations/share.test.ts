import type { RequestEvent } from "@sveltejs/kit";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api-errors";

vi.mock("#lib/server/api.ts", () => ({
  createTask: vi.fn(async () => {
    throw new ApiError("not_found_or_forbidden");
  }),
}));
const { actions } = await import("../../../routes/share/ingest/+page.server");

describe("共有取り込みのエラー", () => {
  it("存在しないリストへの追加はMCPと同じ表示文言を返す", async () => {
    const request = new Request("http://localhost/share/ingest", {
      method: "POST",
      body: new URLSearchParams({ list_id: "999", text: "追加" }),
    });
    const response = await actions.default({
      request,
      locals: { user_id: 42 },
    } as RequestEvent);
    expect(response).toMatchObject({
      status: 404,
      data: { error: "対象が見つかりません" },
    });
  });
});
