import type { RouterInputs } from "#lib/client/trpc.ts";

export type TaskAddSubmission = Required<
  Pick<RouterInputs["tasks"]["create"], "text" | "tags" | "kind">
> & { attachments: File[] };

export type TaskEditSubmission = Required<
  Pick<RouterInputs["tasks"]["update"], "text" | "tags" | "kind">
> & {
  moveTo: string;
  completed: boolean;
  closeAfter: boolean;
};
