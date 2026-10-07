import { json } from "@sveltejs/kit";

export function errorResponse(
  code: string,
  description: string,
  status = 400,
  headers?: HeadersInit,
): Response {
  return json(
    { error: code, error_description: description },
    { status, headers },
  );
}
