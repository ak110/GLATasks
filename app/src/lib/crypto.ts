/**
 * @fileoverview ブラウザ側 AES-GCM 暗号化
 */

/**
 * 暗号化
 */
export async function encrypt(
  plaintext: string,
  keyString: string,
): Promise<string> {
  const keyBuffer = Uint8Array.from(globalThis.atob(keyString), (c) =>
    c.codePointAt(0)!,
  );
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const full = new Uint8Array(12 + encrypted.byteLength);
  full.set(iv);
  full.set(new Uint8Array(encrypted), 12);
  let binary = "";
  for (const byte of full) binary += String.fromCodePoint(byte);
  return globalThis.btoa(binary);
}

/**
 * 復号
 */
export async function decrypt(
  ciphertext: string,
  keyString: string,
): Promise<string> {
  const keyBuffer = Uint8Array.from(globalThis.atob(keyString), (c) =>
    c.codePointAt(0)!,
  );
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const data = Uint8Array.from(globalThis.atob(ciphertext), (c) =>
    c.codePointAt(0)!,
  );
  const iv = data.slice(0, 12);
  const encryptedData = data.slice(12);
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedData,
  );
  return new TextDecoder().decode(decrypted);
}
