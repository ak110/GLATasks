import { flushSync } from "svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as client from "./translate-client.ts";
import { createTranslationController } from "./translate-controller.svelte.ts";

vi.mock("./translate-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof client>()),
  detectEngineAvailability: vi.fn(),
  prepareEngine: vi.fn(),
  runTranslation: vi.fn(),
}));

let controller: ReturnType<typeof createTranslationController>;
let cleanup: () => void;
const run = vi.mocked(client.runTranslation);
const prepare = vi.mocked(client.prepareEngine);
const target = {
  kind: "translator",
  sourceText: "second",
  nativeLanguage: "ja",
  foreignLanguage: "en",
  sourceLanguage: "ja",
  targetLanguage: "en",
  direction: "native-to-foreign",
  availability: "downloadable",
  requiresDirectionChoice: true,
  requiresUserActivation: false,
} as const satisfies client.TranslationPreparationTarget;

async function debounce() {
  flushSync();
  await vi.advanceTimersByTimeAsync(600);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(client.detectEngineAvailability).mockResolvedValue(["translator"]);
  cleanup = $effect.root(() => {
    controller = createTranslationController();
  });
  expect(controller.initialized).toBe(false);
  controller.initialize();
  flushSync();
  await Promise.resolve();
  flushSync();
  expect(controller.availabilityReady).toBe(true);
});

afterEach(() => {
  controller.destroy();
  cleanup();
  vi.useRealTimers();
});

it("途中で準備待ちになり、失敗から再試行して準備箇所から翻訳を再開する", async () => {
  run.mockImplementationOnce(async (...args) => {
    args[5]?.("訳文1");
    return { status: "translated" };
  });
  run.mockResolvedValueOnce({ status: "prepare", preparation: [target] });
  controller.handleSourceInput("first\n\nsecond");
  await debounce();
  expect(controller.pendingPreparation?.translationIndex).toBe(1);
  expect(controller.isPreparing).toBe(false);

  prepare.mockRejectedValueOnce(new Error("準備失敗"));
  await controller.handlePrepare();
  expect(controller.displayedStatus).toContain("準備失敗");
  expect(controller.pendingPreparation?.translationIndex).toBe(1);
  expect(controller.isPreparing).toBe(false);

  const ready =
    Promise.withResolvers<Awaited<ReturnType<typeof client.prepareEngine>>>();
  prepare.mockImplementationOnce((options) => {
    options.onProgress?.(0.25);
    return ready.promise;
  });
  const preparing = controller.handlePrepare();
  expect(controller.isPreparing).toBe(true);
  expect(controller.preparationProgress).toBe(25);
  run.mockImplementationOnce(async (...args) => {
    args[5]?.("訳文2");
    return { status: "translated" };
  });
  ready.resolve(undefined);
  await preparing;
  await debounce();
  expect(run).toHaveBeenCalledTimes(3);
  expect(run.mock.calls[2]?.[0]).toBe("second");
  expect(controller.targetText).toBe("訳文1\n\n訳文2");
  expect(controller.pendingPreparation).toBeUndefined();
  expect(controller.preparationProgress).toBeUndefined();
});

it.each(["source", "language", "destroy"] as const)(
  "準備中の %s 後は古い進捗や完了を反映しない",
  async (operation) => {
    run.mockResolvedValueOnce({ status: "prepare", preparation: [target] });
    controller.handleSourceInput("old");
    await debounce();
    const ready =
      Promise.withResolvers<Awaited<ReturnType<typeof client.prepareEngine>>>();
    prepare.mockReturnValueOnce(ready.promise);
    const preparing = controller.handlePrepare();
    if (operation === "source") controller.handleSourceInput("new");
    if (operation === "language") controller.handleForeignLanguageInput("fr");
    if (operation === "destroy") controller.destroy();
    prepare.mock.calls[0]?.[0].onProgress?.(0.9);
    expect(controller.preparationProgress).not.toBe(90);
    run.mockResolvedValue({ status: "translated" });
    await debounce();
    ready.resolve(undefined);
    await preparing;
    await debounce();
    expect(
      run.mock.calls.slice(1).map(([text, , foreign]) => [text, foreign]),
    ).toEqual(
      operation === "source"
        ? [["new", controller.foreignLanguage]]
        : operation === "language"
          ? [["old", "fr"]]
          : [],
    );
    expect(controller.pendingPreparation).toBeUndefined();
  },
);

it("同じ原文を伝える入力イベントが続いても予約を取り消さない", async () => {
  run.mockResolvedValueOnce({ status: "translated" });
  controller.handleSourceInput("原文");
  flushSync();
  controller.handleSourceInput("原文");
  await debounce();
  expect(run).toHaveBeenCalledExactlyOnceWith(
    "原文",
    controller.nativeLanguage,
    controller.foreignLanguage,
    "translator",
    expect.any(AbortSignal),
    expect.any(Function),
    undefined,
  );
});

it("翻訳実行中に原文を変えると古いストリームと完了を無視する", async () => {
  const result =
    Promise.withResolvers<Awaited<ReturnType<typeof client.runTranslation>>>();
  run.mockReturnValueOnce(result.promise);
  controller.handleSourceInput("old");
  await debounce();
  controller.handleSourceInput("new");
  expect(run.mock.calls[0]?.[4]?.aborted).toBe(true);
  run.mock.calls[0]?.[5]?.("古い訳文");
  result.resolve({ status: "prepare", preparation: [target] });
  run.mockImplementationOnce(async (...args) => {
    args[5]?.("新しい訳文");
    return { status: "translated" };
  });
  await debounce();
  expect(controller.targetText).toBe("新しい訳文");
  expect(controller.pendingPreparation).toBeUndefined();
});
