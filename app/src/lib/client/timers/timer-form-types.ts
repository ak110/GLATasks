import type { RouterInputs } from "#lib/client/trpc.ts";

type CreateTimerInput = RouterInputs["timers"]["create"];

export type TimerFormSubmission = Required<
  Pick<
    CreateTimerInput,
    "name" | "mode" | "baseSeconds" | "adjustMinutes" | "ringSeconds"
  >
> & {
  targetMinutes: NonNullable<CreateTimerInput["targetMinutes"]> | null;
  tzOffsetMinutes: NonNullable<CreateTimerInput["tzOffsetMinutes"]> | null;
};
