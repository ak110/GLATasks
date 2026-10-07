import { getJwtSecret } from "./env";

export function getJwtKey(): Uint8Array {
  return Uint8Array.from(atob(getJwtSecret()), (c) => c.codePointAt(0)!);
}
