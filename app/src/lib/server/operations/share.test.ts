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
    } as Parameters<typeof actions.default>[0]);
    expect(response).toMatchObject({
      status: 404,
      data: {
        error:
          "対象が見つかりません。一覧を取得し直し（画面では再読み込みし）、存在する対象を指定してください。",
      },
    });
  });
});
