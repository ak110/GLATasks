import { timingSafeEqual } from "node:crypto";
import { getClient } from "./store";
import { errorResponse } from "./oauth-response";

/** Basic認証の解析失敗も、トークン応答の形式で返す。 */
export function authenticateClient(request: Request, form: FormData) {
  const authorization = request.headers.get("authorization");
  const basic = /^Basic(?:\s|$)/i.test(authorization ?? "");
  const invalid = (description: string, status = 401) =>
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
      if (separator < 0) return invalid("invalid Basic credentials");
      clientId = decodeURIComponent(decoded.slice(0, separator));
      clientSecret = decodeURIComponent(decoded.slice(separator + 1));
    } catch {
      return invalid("invalid Basic credentials");
    }
  } else {
    const id = form.get("client_id");
    if (typeof id !== "string" || !id)
      return invalid("client_id required", 400);
    clientId = id;
    const secret = form.get("client_secret");
    clientSecret = typeof secret === "string" ? secret : undefined;
  }
  const client = getClient(clientId);
  if (!client) return invalid("unknown client");
  if (client.client_secret) {
    const expected = Buffer.from(client.client_secret);
    const supplied = Buffer.from(clientSecret ?? "");
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      return invalid("secret mismatch");
  }
  return { clientId, client };
}
