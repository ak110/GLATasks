import { redirect } from "@sveltejs/kit";
import { deleteSessionCookie } from "#lib/server/session.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ cookies }) => {
  deleteSessionCookie(cookies);
  redirect(302, "/auth/login");
};
