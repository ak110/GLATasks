import { expect, type Page } from "@playwright/test";

export type Availability =
  "available" | "downloadable" | "downloading" | "unavailable";

export type StubOptions = {
  detectorLanguage?: string;
  detectorLanguages?: string[];
  detectorAvailability?: Availability;
  translatorAvailability?: Availability;
  translatorAvailabilityByDirection?: {
    nativeToForeign?: Availability;
    foreignToNative?: Availability;
  };
  promptAvailability?: Availability;
  includeTranslator?: boolean;
  includePrompt?: boolean;
  detectorCreateError?: string;
  translatorCreateError?: string;
  promptCreateError?: string;
  blockFirstTranslation?: boolean;
  blockDetectorCreate?: boolean;
};

export type TranslateTestState = {
  detectorCreateCount: number;
  detectorCreateActivationIds: number[];
  translatorCreateCount: number;
  translatorCreatePairs: string[];
  translatorCreateActivationIds: number[];
  promptCreateCount: number;
  promptCreateActivationIds: number[];
  promptCloneCount: number;
  promptDestroyCount: number;
  translationInputs: string[];
  promptInputs: string[];
  promptExpectedInputs: string[][];
  firstTranslationAborted: boolean;
  detectorCreateBlocked: boolean;
  promptAvailabilityCount: number;
};

type TranslateTestWindow = Window & {
  __translateTestState: TranslateTestState;
  __translateTestReleaseDetectorCreate: () => void;
};

const defaultStubOptions: Required<
  Pick<
    StubOptions,
    | "detectorAvailability"
    | "translatorAvailability"
    | "promptAvailability"
    | "includeTranslator"
    | "includePrompt"
  >
> = {
  detectorAvailability: "available",
  translatorAvailability: "available",
  promptAvailability: "available",
  includeTranslator: true,
  includePrompt: true,
};

