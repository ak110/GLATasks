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
): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string) => {
    calls.push(input);
    const route = Object.entries(routes).find(([prefix]) =>
      input.startsWith(prefix),
    )?.[1];
    if (!route || route === "network-error")
      throw new TypeError("fetch failed");
    return new Response(JSON.stringify(route.body), { status: route.status });
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
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
      `Kaelig (@kaelig): quality & ambitions\nline2 i…\n\n${POST_URL}`,
    );
    expect(fetch.calls[1]).toBe(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(POST_URL)}&omit_script=1`,
    );
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
