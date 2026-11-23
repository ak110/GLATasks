import { describe, expect, it } from "vitest";

import {
  buildShareInitialText,
  normalizeUrl,
  type FetchLike,
} from "./share-ingest";

const POST_URL = "https://x.com/kaelig/status/2120347307988381787";
const SHARED_URL = `${POST_URL}?a=uUMYTuEhNFknokWBpdk&s=19`;
const FX_URL = "https://api.fxtwitter.com/kaelig/status/2120347307988381787/ja";

type Route = { status: number; body: unknown } | "network-error";

function fakeFetch(
  routes: Record<string, Route>,
): FetchLike & { calls: string[]; inits: Parameters<FetchLike>[1][] } {
  const calls: string[] = [];
  const inits: Parameters<FetchLike>[1][] = [];
  const fn = (async (input: string, init?: Parameters<FetchLike>[1]) => {
    calls.push(input);
    inits.push(init);
    const route = Object.entries(routes).find(([prefix]) =>
      input.startsWith(prefix),
    )?.[1];
    if (!route || route === "network-error")
      throw new TypeError("fetch failed");
    return new Response(JSON.stringify(route.body), { status: route.status });
  }) as FetchLike & { calls: string[]; inits: Parameters<FetchLike>[1][] };
  fn.calls = calls;
  fn.inits = inits;
  return fn;
}

const fxBody = (translation: string | null) => ({
  code: 200,
  tweet: {
    text: "decision fatigue hit me hard last week",
    author: { name: "Kaelig", screen_name: "kaelig" },
    ...(translation
      ? { translation: { text: translation, target_lang: "ja" } }
      : {}),
  },
});

const oembedBody = {
  author_name: "Kaelig",
  html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">quality &amp; ambitions<br>line2 i…</p>&mdash; Kaelig (@kaelig)</blockquote>',
};

const shared = (
  params: Partial<{ title: string; text: string; url: string }>,
) => ({
  title: "",
  text: "",
  url: "",
  ...params,
});

