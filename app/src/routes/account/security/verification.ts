import type { RouterInputs } from "#lib/client/trpc.ts";

type ManageInput = RouterInputs["security"]["manage"];

export type Proof = NonNullable<
  Extract<ManageInput, { action: "codes" }>["proof"]
>;
