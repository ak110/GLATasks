/**
 * @fileoverview 共有の取り込み画面（`/share/ingest`）の入力欄の初期値を組み立てる
 *
 * 共有元（AndroidのWeb Share Target、Chrome拡張）が渡す`title`・`text`・`url`から、
 * URLの抽出と正規化、X投稿の投稿者名と本文（日本語訳）の取得、初期値の組み立てを行う。
 * X投稿の取得はFxTwitter APIを先に使い、失敗時にX公式のoEmbedへ切り替える。
 * 取得の失敗は画面のエラーにせず、共有元が渡した内容を初期値に使う。
 */

/** 外部取得に使う`fetch`。試験で差し替えるため引数で受け取る。 */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<Response>;

/** X投稿の識別子。 */
export type XPostRef = { screenName: string; id: string };

/** 取得したX投稿の内容。 */
export type XPostContent = { name: string; screenName: string; text: string };

/** 外部取得1回あたりの時間上限（ミリ秒）。FxTwitterとoEmbedの合計で画面の表示を長く止めないための値。 */
export const X_FETCH_TIMEOUT_MS = 3000;

const X_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "www.x.com",
  "www.twitter.com",
  "mobile.x.com",
  "mobile.twitter.com",
]);

/** 追跡用として除くクエリパラメーター（`utm_`で始まるものも除く）。 */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
]);

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;

/** 文字列中の最初のhttp(s) URLを返す。 */
export function findFirstUrl(value: string): string | undefined {
  const match = value.match(URL_PATTERN);
  return match?.[0];
}

/** 共有元が渡した値からURLを得る。`url`が空なら`text`、`title`の順に最初のURLを探す。 */
export function extractUrl(params: {
  title: string;
  text: string;
  url: string;
}): string | undefined {
  const direct = params.url.trim();
  if (direct) return direct;
  return findFirstUrl(params.text) ?? findFirstUrl(params.title);
}

/** X投稿のURLなら識別子を返す。 */
export function parseXPostUrl(raw: string): XPostRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (!X_HOSTS.has(parsed.hostname.toLowerCase())) return undefined;
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
  if (!match) return undefined;
  return { screenName: match[1], id: match[2] };
}

/**
 * URLを正規化する。X投稿は`https://x.com/<ユーザー名>/status/<投稿ID>`へ置き換え、
 * それ以外は追跡用パラメーターだけを除く。URLとして解釈できない値はそのまま返す。
 */
