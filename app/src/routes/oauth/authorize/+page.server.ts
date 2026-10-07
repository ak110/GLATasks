/**
 * @fileoverview OAuth 2.1 認可エンドポイント（GET=同意画面、POST=コード発行）
 *
 * MCP クライアントが /oauth/authorize?response_type=code&... をブラウザで開く。
 * 未ログイン時は /auth/login へ returnTo 付きで誘導し、ログイン後に本ページへ戻る。
 */

import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { getClient, issueAuthorizationCode } from "#lib/server/mcp/store.ts";
import type { Actions, PageServerLoad } from "./$types";
import { OAUTH_PATHS } from "#lib/server/mcp/oauth-config.ts";

const RedirectTargetSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  state: z.string().optional(),
});

const QuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  scope: z.string().default(""),
  state: z.string().optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  resource: z.string().url().optional(),
});

type AuthorizeParams = z.infer<typeof QuerySchema>;

function ensureRegisteredClient(url: URL) {
  const params = RedirectTargetSchema.parse(
    Object.fromEntries(url.searchParams),
  );
  const client = getClient(params.client_id);
  if (!client) {
    throw new Error("unknown_client");
  }
  if (!client.redirect_uris.includes(params.redirect_uri)) {
    throw new Error("invalid_redirect_uri");
  }
  return { client, params };
}

type ValidatedTarget = ReturnType<typeof ensureRegisteredClient>;

/** 登録済みの戻り先だけへ認可結果を返し、未検証URIへの転送を防ぐ。 */
function respond(
  target: ValidatedTarget,
  result: { code: string } | { error: string },
): never {
  const url = new URL(target.params.redirect_uri);
  for (const [key, value] of Object.entries(result))
    url.searchParams.set(key, value);
  if (target.params.state !== undefined)
    url.searchParams.set("state", target.params.state);
  redirect(302, url.toString(), { external: true });
}

function parseQuery(url: URL, target: ValidatedTarget): AuthorizeParams {
  const responseType = url.searchParams.get("response_type");
  if (responseType !== null && responseType !== "code")
    respond(target, { error: "unsupported_response_type" });
  const resource = url.searchParams.get("resource");
  if (resource !== null && !z.string().url().safeParse(resource).success)
    respond(target, { error: "invalid_target" });
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) respond(target, { error: "invalid_request" });
  return parsed.data;
}

export const load: PageServerLoad = async ({ url, locals }) => {
  let target: ValidatedTarget;
  try {
    target = ensureRegisteredClient(url);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "invalid_request",
      params: null,
      clientName: null,
    };
  }
  const params = parseQuery(url, target);

  if (!locals.user_id) {
    const returnTo = `${OAUTH_PATHS.authorize}${url.search}`;
    redirect(302, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return {
    error: null as string | null,
    params,
    clientName: target.client.client_name ?? params.client_id,
  };
};

export const actions: Actions = {
  default: async ({ url, locals, request }) => {
    if (!locals.user_id) {
      return fail(401, { error: "unauthorized" });
    }
    let target: ValidatedTarget;
    try {
      target = ensureRegisteredClient(url);
    } catch (e) {
      return fail(400, {
        error: e instanceof Error ? e.message : "invalid_request",
      });
    }
    const params = parseQuery(url, target);
    const form = await request.formData();
    if (form.get("decision") === "deny")
      respond(target, { error: "access_denied" });
    const code = issueAuthorizationCode({
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      user_id: locals.user_id,
      scope: params.scope,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method,
      resource: params.resource,
    });
    respond(target, { code });
  },
};
