import type { Cookies } from "@sveltejs/kit";
import { SignJWT, jwtVerify } from "jose";
import { getSecret } from "./jwt-key";
import { ApiError } from "./api-errors";

const attributes = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "lax",
} as const;
export function setAttempt(cookies: Cookies, purpose: string, id: string) {
  cookies.set(`__Host-gla-${purpose}`, id, { ...attributes, maxAge: 300 });
}
export function getAttempt(cookies: Cookies, purpose: string) {
  const id = cookies.get(`__Host-gla-${purpose}`);
  if (!id) throw new ApiError("challenge_expired");
  return id;
}
export async function setRecoveryCookie(
  cookies: Cookies,
  userId: number,
  generation: number,
) {
  const token = await new SignJWT({ generation })
    .setSubject(String(userId))
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("glatasks-recovery")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
  cookies.set("__Host-gla-recovery", token, { ...attributes, maxAge: 900 });
}
export async function readRecoveryCookie(cookies: Cookies) {
  try {
    const token = cookies.get("__Host-gla-recovery");
    if (!token) throw new ApiError("auth_failed");
    const result = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
      audience: "glatasks-recovery",
    });
    const id = Number(result.payload.sub);
    const generation = result.payload.generation;
    if (!Number.isSafeInteger(id) || id <= 0 || typeof generation !== "number")
      throw new ApiError("auth_failed");
    return { id, generation };
  } catch {
    throw new ApiError("auth_failed");
  }
}
export function clearRecoveryCookie(cookies: Cookies) {
  cookies.delete("__Host-gla-recovery", attributes);
}
