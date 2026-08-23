/**
 * @fileoverview 翻訳ページのe2eテスト
 */

import { expect, test, type Page } from "@playwright/test";

type StubOptions = {
  detectorLanguage?: string;
  blockFirstTranslation?: boolean;
  blockDetectorCreate?: boolean;
};

type TranslateTestState = {
  detectorCreateCount: number;
  translatorCreateCount: number;
  promptCreateCount: number;
  promptCloneCount: number;
  promptDestroyCount: number;
  translationInputs: string[];
  promptInputs: string[];
  promptExpectedInputs: string[][];
  firstTranslationAborted: boolean;
  detectorCreateBlocked: boolean;
  promptAvailabilityCount: number;
};

async function installAiStubs(
  page: Page,
  options: StubOptions = {},
): Promise<void> {
  await page.addInitScript((options) => {
    const { detectorLanguage, blockFirstTranslation, blockDetectorCreate } =
      options;
    let releaseDetectorCreate: (() => void) | undefined;
    const state: TranslateTestState = {
      detectorCreateCount: 0,
      translatorCreateCount: 0,
      promptCreateCount: 0,
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

    class TestTranslator {
      readonly sourceLanguage: string;
      readonly targetLanguage: string;

      constructor(sourceLanguage: string, targetLanguage: string) {
        this.sourceLanguage = sourceLanguage;
        this.targetLanguage = targetLanguage;
      }

      static async availability() {
        return "available";
      }

      static async create(options: {
        sourceLanguage: string;
        targetLanguage: string;
        monitor?: (monitor: unknown) => void;
      }) {
        state.translatorCreateCount += 1;
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
        return "available";
      }

      static async create(options: { monitor?: unknown }) {
        state.detectorCreateCount += 1;
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
        return [
          {
            detectedLanguage: detectorLanguage ?? "ja",
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
        return "available";
      }

      static async create(options: {
        expectedInputs?: { languages: string[] }[];
        monitor?: unknown;
      }) {
        state.promptCreateCount += 1;
        state.promptExpectedInputs.push(
          options.expectedInputs?.[0]?.languages ?? [],
        );
        notifyProgress(options.monitor as never);
        return new TestPromptSession();
      }
    }

    Object.assign(globalThis, {
      Translator: TestTranslator,
      LanguageDetector: TestDetector,
      LanguageModel: TestLanguageModel,
    });
  }, options);
}

async function openStubbedPage(
  page: Page,
  options: StubOptions = {},
): Promise<void> {
  await installAiStubs(page, options);
  await page.goto("/translate");
  await expectStubbedPageReady(page);
}

async function expectStubbedPageReady(page: Page): Promise<void> {
  await expect(page.getByTestId("translate-native-input")).toHaveValue(
    "日本語",
  );
  await expect(page.getByTestId("translate-foreign-input")).toHaveValue("英語");
  await expect(page.getByTestId("translate-engine-select")).toBeVisible();
  await expect(page.getByTestId("translate-source-input")).toBeEnabled();
}

async function openUnsupportedPage(page: Page): Promise<void> {
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

async function getState(page: Page): Promise<TranslateTestState> {
  return page.evaluate(() => {
    const state = (
      window as unknown as Window & {
        __translateTestState: TranslateTestState;
      }
    ).__translateTestState;
    return {
      detectorCreateCount: state.detectorCreateCount,
      translatorCreateCount: state.translatorCreateCount,
      promptCreateCount: state.promptCreateCount,
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

async function releaseDetectorCreate(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as Window & {
        __translateTestReleaseDetectorCreate: () => void;
      }
    ).__translateTestReleaseDetectorCreate();
  });
}

async function prepareTranslator(page: Page, text: string): Promise<void> {
  await page.getByTestId("translate-source-input").fill(text);
  const prepareButton = page.getByTestId("translate-prepare-btn");
  await expect(prepareButton).toBeVisible({ timeout: 5000 });
  await prepareButton.click();
  await expect
    .poll(async () => (await getState(page)).detectorCreateCount)
    .toBe(1);
  await expect(prepareButton).toBeVisible({ timeout: 5000 });
  await prepareButton.click();
  await expect(page.getByTestId("translate-target-output")).toHaveValue(
    `[ja>en] ${text}`,
    { timeout: 5000 },
  );
}

test.describe("translate", () => {
  test("ブラウザ内蔵AIに非対応の環境では入力を無効にする", async ({ page }) => {
    await openUnsupportedPage(page);
    await expect(page.getByTestId("translate-source-input")).toBeDisabled();
    await expect(page.getByTestId("translate-status")).toContainText(
      "ブラウザ内蔵の翻訳機能に対応していません",
    );
  });

  test.describe("スタブを注入した環境", () => {
    test.beforeEach(async ({ page }) => {
      await openStubbedPage(page);
    });

    test("母語の文章を相手言語へ自動翻訳する", async ({ page }) => {
      await prepareTranslator(page, "こんにちは");
    });

    test("母語以外の文章を母語へ自動翻訳する", async ({ page }) => {
      await installAiStubs(page, { detectorLanguage: "en" });
      await page.reload();
      await expectStubbedPageReady(page);
      await page.getByTestId("translate-source-input").fill("hello");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await prepareButton.click();
      await expect(prepareButton).toBeVisible();
      await prepareButton.click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[en>ja] hello",
        { timeout: 5000 },
      );
    });

    test("言語設定を保存して再訪時に復元する", async ({ page }) => {
      await page.getByTestId("translate-foreign-input").fill("フランス語");
      await page.reload();
      await expect(page.getByTestId("translate-foreign-input")).toHaveValue(
        "フランス語",
      );
    });

    test("Prompt APIの選択を保存して実行する", async ({ page }) => {
      const engineSelect = page.getByTestId("translate-engine-select");
      await engineSelect.selectOption("prompt");
      await page.reload();
      await expect(engineSelect).toHaveValue("prompt");
      await page.getByTestId("translate-source-input").fill("hello");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await prepareButton.click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[prompt] hello",
        { timeout: 5000 },
      );
      await expect
        .poll(async () => (await getState(page)).promptCreateCount)
        .toBe(1);
    });

    test("availableでも未作成インスタンスを自動生成しない", async ({
      page,
    }) => {
      await page.getByTestId("translate-source-input").fill("こんにちは");
      await expect(page.getByTestId("translate-prepare-btn")).toBeVisible();
      const state = await getState(page);
      expect(state.detectorCreateCount).toBe(0);
      expect(state.promptCreateCount).toBe(0);
    });

    test("検出器準備後に翻訳ペアの準備を求める", async ({ page }) => {
      await page.getByTestId("translate-source-input").fill("こんにちは");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await prepareButton.click();
      await expect
        .poll(async () => (await getState(page)).detectorCreateCount)
        .toBe(1);
      expect((await getState(page)).translatorCreateCount).toBe(0);
      await expect(prepareButton).toBeVisible();
      await expect(prepareButton).toContainText("ja→en");
    });

    test("準備中の原文変更後は新しい原文を翻訳する", async ({ page }) => {
      await page.getByTestId("translate-source-input").fill("最初");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await expect(prepareButton).toBeVisible();
      await page.getByTestId("translate-source-input").fill("変更後");
      await expect(prepareButton).toBeEnabled({ timeout: 5000 });
      await prepareButton.click();
      await expect(prepareButton).toBeVisible();
      await prepareButton.click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] 変更後",
        { timeout: 5000 },
      );
    });

    test("準備中の言語設定変更後は新しい翻訳先を使う", async ({ page }) => {
      await page.getByTestId("translate-source-input").fill("こんにちは");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await prepareButton.click();
      await expect(prepareButton).toContainText("ja→en");
      await page.getByTestId("translate-foreign-input").fill("フランス語");
      await expect(prepareButton).toBeEnabled({ timeout: 5000 });
      await prepareButton.click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>fr] こんにちは",
        { timeout: 5000 },
      );
    });

    test("検出器の作成中に原文を変更しても最新の準備要求を保持する", async ({
      page,
    }) => {
      await installAiStubs(page, { blockDetectorCreate: true });
      await page.reload();
      await expectStubbedPageReady(page);
      await page.getByTestId("translate-source-input").fill("最初");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await prepareButton.click();
      await expect
        .poll(async () => (await getState(page)).detectorCreateBlocked)
        .toBe(true);
      await page.getByTestId("translate-source-input").fill("変更後");
      await expect(page.getByTestId("translate-status")).toContainText(
        "準備が必要です",
        { timeout: 5000 },
      );
      await releaseDetectorCreate(page);
      await expect(prepareButton).toBeEnabled();
      await prepareButton.click();
      await expect(prepareButton).toContainText("ja→en");
      await prepareButton.click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] 変更後",
        { timeout: 5000 },
      );
    });

    test("検出器の作成中に言語設定を変更しても最新の準備要求を保持する", async ({
      page,
    }) => {
      await installAiStubs(page, { blockDetectorCreate: true });
      await page.reload();
      await expectStubbedPageReady(page);
      await page.getByTestId("translate-source-input").fill("こんにちは");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await prepareButton.click();
      await expect
        .poll(async () => (await getState(page)).detectorCreateBlocked)
        .toBe(true);
      await page.getByTestId("translate-foreign-input").fill("フランス語");
      await expect(page.getByTestId("translate-status")).toContainText(
        "準備が必要です",
        { timeout: 5000 },
      );
      await releaseDetectorCreate(page);
      await expect(prepareButton).toBeEnabled();
      await prepareButton.click();
      await expect(prepareButton).toContainText("ja→fr");
      await prepareButton.click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>fr] こんにちは",
        { timeout: 5000 },
      );
    });

    test("Promptセッションを実行ごとに分離する", async ({ page }) => {
      await page.getByTestId("translate-engine-select").selectOption("prompt");
      await page.getByTestId("translate-source-input").fill("最初の文章");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await prepareButton.click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[prompt] 最初の文章",
        { timeout: 5000 },
      );
      await page.getByTestId("translate-source-input").fill("次の文章");
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[prompt] 次の文章",
        { timeout: 5000 },
      );
      const state = await getState(page);
      expect(state.promptCloneCount).toBe(2);
      expect(state.promptDestroyCount).toBe(2);
      expect(state.promptInputs).toEqual(["最初の文章", "次の文章"]);
    });

    test("前回の翻訳をAbortSignalで中断する", async ({ page }) => {
      await installAiStubs(page, { blockFirstTranslation: true });
      await page.reload();
      await expectStubbedPageReady(page);
      await prepareTranslator(page, "最初の文章").catch(() => undefined);
      await page.getByTestId("translate-source-input").fill("次の文章");
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] 次の文章",
        { timeout: 5000 },
      );
      const state = await getState(page);
      expect(state.firstTranslationAborted).toBe(true);
      expect(state.translationInputs).toContain("次の文章");
    });

    test("Prompt API非対応の言語設定ではPromptを隠す", async ({ page }) => {
      const availabilityCount = (await getState(page)).promptAvailabilityCount;
      for (const [foreignLanguage, status] of [
        ["中国語", "en・ja・es・de・fr"],
        ["存在しない言語", "言語タグ（en・fr）"],
      ] as const) {
        await page.getByTestId("translate-foreign-input").fill(foreignLanguage);
        await expect(page.getByTestId("translate-engine-select")).toHaveCount(
          0,
        );
        await expect(page.getByTestId("translate-status")).toContainText(
          status,
        );
      }
      const state = await getState(page);
      expect(state.promptAvailabilityCount).toBe(availabilityCount);
      expect(state.promptCreateCount).toBe(0);
    });

    test("設定外の対応言語をPrompt APIへ宣言する", async ({ page }) => {
      await page.getByTestId("translate-engine-select").selectOption("prompt");
      await page.getByTestId("translate-source-input").fill("hola");
      await page.getByTestId("translate-prepare-btn").click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[prompt] hola",
        { timeout: 5000 },
      );
      const state = await getState(page);
      expect(state.promptExpectedInputs.at(-1)).toEqual([
        "en",
        "ja",
        "es",
        "de",
        "fr",
      ]);
    });
  });
});
