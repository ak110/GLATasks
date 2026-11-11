import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { PublicPasskeySchema } from "#lib/passkey-schemas.ts";
import { publicPasskey } from "#lib/server/api/passkey-public.ts";
import { getErrorStatus, getPublicError } from "#lib/server/api-errors.ts";

export const GET: RequestHandler = () =>
  json({ available: true }, { headers: { "Cache-Control": "no-store" } });
export const POST: RequestHandler = async ({ request, cookies }) => {
  try {
    const parsed = PublicPasskeySchema.safeParse(await request.json());
    if (!parsed.success)
      return json(
        {
          error: "入力内容が不正です。入力を確認して操作をやり直してください。",
        },
        { status: 400 },
      );
    return json(await publicPasskey(parsed.data, cookies), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return json(
      { error: getPublicError(error).message },
      {
        status: getErrorStatus(error),
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
};
