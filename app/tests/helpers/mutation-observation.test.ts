import { expect, test } from "@playwright/test";
import {
  classifyMutationObservation,
  MUTATION_DIAGNOSTIC_PREFIX,
  selectMutationDiagnosticObservation,
  serializeMutationDiagnostic,
  type MutationObservation,
} from "./mutation-observation";

const FIXED_FIELDS = [
  "procedure",
  "startedAt",
  "uiDeadlineAt",
  "responseAt",
  "httpStatus",
  "trpcOutcome",
  "uiObservedAt",
  "classification",
];

const baseObservation: MutationObservation = {
  procedure: "attachments.create",
  startedAt: 1000,
  uiDeadlineAt: 16000,
  responseAt: null,
  httpStatus: null,
  trpcOutcome: null,
  uiObservedAt: null,
};

function parseDiagnostic(serialized: string): Record<string, unknown> {
  const payload = JSON.parse(
    serialized.slice(MUTATION_DIAGNOSTIC_PREFIX.length),
  ) as unknown;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("診断JSONがオブジェクトではありません");
  }
  return payload as Record<string, unknown>;
}

test.describe("mutation診断分類", () => {
  test("複数観測では先行成功より後続エラーを優先する", () => {
    const success: MutationObservation = {
      ...baseObservation,
      responseAt: 1100,
      httpStatus: 200,
      trpcOutcome: "ok",
    };
    const failure: MutationObservation = {
      ...baseObservation,
      responseAt: 1200,
      httpStatus: 413,
      trpcOutcome: "error",
    };

    expect(selectMutationDiagnosticObservation([success, failure])).toBe(
      failure,
    );
  });

  test("エラー観測が無い場合は未応答観測を優先する", () => {
    const success: MutationObservation = {
      ...baseObservation,
      responseAt: 1100,
      httpStatus: 200,
      trpcOutcome: "ok",
    };
    const pending: MutationObservation = { ...baseObservation };

    expect(selectMutationDiagnosticObservation([success, pending])).toBe(
      pending,
    );
  });

  test("応答がUI期限までに完了しない場合を分類する", () => {
    const serialized = serializeMutationDiagnostic(baseObservation);
    const payload = parseDiagnostic(serialized);

    expect(serialized.startsWith(MUTATION_DIAGNOSTIC_PREFIX)).toBe(true);
    expect(Object.keys(payload)).toEqual(FIXED_FIELDS);
    expect(payload).toEqual({
      procedure: "attachments.create",
      startedAt: 1000,
      uiDeadlineAt: 16000,
      responseAt: null,
      httpStatus: null,
      trpcOutcome: null,
      uiObservedAt: null,
      classification: "response_pending_at_ui_deadline",
    });
  });

  test("期限前のtRPCエラー応答後にUIが無い場合を分類する", () => {
    const observation: MutationObservation = {
      ...baseObservation,
      responseAt: 1200,
      httpStatus: 413,
      trpcOutcome: "error",
    };
    const serialized = serializeMutationDiagnostic(observation);
    const payload = parseDiagnostic(serialized);

    expect(classifyMutationObservation(observation)).toBe(
      "response_error_before_ui_deadline",
    );
    expect(Object.keys(payload)).toEqual(FIXED_FIELDS);
    expect(payload).toEqual({
      procedure: "attachments.create",
      startedAt: 1000,
      uiDeadlineAt: 16000,
      responseAt: 1200,
      httpStatus: 413,
      trpcOutcome: "error",
      uiObservedAt: null,
      classification: "response_error_before_ui_deadline",
    });
  });

  test("成功応答後にUIが無い場合を分類する", () => {
    const observation: MutationObservation = {
      ...baseObservation,
      responseAt: 1200,
      httpStatus: 200,
      trpcOutcome: "ok",
    };
    const serialized = serializeMutationDiagnostic(observation);
    const payload = parseDiagnostic(serialized);

    expect(classifyMutationObservation(observation)).toBe(
      "response_ok_ui_missing",
    );
    expect(Object.keys(payload)).toEqual(FIXED_FIELDS);
    expect(payload).toEqual({
      procedure: "attachments.create",
      startedAt: 1000,
      uiDeadlineAt: 16000,
      responseAt: 1200,
      httpStatus: 200,
      trpcOutcome: "ok",
      uiObservedAt: null,
      classification: "response_ok_ui_missing",
    });
  });
});
