/**
 * @fileoverview tRPCクライアントの送信本文の暗号化を、実際のSDKの直列化とサーバーの復号まで通して検証する
 *
 * `createCaller`だけのテストはクライアントの直列化とfetch wrapperを通らず、送信本文が暗号化されなくても
 * サーバーは平文の入力を受け付けて成功するため、暗号化の欠落を検出できない。
 * ここでは公開クライアント`trpc`のfetchをサーバーのHTTPアダプターへ接続し、送信本文と受信側の復号結果の双方を確かめる。
 * DB接続を排除するため、API関数とSSE送信はモック化する。暗号処理は実装をそのまま使う。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

const ENCRYPT_KEY = Buffer.from(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
).toString("base64");

vi.mock("#lib/server/env.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#lib/server/env.ts")>();
  return { ...actual, getEncryptKey: () => ENCRYPT_KEY };
});

vi.mock("#lib/server/api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#lib/server/api.ts")>();
  return {
    ...actual,
    createAttachment: vi.fn().mockResolvedValue({ attachmentId: 1 }),
    createCalorieItem: vi.fn().mockResolvedValue(undefined),
    getCalorieSummary: vi
      .fn()
      .mockResolvedValue({ goalKcal: 1615, periods: [] }),
  };
});

vi.mock("#lib/server/sse.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#lib/server/sse.ts")>();
  return { ...actual, sendEvent: vi.fn() };
});

const { appRouter } = await import("#lib/server/trpc.ts");
const api = await import("#lib/server/api.ts");
const { decrypt } = await import("#lib/crypto.ts");
const { trpc, setEncryptKey } = await import("./trpc");

/** クライアントが送った要求（URLと本文）。 */
const sent: { url: string; body: string | undefined }[] = [];

async function serve(
  url: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestUrl = new URL(String(url), "http://localhost");
  sent.push({
    url: requestUrl.toString(),
    body: init?.body as string | undefined,
  });
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext: () => ({ userId: 42, tabId: null }),
    req: new Request(requestUrl, init),
  });
}

const attachmentInput = {
  taskId: 1,
  filename: "memo.txt",
  mimeType: "text/plain",
  data: "aGVsbG8=",
};
const calorieInput = { name: "食品", kcal: 100, note: "備考" };

describe("tRPCクライアントの送信本文の暗号化", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sent.length = 0;
    vi.stubGlobal("fetch", serve);
    setEncryptKey(ENCRYPT_KEY);
  });

  it("単一のmutationの入力を暗号化し、サーバーが元の入力へ復号する", async () => {
    const result = await trpc.attachments.create.mutate(attachmentInput);

    expect(result).toEqual({ success: true });
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0].body!);
    expect(Object.keys(body)).toEqual(["0"]);
    expect(Object.keys(body["0"])).toEqual(["encrypted"]);
    expect(JSON.parse(await decrypt(body["0"].encrypted, ENCRYPT_KEY))).toEqual(
      attachmentInput,
    );
    expect(sent[0].body).not.toContain("memo.txt");
    expect(api.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, ...attachmentInput }),
    );
  });

  it("同時に呼んだ複数のmutationを1つの要求へまとめ、各入力を暗号化する", async () => {
    const results = await Promise.all([
      trpc.attachments.create.mutate(attachmentInput),
      trpc.calories.createItem.mutate(calorieInput),
    ]);

    expect(results[0]).toEqual({ success: true });
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0].body!);
    expect(Object.keys(body)).toEqual(["0", "1"]);
    expect(JSON.parse(await decrypt(body["0"].encrypted, ENCRYPT_KEY))).toEqual(
      attachmentInput,
    );
    expect(JSON.parse(await decrypt(body["1"].encrypted, ENCRYPT_KEY))).toEqual(
      calorieInput,
    );
    expect(api.createCalorieItem).toHaveBeenCalledWith(42, calorieInput);
  });

  it("GETのqueryは入力をURLで送り、応答を復号する", async () => {
    const result = await trpc.calories.summary.query({ tzOffsetMinutes: 540 });

    expect(result).toEqual({ goalKcal: 1615, periods: [] });
    expect(sent[0].body).toBeUndefined();
    expect(sent[0].url).toContain("tzOffsetMinutes");
    expect(api.getCalorieSummary).toHaveBeenCalledWith(42, 540);
  });
});
