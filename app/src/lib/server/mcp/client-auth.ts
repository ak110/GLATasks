import { timingSafeEqual } from "node:crypto";
import { getClient } from "./store";
import { OAUTH_PATHS } from "./oauth-config";
import {
  RESTART_AUTHORIZATION,
  errorResponse,
  type OAuthErrorDescription,
} from "./oauth-response";

const MALFORMED_BASIC: OAuthErrorDescription = {
  reason: "The Basic authorization header is malformed.",
  nextAction:
    "Send client_id:client_secret encoded in Base64, or send client_id in the form body.",
};

/** Basic認証の解析失敗も、トークン応答の形式で返す。 */
export function authenticateClient(request: Request, form: FormData) {
  const authorization = request.headers.get("authorization");
  const basic = /^Basic(?:\s|$)/i.test(authorization ?? "");
  const invalid = (description: OAuthErrorDescription, status = 401) =>
    errorResponse(
      "invalid_client",
      description,
      basic ? 401 : status,
      basic ? { "WWW-Authenticate": "Basic" } : undefined,
    );
  let clientId: string;
  let clientSecret: string | undefined;
  if (basic) {
    try {
      const decoded = atob((authorization ?? "").replace(/^Basic\s*/i, ""));
      const separator = decoded.indexOf(":");
      if (separator < 0) return invalid(MALFORMED_BASIC);
      clientId = decodeURIComponent(decoded.slice(0, separator));
      clientSecret = decodeURIComponent(decoded.slice(separator + 1));
    } catch {
      return invalid(MALFORMED_BASIC);
    }
  } else {
    const id = form.get("client_id");
    if (typeof id !== "string" || !id)
      return invalid(
        {
          reason: "client_id is required.",
          nextAction:
            "Send client_id in the form body or in the Basic authorization header.",
        },
        400,
      );
    clientId = id;
    const secret = form.get("client_secret");
    clientSecret = typeof secret === "string" ? secret : undefined;
  }
  const client = getClient(clientId);
  if (!client)
    return invalid({
      reason: "The client is not registered.",
      nextAction: `Register the client again at ${OAUTH_PATHS.register}. ${RESTART_AUTHORIZATION}`,
    });
  if (client.client_secret) {
    const expected = Buffer.from(client.client_secret);
    const supplied = Buffer.from(clientSecret ?? "");
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      return invalid({
        reason: "client_secret does not match.",
        nextAction: `Send the client_secret returned at registration, or register the client again at ${OAUTH_PATHS.register}.`,
      });
  }
  return { clientId, client };
}
