import { z } from "zod";
import { RegisterUserSchema } from "#lib/schemas.ts";

const encoded = z
  .string()
  .min(1)
  .max(100_000)
  .regex(/^[A-Za-z0-9_-]+$/);
const credentialFields = {
  id: encoded,
  rawId: encoded,
  type: z.literal("public-key"),
  clientExtensionResults: z.object({
    credProps: z.object({ rk: z.boolean().optional() }).optional(),
  }),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
};
export const RegistrationResponseSchema = z.object({
  ...credentialFields,
  response: z.object({
    clientDataJSON: encoded,
    attestationObject: encoded,
    transports: z.array(z.string().max(32)).max(8).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: encoded.optional(),
    authenticatorData: encoded.optional(),
  }),
});
export const AuthenticationResponseSchema = z.object({
  ...credentialFields,
  response: z.object({
    clientDataJSON: encoded,
    authenticatorData: encoded,
    signature: encoded,
    userHandle: encoded.optional(),
  }),
});
export const PasskeyNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((s) => new TextEncoder().encode(s).length <= 400);
export const AuthProofSchema = z.union([
  z.object({ password: z.string().min(1).max(1000) }),
  z.object({ response: AuthenticationResponseSchema }),
]);
export const ManageSecuritySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("beginAdd"), proof: AuthProofSchema }),
  z.object({
    action: z.literal("finishAdd"),
    response: RegistrationResponseSchema,
    name: PasskeyNameSchema,
  }),
  z.object({
    action: z.literal("rename"),
    id: encoded,
    name: PasskeyNameSchema,
  }),
  z.object({
    action: z.literal("delete"),
    id: encoded,
    proof: AuthProofSchema,
  }),
  z.object({
    action: z.literal("password"),
    password: z.string().min(1).max(1000),
    proof: AuthProofSchema,
  }),
  z.object({ action: z.literal("prepareDisable"), proof: AuthProofSchema }),
  z.object({
    action: z.literal("confirmDisable"),
    attemptId: z.string().min(1).max(64),
    saved: z.literal(true),
  }),
  z.object({ action: z.literal("codes"), proof: AuthProofSchema }),
]);
export const PublicPasskeySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("beginRegister"),
    userId: RegisterUserSchema.shape.userId,
  }),
  z.object({
    action: z.literal("finishRegister"),
    response: RegistrationResponseSchema,
  }),
  z.object({ action: z.literal("beginLogin") }),
  z.object({
    action: z.literal("finishLogin"),
    response: AuthenticationResponseSchema,
  }),
  z.object({
    action: z.literal("recover"),
    userId: RegisterUserSchema.shape.userId,
    code: z.string().max(100),
  }),
  z.object({ action: z.literal("beginRecovery") }),
  z.object({
    action: z.literal("finishRecovery"),
    response: RegistrationResponseSchema,
  }),
]);
