import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { Cookies } from "@sveltejs/kit";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

/** DB試験では署名検証を差し替えず、試験が所有するソフトウェア認証器で署名する。 */
export function authenticator() {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = keys.publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  const publicKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );
  const encode = (value: Uint8Array) =>
    Buffer.from(value).toString("base64url");
  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
    );
  return {
    id: encode(id),
    register(
      challenge: string,
      origin = "https://example.test",
      rp = "example.test",
    ): RegistrationResponseJSON {
      const size = Buffer.alloc(2);
      size.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        createHash("sha256").update(rp).digest(),
        Buffer.from([0x45]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        size,
        id,
        publicKey,
      ]);
      return {
        id: encode(id),
        rawId: encode(id),
        type: "public-key",
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          clientDataJSON: encode(
            clientData("webauthn.create", challenge, origin),
          ),
          attestationObject: encode(
            isoCBOR.encode(
              new Map<string, string | Uint8Array | Map<string, string>>([
                ["fmt", "none"],
                ["authData", authData],
                ["attStmt", new Map()],
              ]),
            ),
          ),
          transports: ["internal"],
        },
      };
    },
    authenticate(
      challenge: string,
      handle: string,
      origin = "https://example.test",
      rp = "example.test",
    ): AuthenticationResponseJSON {
      const client = clientData("webauthn.get", challenge, origin);
      const authData = Buffer.concat([
        createHash("sha256").update(rp).digest(),
        Buffer.from([5]),
        Buffer.alloc(4),
      ]);
      return {
        id: encode(id),
        rawId: encode(id),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: encode(client),
          authenticatorData: encode(authData),
          userHandle: handle,
          signature: encode(
            sign(
              "sha256",
              Buffer.concat([
                authData,
                createHash("sha256").update(client).digest(),
              ]),
              keys.privateKey,
            ),
          ),
        },
      };
    },
  };
}

export function cookieJar() {
  const values = new Map<string, string>();
  const cookies = {
    get: (name: string) => values.get(name),
    set: (name: string, value: string) => {
      values.set(name, value);
    },
    delete: (name: string) => {
      values.delete(name);
    },
  } as unknown as Cookies;
  return { cookies, values };
}
