import type { Page, Response } from "@playwright/test";

export const MUTATION_DIAGNOSTIC_PREFIX = "E2E_MUTATION_DIAGNOSTIC ";
export const MUTATION_UI_DEADLINE_MS = 15_000;

export type MutationTrpcOutcome = "ok" | "error" | null;

export type MutationDiagnosticClassification =
  | "response_pending_at_ui_deadline"
  | "response_error_before_ui_deadline"
  | "response_ok_ui_missing";

export type MutationObservation = {
  procedure: string;
  startedAt: number;
  uiDeadlineAt: number;
  responseAt: number | null;
  httpStatus: number | null;
  trpcOutcome: MutationTrpcOutcome;
  uiObservedAt: number | null;
};

export type MutationDiagnostic = MutationObservation & {
  classification: MutationDiagnosticClassification;
};

/** UI期限時点の応答状態から、添付操作の失敗境界を分類する純粋関数 */
export function classifyMutationObservation(
  observation: Pick<
    MutationObservation,
    "responseAt" | "uiDeadlineAt" | "trpcOutcome"
  >,
): MutationDiagnosticClassification {
  if (
    observation.responseAt === null ||
    observation.responseAt > observation.uiDeadlineAt
  ) {
    return "response_pending_at_ui_deadline";
  }
  if (observation.trpcOutcome === "error") {
    return "response_error_before_ui_deadline";
  }
  return "response_ok_ui_missing";
}

/** 固定8項目の診断値を作成する */
export function createMutationDiagnostic(
  observation: MutationObservation,
): MutationDiagnostic {
  return {
    ...observation,
    classification: classifyMutationObservation(observation),
  };
}

/** Playwrightの失敗出力へ渡す1行JSONを作成する */
export function serializeMutationDiagnostic(
  observation: MutationObservation,
): string {
  const diagnostic = createMutationDiagnostic(observation);
  return `${MUTATION_DIAGNOSTIC_PREFIX}${JSON.stringify({
    procedure: diagnostic.procedure,
    startedAt: diagnostic.startedAt,
    uiDeadlineAt: diagnostic.uiDeadlineAt,
    responseAt: diagnostic.responseAt,
    httpStatus: diagnostic.httpStatus,
    trpcOutcome: diagnostic.trpcOutcome,
    uiObservedAt: diagnostic.uiObservedAt,
    classification: diagnostic.classification,
  })}`;
}

export type MutationObservationTracker = {
  observations: MutationObservation[];
  responses: Promise<Response>[];
  markUiObserved: (observedAt?: number) => void;
  serializeDiagnostic: (index?: number) => string;
  stop: () => void;
};

function getProcedureIndexes(response: Response, procedure: string): number[] {
  const pathname = new URL(response.url()).pathname;
  const prefix = "/api/trpc/";
  if (!pathname.startsWith(prefix)) return [];
  return pathname
    .slice(prefix.length)
    .split(",")
    .flatMap((name, index) => (name === procedure ? [index] : []));
}

async function getTrpcOutcome(
  response: Response,
  batchIndex: number,
): Promise<Exclude<MutationTrpcOutcome, null>> {
  if (!response.ok()) return "error";
  try {
    const body = (await response.json()) as unknown;
    const item = Array.isArray(body) ? body[batchIndex] : body;
    return typeof item === "object" && item !== null && "error" in item
      ? "error"
      : "ok";
  } catch {
    return "error";
  }
}

/** 指定procedureの応答を操作開始前から記録する */
export function observeMutationResponses(
  page: Page,
  procedure: string,
  count = 1,
  startedAt = Date.now(),
): MutationObservationTracker {
  if (count < 1 || !Number.isInteger(count)) {
    throw new Error("mutation応答の観測数は1以上の整数で指定してください");
  }

  const observations: MutationObservation[] = Array.from(
    { length: count },
    () => ({
      procedure,
      startedAt,
      uiDeadlineAt: startedAt + MUTATION_UI_DEADLINE_MS,
      responseAt: null,
      httpStatus: null,
      trpcOutcome: null,
      uiObservedAt: null,
    }),
  );

  let nextIndex = 0;
  const resolvers: Array<(response: Response) => void> = [];
  const responses = observations.map(
    () =>
      new Promise<Response>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  const responseHandler = (response: Response): void => {
    if (nextIndex >= observations.length) return;
    const procedureIndexes = getProcedureIndexes(response, procedure);
    for (const batchIndex of procedureIndexes) {
      const observation = observations[nextIndex];
      const resolve = resolvers[nextIndex];
      if (!observation || !resolve) return;

      observation.httpStatus = response.status();
      nextIndex += 1;
      void getTrpcOutcome(response, batchIndex).then((outcome) => {
        observation.responseAt = Date.now();
        observation.trpcOutcome = outcome;
        resolve(response);
      });
    }
  };
  page.on("response", responseHandler);

  return {
    observations,
    responses,
    markUiObserved: (observedAt = Date.now()) => {
      for (const observation of observations) {
        observation.uiObservedAt = observedAt;
      }
    },
    serializeDiagnostic: (index = 0) => {
      const observation = observations[index];
      if (!observation) {
        throw new Error(`mutation観測の対象が存在しません: ${index}`);
      }
      return serializeMutationDiagnostic(observation);
    },
    stop: () => page.off("response", responseHandler),
  };
}
