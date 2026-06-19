/**
 * @fileoverview OAuth 2.1 認可エンドポイント（GET=同意画面、POST=コード発行）
 *
 * MCP クライアントが /oauth/authorize?response_type=code&... をブラウザで開く。
 * 未ログイン時は /auth/login へ returnTo 付きで誘導し、ログイン後に本ページへ戻る。
 */

import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { getClient, issueAuthorizationCode } from "$lib/server/mcp/store";
import type { Actions, PageServerLoad } from "./$types";

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

function parseQuery(url: URL): AuthorizeParams {
  const obj = Object.fromEntries(url.searchParams);
  const parsed = QuerySchema.safeParse(obj);
  if (!parsed.success) {
    throw new Error(`invalid_request: ${parsed.error.message}`);
  }
  return parsed.data;
}

function ensureRegisteredClient(params: AuthorizeParams) {
  const client = getClient(params.client_id);
  if (!client) {
    throw new Error("unknown_client");
  }
  if (!client.redirect_uris.includes(params.redirect_uri)) {
    throw new Error("invalid_redirect_uri");
  }
  return client;
}

export const load: PageServerLoad = async ({ url, locals }) => {
  let params: AuthorizeParams;
  try {
    params = parseQuery(url);
    ensureRegisteredClient(params);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "invalid_request",
      params: null,
      clientName: null,
    };
  }

  if (!locals.user_id) {
    const returnTo = `/oauth/authorize${url.search}`;
    redirect(302, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const client = ensureRegisteredClient(params);
  return {
    error: null as string | null,
    params,
    clientName: client.client_name ?? params.client_id,
  };
};

export const actions: Actions = {
  default: async ({ url, locals }) => {
    if (!locals.user_id) {
      return fail(401, { error: "unauthorized" });
    }
    let params: AuthorizeParams;
    try {
      params = parseQuery(url);
      ensureRegisteredClient(params);
    } catch (e) {
      return fail(400, {
        error: e instanceof Error ? e.message : "invalid_request",
      });
    }
    const code = issueAuthorizationCode({
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      user_id: locals.user_id,
      scope: params.scope,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method,
      resource: params.resource,
    });
    const redirectUrl = new URL(params.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (params.state) redirectUrl.searchParams.set("state", params.state);
    redirect(302, redirectUrl.toString());
  },
};
