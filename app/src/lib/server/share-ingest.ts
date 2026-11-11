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

export type XPostRef = { screenName: string; id: string };

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

export function findFirstUrl(value: string): string | undefined {
  const match = value.match(URL_PATTERN);
  return match?.[0];
}

/** AndroidのXアプリは`url`を空にしてURLを`text`側へ入れて渡す場合があるため、`text`・`title`からも探す。 */
export function extractUrl(params: {
  title: string;
  text: string;
  url: string;
}): string | undefined {
  const direct = params.url.trim();
  if (direct) return direct;
  return findFirstUrl(params.text) ?? findFirstUrl(params.title);
}

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

/** X以外のURLは、ページの表示に要るクエリがありうるため、既知の追跡用パラメーターだけを除く。 */
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

/** FxTwitterの`/2/`を含むv2形式ではなく、v1形式（`tweet.author.screen_name`など）の属性名で読む。 */
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

/** oEmbedは本文を構造化した値で返さないため、`html`の`<p>`要素から取り出す。訳は無く、長文は末尾を「…」で省略して返す。 */
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

/** 取得の失敗で共有の画面をエラーにしないため、理由は`log`へ渡して例外を送出しない。 */
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

/** X投稿を取得できた場合は、本文の途中までしか含まず`&amp;`が残るChrome拡張のタブのタイトルと`text`を使わない。 */
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
