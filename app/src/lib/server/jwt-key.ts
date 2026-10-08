import { getJwtSecret } from "./env";

export function getSecret(): Uint8Array {
  return Uint8Array.from(atob(getJwtSecret()), (c) => c.codePointAt(0)!);
}