describe("buildShareInitialText", () => {
  it("FxTwitterの日本語訳を使い、URLのクエリを除く", async () => {
    const fetch = fakeFetch({
      [FX_URL]: { status: 200, body: fxBody("先週は決断疲れがひどかった") },
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
    });
    expect(text).toBe(
      `Kaelig (@kaelig): 先週は決断疲れがひどかった\n\n${POST_URL}`,
    );
  });

  it.each([
    ["英語の固有名詞で始まる訳", "DeepL の翻訳機能を使いました。"],
    ["敬称の略記で始まる訳", "Mr. Smithは到着した。"],
    ["複数の略記で始まる訳", "Mr. and Mrs. Smithは到着した。"],
    ["語中にピリオドを含む製品名で始まる訳", "Node.jsの使い方を紹介します。"],
    ["感嘆符を含む固有名詞で始まる訳", "Yahoo!ニュースで紹介された。"],
  ])("日本語訳（%s）を使う", async (_label, translation) => {
    const fetch = fakeFetch({
      [FX_URL]: { status: 200, body: fxBody(translation) },
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
    });
    expect(text).toBe(`Kaelig (@kaelig): ${translation}\n\n${POST_URL}`);
  });

  it("訳が無ければ原文を使う", async () => {
    const fetch = fakeFetch({ [FX_URL]: { status: 200, body: fxBody(null) } });
    const text = await buildShareInitialText(
      shared({ url: SHARED_URL, title: "XユーザーのKaeligさん: 「…」 / X" }),
      { fetch },
    );
    expect(text).toBe(
      `Kaelig (@kaelig): decision fatigue hit me hard last week\n\n${POST_URL}`,
    );
  });

  it("FxTwitterが失敗したらX公式のoEmbedの名前と原文を使う", async () => {
    const fetch = fakeFetch({
      [FX_URL]: "network-error",
      "https://publish.twitter.com/oembed": { status: 200, body: oembedBody },
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
    });
    expect(text).toBe(
      `Kaelig (@kaelig): quality & ambitions line2 i…\n\n${POST_URL}`,
    );
    expect(fetch.calls[1]).toBe(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(POST_URL)}&omit_script=1`,
    );
  });

  it("本文の改行と連続した空白を1つの空白へまとめ、200文字を超える分を省く", async () => {
    const longTranslation = `先週は\n\n決断疲れが\u3000ひどかった。  ${"あ".repeat(300)}`;
    const fetch = fakeFetch({
      [FX_URL]: { status: 200, body: fxBody(longTranslation) },
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
    });
    const [body, blank, url, ...rest] = text.split("\n");
    expect([blank, url, rest]).toEqual(["", POST_URL, []]);
    const postText = body.slice("Kaelig (@kaelig): ".length);
    expect(Array.from(postText)).toHaveLength(200);
    expect(postText.startsWith("先週は 決断疲れが ひどかった。 あ")).toBe(true);
    expect(postText.endsWith("あ…")).toBe(true);
  });

  it.each([
    [
      "DeepLの旧版警告文",
      "You're using an older version of DeepL. To continue using the app, please update to the latest version.",
    ],
    [
      "英語・ドイツ語・日本語を含む旧版警告文",
      "You're using an older version of DeepL. To continue using the app, please update to the latest version. \u0053ie verwenden eine ältere Version von DeepL. Bitte aktualisieren \u0053ie die App, um \u0073ie weiterhin nutzen zu können. 古いバージョンのDeepLを使用しています。",
    ],
    [
      "日本語の文で始まる旧版警告文",
      "古いバージョンの翻訳アプリを使用しています。You're using an older version of DeepL.",
    ],
    [
      "最初の文に日本語を含まない警告文",
      "Unable to translate! 翻訳できませんでした。",
    ],
    ["英語の失敗文", "Rate limit exceeded. Please try again later."],
  ])("採用できない訳（%s）は使わず原文を使う", async (_label, translation) => {
    const logs: string[] = [];
    const fetch = fakeFetch({
      [FX_URL]: { status: 200, body: fxBody(translation) },
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
      log: (message) => logs.push(message),
    });
    expect(text).toBe(
      `Kaelig (@kaelig): decision fatigue hit me hard last week\n\n${POST_URL}`,
    );
    expect(fetch.calls).toEqual([FX_URL]);
    expect(logs).toHaveLength(1);
  });

  it("両方失敗したら共有元の内容を使い、URLを1回だけ正規化して入れる", async () => {
    const logs: string[] = [];
    const fetch = fakeFetch({
      [FX_URL]: { status: 404, body: { code: 404 } },
      "https://publish.twitter.com/oembed": "network-error",
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
      log: (message) => logs.push(message),
    });
    expect(text).toBe(POST_URL);
    expect(logs).toHaveLength(2);
  });

  it("X以外のURLは追跡用パラメーターだけを除き、外部取得をしない", async () => {
    const fetch = fakeFetch({});
    const text = await buildShareInitialText(
      shared({
        title: "記事",
        url: "https://example.com/a?utm_source=x&id=3&fbclid=abc",
      }),
      { fetch },
    );
    expect(text).toBe("記事\n\nhttps://example.com/a?id=3");
    expect(fetch.calls).toEqual([]);
  });

  it("textだけにある既存のURLを重複させない", async () => {
    const fetch = fakeFetch({});
    const text = await buildShareInitialText(
      shared({ text: "見て https://example.com/b?utm_medium=y" }),
      { fetch },
    );
    expect(text).toBe("見て https://example.com/b");
  });
});

describe("DeepL APIによる訳の補完", () => {
  const FREE_KEY = "test-key:fx";
  const FREE_URL = "https://api-free.deepl.com/v2/translate";
  const deeplBody = (text: string, source = "EN") => ({
    translations: [{ detected_source_language: source, text }],
  });

  it("FxTwitterの訳が無ければDeepL API Freeで訳し、仕様どおりに要求する", async () => {
    const fetch = fakeFetch({
      [FX_URL]: { status: 200, body: fxBody(null) },
      [FREE_URL]: {
        status: 200,
        body: deeplBody("先週は決断疲れがひどかった"),
      },
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
      deeplApiKey: FREE_KEY,
    });
    expect(text).toBe(
      `Kaelig (@kaelig): 先週は決断疲れがひどかった\n\n${POST_URL}`,
    );
    expect(fetch.calls).toEqual([FX_URL, FREE_URL]);
    const init = fetch.inits[1];
    expect(init?.method).toBe("POST");
    expect(init?.headers?.Authorization).toBe(`DeepL-Auth-Key ${FREE_KEY}`);
    expect(init?.headers?.["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body ?? "")).toEqual({
      text: ["decision fatigue hit me hard last week"],
      target_lang: "JA",
    });
  });

  it("有料版のキーはapi.deepl.comへ送る", async () => {
    const fetch = fakeFetch({
      [FX_URL]: { status: 200, body: fxBody(null) },
      "https://api.deepl.com/v2/translate": {
        status: 200,
        body: deeplBody("訳"),
      },
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
      deeplApiKey: "pro-key",
    });
    expect(text).toBe(`Kaelig (@kaelig): 訳\n\n${POST_URL}`);
  });

  it("oEmbedの原文も訳す", async () => {
    const fetch = fakeFetch({
      [FX_URL]: "network-error",
      "https://publish.twitter.com/oembed": { status: 200, body: oembedBody },
      [FREE_URL]: { status: 200, body: deeplBody("品質と野心") },
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
      deeplApiKey: FREE_KEY,
    });
    expect(text).toBe(`Kaelig (@kaelig): 品質と野心\n\n${POST_URL}`);
  });

  it("送る本文を1行にまとめて500文字までに抑える", async () => {
    const fetch = fakeFetch({
      [FX_URL]: {
        status: 200,
        body: {
          code: 200,
          tweet: {
            text: `line1\n\nline2 ${"a".repeat(600)}`,
            author: { name: "Kaelig", screen_name: "kaelig" },
          },
        },
      },
      [FREE_URL]: { status: 200, body: deeplBody("訳") },
    });
    await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
      deeplApiKey: FREE_KEY,
    });
    const sent = JSON.parse(fetch.inits[1]?.body ?? "") as { text: string[] };
    expect(sent.text[0].startsWith("line1 line2 a")).toBe(true);
    expect(Array.from(sent.text[0])).toHaveLength(500);
  });

  it.each([
    ["HTTPエラー", { status: 456, body: { message: "Quota exceeded" } }],
    ["日本語の原文と判定", { status: 200, body: deeplBody("訳", "JA") }],
    ["日本語を含まない訳", { status: 200, body: deeplBody("translated") }],
    ["応答の形の不一致", { status: 200, body: { translations: "x" } }],
    [
      "検出言語の型の不一致",
      {
        status: 200,
        body: { translations: [{ detected_source_language: 1, text: "訳" }] },
      },
    ],
    ["通信の失敗", "network-error"],
  ] as const)("DeepLの%sでは原文を使う", async (_label, route) => {
    const logs: string[] = [];
    const fetch = fakeFetch({
      [FX_URL]: { status: 200, body: fxBody(null) },
      [FREE_URL]: route,
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
      deeplApiKey: FREE_KEY,
      log: (message) => logs.push(message),
    });
    expect(text).toBe(
      `Kaelig (@kaelig): decision fatigue hit me hard last week\n\n${POST_URL}`,
    );
    expect(logs).toHaveLength(1);
  });

  it("FxTwitterの日本語訳があればDeepLを呼ばない", async () => {
    const fetch = fakeFetch({
      [FX_URL]: { status: 200, body: fxBody("先週は決断疲れがひどかった") },
    });
    await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
      deeplApiKey: FREE_KEY,
    });
    expect(fetch.calls).toEqual([FX_URL]);
  });

  it("FxTwitterの訳が無くても日本語の原文ならDeepLを呼ばない", async () => {
    const fetch = fakeFetch({
      [FX_URL]: {
        status: 200,
        body: {
          code: 200,
          tweet: {
            text: "先週は決断疲れがひどかった",
            author: { name: "Kaelig", screen_name: "kaelig" },
          },
        },
      },
    });
    const text = await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
      deeplApiKey: FREE_KEY,
    });
    expect(text).toBe(
      `Kaelig (@kaelig): 先週は決断疲れがひどかった\n\n${POST_URL}`,
    );
    expect(fetch.calls).toEqual([FX_URL]);
  });

  it("DeepLの例外のログにキーを含めない", async () => {
    const logs: string[] = [];
    const base = fakeFetch({ [FX_URL]: { status: 200, body: fxBody(null) } });
    const fetch = (async (input: string, init?: Parameters<FetchLike>[1]) => {
      if (input.startsWith(FREE_URL))
        throw new TypeError(`invalid header: ${FREE_KEY}`);
      return base(input, init);
    }) as FetchLike;
    await buildShareInitialText(shared({ text: SHARED_URL }), {
      fetch,
      deeplApiKey: FREE_KEY,
      log: (message) => logs.push(message),
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(FREE_KEY);
  });

  it("キーが無ければDeepLを呼ばない", async () => {
    const fetch = fakeFetch({ [FX_URL]: { status: 200, body: fxBody(null) } });
    await buildShareInitialText(shared({ text: SHARED_URL }), { fetch });
    expect(fetch.calls).toEqual([FX_URL]);
  });
});

describe("normalizeUrl", () => {
  it.each([
    [
      "https://twitter.com/kaelig/status/1/photo/1?s=20#x",
      "https://x.com/kaelig/status/1",
    ],
    ["https://mobile.x.com/kaelig/status/2", "https://x.com/kaelig/status/2"],
    ["https://x.com/kaelig", "https://x.com/kaelig"],
    ["not a url", "not a url"],
  ])("%s を %s にする", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });
});
