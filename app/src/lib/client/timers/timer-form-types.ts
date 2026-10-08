import type { RouterInputs } from "#lib/client/trpc.ts";

type CreateTimerInput = RouterInputs["timers"]["create"];

/** 未入力の時刻はフォーム内でnullを使い、APIへ渡す際にundefinedへ変換する。 */
export type TimerFormSubmission = Required<
  Pick<
    CreateTimerInput,
    "name" | "mode" | "baseSeconds" | "adjustMinutes" | "ringSeconds"
  >
> & {
  targetMinutes: NonNullable<CreateTimerInput["targetMinutes"]> | null;
  tzOffsetMinutes: NonNullable<CreateTimerInput["tzOffsetMinutes"]> | null;
};