export function normalizeUrl(raw: string): string {
  const post = parseXPostUrl(raw);
  if (post) return `https://x.com/${post.screenName}/status/${post.id}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  const keys = [...parsed.searchParams.keys()];
  const removable = keys.filter(
    (key) =>
      key.toLowerCase().startsWith("utm_") ||
      TRACKING_PARAMS.has(key.toLowerCase()),
  );
  if (removable.length === 0) return raw;
  for (const key of removable) parsed.searchParams.delete(key);
  return parsed.toString();
}

/** 文字列中のURLを正規化後のURLへ置き換える。 */
export function normalizeUrlsInText(value: string): string {
  return value.replace(URL_PATTERN, (url) => normalizeUrl(url));
}

async function fetchJson(
  fetchFn: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const response = await fetchFn(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" },
  });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** FxTwitter APIの応答から投稿内容を取り出す。必要な値が欠ければ`undefined`を返す。 */
export function parseFxTwitter(body: unknown): XPostContent | undefined {
  const root = asRecord(body);
  if (!root || root.code !== 200) return undefined;
  const tweet = asRecord(root.tweet);
  const author = asRecord(tweet?.author);
  const name = nonEmptyString(author?.name);
  const screenName = nonEmptyString(author?.screen_name);
  if (!tweet || !name || !screenName) return undefined;
  const translation = nonEmptyString(asRecord(tweet.translation)?.text);
  const original = nonEmptyString(tweet.text);
  const articleTitle = nonEmptyString(asRecord(tweet.article)?.title);
  const text = translation ?? original ?? articleTitle;
  if (!text) return undefined;
  return { name, screenName, text };
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
    (whole, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        return String.fromCodePoint(parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith("#"))
        return String.fromCodePoint(parseInt(entity.slice(1), 10));
      return HTML_ENTITIES[entity.toLowerCase()] ?? whole;
    },
  );
}

/** X公式oEmbedの応答から投稿内容を取り出す。本文は`html`の`<p>`要素内のテキストとする。 */
export function parseOEmbed(
  body: unknown,
  screenName: string,
): XPostContent | undefined {
  const root = asRecord(body);
  const name = nonEmptyString(root?.author_name);
  const html = nonEmptyString(root?.html);
  if (!name || !html) return undefined;
  const paragraph = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (!paragraph) return undefined;
  const text = decodeHtmlEntities(
    paragraph[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
  ).trim();
  if (!text) return undefined;
  return { name, screenName, text };
}

/**
 * X投稿の内容を取得する。FxTwitter APIが失敗したらoEmbedを使い、どちらも失敗したら`undefined`を返す。
 * 失敗の理由は`log`へ渡し、例外は送出しない。
 */
export async function fetchXPost(
  post: XPostRef,
  options: {
    fetch: FetchLike;
    timeoutMs?: number;
    log?: (message: string) => void;
  },
): Promise<XPostContent | undefined> {
  const timeoutMs = options.timeoutMs ?? X_FETCH_TIMEOUT_MS;
  const log = options.log ?? (() => {});
  const fxUrl = `https://api.fxtwitter.com/${post.screenName}/status/${post.id}/ja`;
  try {
    const { status, body } = await fetchJson(options.fetch, fxUrl, timeoutMs);
    const content = status === 200 ? parseFxTwitter(body) : undefined;
    if (content) return content;
    log(
      `FxTwitter APIから投稿内容を取得できなかった（HTTP ${status}）: ${fxUrl}`,
    );
  } catch (error) {
    log(`FxTwitter APIの取得に失敗した: ${fxUrl}: ${String(error)}`);
  }
  const canonical = `https://x.com/${post.screenName}/status/${post.id}`;
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(canonical)}&omit_script=1`;
  try {
    const { status, body } = await fetchJson(
      options.fetch,
      oembedUrl,
      timeoutMs,
    );
    const content =
      status === 200 ? parseOEmbed(body, post.screenName) : undefined;
    if (content) return content;
    log(
      `X公式のoEmbedから投稿内容を取得できなかった（HTTP ${status}）: ${oembedUrl}`,
    );
  } catch (error) {
    log(`X公式のoEmbedの取得に失敗した: ${oembedUrl}: ${String(error)}`);
  }
  return undefined;
}

/**
 * 入力欄の初期値を組み立てる。X投稿の内容を取得できた場合は`<投稿者名> (@<ユーザー名>): <本文>`と正規化後のURLを使う。
 * それ以外は`title`・`text`（中のURLは正規化）を空行区切りで並べ、正規化後のURLが含まれていない場合だけ末尾に加える。
 */
export async function buildShareInitialText(
  params: { title: string; text: string; url: string },
  options: {
    fetch: FetchLike;
    timeoutMs?: number;
    log?: (message: string) => void;
  },
): Promise<string> {
  const rawUrl = extractUrl(params);
  const url = rawUrl ? normalizeUrl(rawUrl) : "";
  const post = rawUrl ? parseXPostUrl(rawUrl) : undefined;
  if (post) {
    const content = await fetchXPost(post, options);
    if (content)
      return `${content.name} (@${content.screenName}): ${content.text}\n\n${url}`;
  }
  const title = normalizeUrlsInText(params.title);
  const text = normalizeUrlsInText(params.text);
  const parts = [title, text].filter(Boolean);
  if (url && !parts.some((part) => part.includes(url))) parts.push(url);
  return parts.join("\n\n");
}