export async function installAiStubs(
  page: Page,
  options: StubOptions = {},
): Promise<void> {
  const stubOptions = { ...defaultStubOptions, ...options };
  await page.addInitScript((options) => {
    const {
      detectorLanguage,
      detectorLanguages,
      detectorAvailability,
      translatorAvailability,
      translatorAvailabilityByDirection,
      promptAvailability,
      includeTranslator,
      includePrompt,
      detectorCreateError,
      translatorCreateError,
      promptCreateError,
      blockFirstTranslation,
      blockDetectorCreate,
    } = options;
    let releaseDetectorCreate: (() => void) | undefined;
    let detectorDetectionCount = 0;
    let activationSequence = 0;
    let activeActivationId = 0;
    document.addEventListener(
      "click",
      () => {
        activeActivationId = ++activationSequence;
        const activationId = activeActivationId;
        setTimeout(() => {
          if (activeActivationId === activationId) activeActivationId = 0;
        }, 0);
      },
      true,
    );
    const state: TranslateTestState = {
      detectorCreateCount: 0,
      detectorCreateActivationIds: [],
      translatorCreateCount: 0,
      translatorCreatePairs: [],
      translatorCreateActivationIds: [],
      promptCreateCount: 0,
      promptCreateActivationIds: [],
      promptCloneCount: 0,
      promptDestroyCount: 0,
      translationInputs: [],
      promptInputs: [],
      promptExpectedInputs: [],
      firstTranslationAborted: false,
      detectorCreateBlocked: false,
      promptAvailabilityCount: 0,
    };
    Object.assign(globalThis, {
      __translateTestState: state,
      __translateTestReleaseDetectorCreate: () => {
        releaseDetectorCreate?.();
        releaseDetectorCreate = undefined;
      },
    });

    function notifyProgress(
      monitor:
        | ((monitor: {
            addEventListener: (
              type: string,
              listener: (event: { loaded: number }) => void,
            ) => void;
          }) => void)
        | undefined,
    ) {
      monitor?.({
        addEventListener: (_type, listener) => listener({ loaded: 1 }),
      });
    }

    function makeStream(
      chunks: string[],
      signal: AbortSignal | undefined,
      block: boolean,
    ): ReadableStream<string> {
      return new ReadableStream({
        start(controller) {
          if (block) {
            signal?.addEventListener(
              "abort",
              () => {
                state.firstTranslationAborted = true;
                controller.error(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
            return;
          }
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      });
    }

    function getTranslatorAvailability(
      sourceLanguage: string,
      targetLanguage: string,
    ): Availability {
      if (sourceLanguage === "ja" && targetLanguage === "en") {
        return (
          translatorAvailabilityByDirection?.nativeToForeign ??
          translatorAvailability
        );
      }
      if (sourceLanguage === "en" && targetLanguage === "ja") {
        return (
          translatorAvailabilityByDirection?.foreignToNative ??
          translatorAvailability
        );
      }
      return translatorAvailability;
    }

    class TestTranslator {
      readonly sourceLanguage: string;
      readonly targetLanguage: string;

      constructor(sourceLanguage: string, targetLanguage: string) {
        this.sourceLanguage = sourceLanguage;
        this.targetLanguage = targetLanguage;
      }

      static async availability(options: {
        sourceLanguage: string;
        targetLanguage: string;
      }) {
        return getTranslatorAvailability(
          options.sourceLanguage,
          options.targetLanguage,
        );
      }

      static async create(options: {
        sourceLanguage: string;
        targetLanguage: string;
        monitor?: (monitor: unknown) => void;
      }) {
        state.translatorCreateCount += 1;
        state.translatorCreatePairs.push(
          `${options.sourceLanguage}>${options.targetLanguage}`,
        );
        state.translatorCreateActivationIds.push(activeActivationId);
        if (
          getTranslatorAvailability(
            options.sourceLanguage,
            options.targetLanguage,
          ) === "downloadable" &&
          (activeActivationId === 0 || !navigator.userActivation.isActive)
        ) {
          throw new Error("missing transient activation");
        }
        if (translatorCreateError) throw new Error(translatorCreateError);
        notifyProgress(options.monitor as never);
        return new TestTranslator(
          options.sourceLanguage,
          options.targetLanguage,
        );
      }

      translateStreaming(
        input: string,
        options: { signal?: AbortSignal } = {},
      ) {
        state.translationInputs.push(input);
        const block =
          Boolean(blockFirstTranslation) &&
          state.translationInputs.length === 1;
        return makeStream(
          [`[${this.sourceLanguage}>${this.targetLanguage}] `, input],
          options.signal,
          block,
        );
      }

      destroy() {}
    }

    class TestDetector {
      static async availability() {
        return detectorAvailability;
      }

      static async create(options: { monitor?: unknown }) {
        state.detectorCreateCount += 1;
        state.detectorCreateActivationIds.push(activeActivationId);
        if (
          detectorAvailability === "downloadable" &&
          (activeActivationId === 0 || !navigator.userActivation.isActive)
        ) {
          throw new Error("missing transient activation");
        }
        if (detectorCreateError) throw new Error(detectorCreateError);
        if (blockDetectorCreate && state.detectorCreateCount === 1) {
          state.detectorCreateBlocked = true;
          await new Promise<void>((resolve) => {
            releaseDetectorCreate = resolve;
          });
          state.detectorCreateBlocked = false;
        }
        notifyProgress(options.monitor as never);
        return new TestDetector();
      }

      async detect(_input: string, _options: { signal?: AbortSignal } = {}) {
        const detectedLanguage =
          detectorLanguages?.[detectorDetectionCount++] ??
          detectorLanguage ??
          "ja";
        return [
          {
            detectedLanguage,
            confidence: 1,
          },
        ];
      }

      destroy() {}
    }

    class TestPromptSession {
      async clone() {
        state.promptCloneCount += 1;
        return new TestPromptSession();
      }

      promptStreaming(input: string, options: { signal?: AbortSignal } = {}) {
        state.promptInputs.push(input);
        return makeStream(["[prompt] ", input], options.signal, false);
      }

      destroy() {
        state.promptDestroyCount += 1;
      }
    }

    class TestLanguageModel {
      static async availability(_options: {
        expectedInputs?: { languages: string[] }[];
      }) {
        state.promptAvailabilityCount += 1;
        return promptAvailability;
      }

      static async create(options: {
        expectedInputs?: { languages: string[] }[];
        monitor?: unknown;
      }) {
        state.promptCreateCount += 1;
        state.promptCreateActivationIds.push(activeActivationId);
        if (
          promptAvailability === "downloadable" &&
          (activeActivationId === 0 || !navigator.userActivation.isActive)
        ) {
          throw new Error("missing transient activation");
        }
        if (promptCreateError) throw new Error(promptCreateError);
        state.promptExpectedInputs.push(
          options.expectedInputs?.[0]?.languages ?? [],
        );
        notifyProgress(options.monitor as never);
        return new TestPromptSession();
      }
    }

    Object.assign(globalThis, {
      Translator: includeTranslator ? TestTranslator : undefined,
      LanguageDetector: includeTranslator ? TestDetector : undefined,
      LanguageModel: includePrompt ? TestLanguageModel : undefined,
    });
  }, stubOptions);
}

export async function openStubbedPage(
  page: Page,
  options: StubOptions = {},
): Promise<void> {
  await installAiStubs(page, options);
  await page.goto("/translate");
  await expectStubbedPageReady(page, options);
}

export async function expectStubbedPageReady(
  page: Page,
  options: StubOptions = {},
): Promise<void> {
  await expect(page.getByTestId("translate-native-input")).toHaveValue(
    "日本語",
  );
  await expect(page.getByTestId("translate-foreign-input")).toHaveValue("英語");
  const includeTranslator =
    options.includeTranslator ?? defaultStubOptions.includeTranslator;
  const includePrompt =
    options.includePrompt ?? defaultStubOptions.includePrompt;
  if (includeTranslator && includePrompt) {
    await expect(page.getByTestId("translate-engine-select")).toBeVisible();
  } else if (includePrompt) {
    await expect(page.getByTestId("translate-engine-select")).toBeVisible();
    await expect(page.getByTestId("translate-engine-select")).toHaveValue(
      "prompt",
    );
  }
  await expect(page.getByTestId("translate-source-input")).toBeEnabled();
}

export async function openUnsupportedPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.assign(globalThis, {
      Translator: undefined,
      LanguageDetector: undefined,
      LanguageModel: undefined,
    });
  });
  await page.goto("/translate");
  await expect(page.getByTestId("translate-native-input")).toHaveValue(
    "日本語",
  );
  await expect(page.getByTestId("translate-foreign-input")).toHaveValue("英語");
}

export async function getState(page: Page): Promise<TranslateTestState> {
  return page.evaluate(() => {
    const state = (window as unknown as TranslateTestWindow)
      .__translateTestState;
    return {
      detectorCreateCount: state.detectorCreateCount,
      detectorCreateActivationIds: [...state.detectorCreateActivationIds],
      translatorCreateCount: state.translatorCreateCount,
      translatorCreatePairs: [...state.translatorCreatePairs],
      translatorCreateActivationIds: [...state.translatorCreateActivationIds],
      promptCreateCount: state.promptCreateCount,
      promptCreateActivationIds: [...state.promptCreateActivationIds],
      promptCloneCount: state.promptCloneCount,
      promptDestroyCount: state.promptDestroyCount,
      translationInputs: [...state.translationInputs],
      promptInputs: [...state.promptInputs],
      promptExpectedInputs: state.promptExpectedInputs.map((languages) => [
        ...languages,
      ]),
      firstTranslationAborted: state.firstTranslationAborted,
      detectorCreateBlocked: state.detectorCreateBlocked,
      promptAvailabilityCount: state.promptAvailabilityCount,
    };
  });
}

export async function releaseDetectorCreate(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as TranslateTestWindow
    ).__translateTestReleaseDetectorCreate();
  });
}

export async function translateAutomatically(
  page: Page,
  text: string,
  expectedText: string,
): Promise<void> {
  await page.getByTestId("translate-source-input").fill(text);
  await expect(page.getByTestId("translate-prepare-btn")).toHaveCount(0);
  await expect(page.getByTestId("translate-target-output")).toHaveValue(
    expectedText,
    { timeout: 5000 },
  );
}

export async function prepareTranslator(
  page: Page,
  text: string,
  expectedText: string,
): Promise<void> {
  await page.getByTestId("translate-source-input").fill(text);
  const prepareButton = page.getByTestId("translate-prepare-btn");
  await expect(prepareButton).toBeVisible({ timeout: 5000 });
  await prepareButton.click();
  await expect(page.getByTestId("translate-target-output")).toHaveValue(
    expectedText,
    { timeout: 5000 },
  );
}
