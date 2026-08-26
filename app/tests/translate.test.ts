/**
 * @fileoverview 翻訳ページのe2eテスト
 */

import { expect, test } from "@playwright/test";
import {
  expectStubbedPageReady,
  getState,
  installAiStubs,
  openStubbedPage,
  openUnsupportedPage,
  prepareTranslator,
  translateAutomatically,
} from "./helpers/translate-page";

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

    test("availableのTranslator APIは入力停止後に自動翻訳する", async ({
      page,
    }) => {
      await translateAutomatically(page, "こんにちは", "[ja>en] こんにちは");
      const state = await getState(page);
      expect(state.detectorCreateCount).toBe(1);
      expect(state.translatorCreateCount).toBe(1);
      expect(state.detectorCreateActivationIds).toEqual([0]);
      expect(state.translatorCreateActivationIds).toEqual([0]);
    });

    test("detector downloadable時は方向を選択した1クリックで翻訳する", async ({
      page,
    }) => {
      await installAiStubs(page, {
        detectorAvailability: "downloadable",
        translatorAvailability: "downloadable",
      });
      await page.reload();
      await expectStubbedPageReady(page);
      await page.getByTestId("translate-source-input").fill("こんにちは");
      const directionSelect = page.getByTestId("translate-direction-select");
      await expect(directionSelect).toBeVisible({ timeout: 5000 });
      await expect(directionSelect.locator("option")).toHaveCount(2);
      await directionSelect.selectOption("1");
      await expect(
        page.getByTestId("translate-direction-status"),
      ).toContainText("相手言語 → 母語");
      await page.getByTestId("translate-prepare-btn").click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[en>ja] こんにちは",
        { timeout: 5000 },
      );
      const state = await getState(page);
      expect(state.detectorCreateCount).toBe(0);
      expect(state.translatorCreateCount).toBe(1);
      expect(state.translatorCreatePairs).toEqual(["en>ja"]);
      expect(state.translatorCreateActivationIds[0]).toBeGreaterThan(0);
      await expect(
        page.getByTestId("translate-direction-status"),
      ).toContainText("相手言語 → 母語");

      await expect(directionSelect).toBeVisible();
      await directionSelect.selectOption("0");
      await expect(page.getByTestId("translate-prepare-btn")).toBeVisible();
      await page.getByTestId("translate-prepare-btn").click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] こんにちは",
        { timeout: 5000 },
      );
      await expect(
        page.getByTestId("translate-direction-status"),
      ).toContainText("母語 → 相手言語");
      const switchedState = await getState(page);
      expect(switchedState.detectorCreateCount).toBe(0);
      expect(switchedState.translatorCreateCount).toBe(2);
      expect(switchedState.translatorCreatePairs).toEqual(["en>ja", "ja>en"]);
    });

    test("detector available時はTranslator準備後も次の入力を自動検出する", async ({
      page,
    }) => {
      await installAiStubs(page, {
        detectorAvailability: "available",
        detectorLanguages: ["ja", "ja", "en"],
        translatorAvailabilityByDirection: {
          nativeToForeign: "downloadable",
          foreignToNative: "available",
        },
        includePrompt: false,
      });
      await page.reload();
      await expectStubbedPageReady(page, { includePrompt: false });

      await page.getByTestId("translate-source-input").fill("こんにちは");
      await expect(page.getByTestId("translate-prepare-btn")).toBeVisible({
        timeout: 5000,
      });
      await expect(page.getByTestId("translate-direction-select")).toHaveCount(
        0,
      );
      await page.getByTestId("translate-prepare-btn").click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] こんにちは",
        { timeout: 5000 },
      );

      await page.getByTestId("translate-source-input").fill("hello");
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[en>ja] hello",
        { timeout: 5000 },
      );
      await expect(page.getByTestId("translate-direction-select")).toHaveCount(
        0,
      );
      const state = await getState(page);
      expect(state.detectorCreateCount).toBe(1);
      expect(state.translatorCreatePairs).toEqual(["ja>en", "en>ja"]);
    });

    test("段落を空行で分割し単一改行と訳文間の空行を保持する", async ({
      page,
    }) => {
      await page
        .getByTestId("translate-source-input")
        .fill(
          "  一つ目の行\r\n二つ目の行\r\n \r\n\t\r\n  二つ目の段落  \n\n\n  三つ目の行\r\n最後の行  ",
        );
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] 一つ目の行\n二つ目の行\n\n[ja>en] 二つ目の段落\n\n[ja>en] 三つ目の行\n最後の行",
        { timeout: 5000 },
      );
      const state = await getState(page);
      expect(state.translationInputs).toEqual([
        "一つ目の行\n二つ目の行",
        "二つ目の段落",
        "三つ目の行\n最後の行",
      ]);
    });

    test("段落途中の準備後に後続方向から再開する", async ({ page }) => {
      await installAiStubs(page, {
        detectorAvailability: "available",
        detectorLanguages: ["ja", "en", "en", "en"],
        translatorAvailabilityByDirection: {
          nativeToForeign: "available",
          foreignToNative: "downloadable",
        },
        includePrompt: false,
      });
      await page.reload();
      await expectStubbedPageReady(page, { includePrompt: false });

      await page
        .getByTestId("translate-source-input")
        .fill("最初の段落\n\n後続の段落\n\n最後の段落");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await expect(prepareButton).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] 最初の段落",
      );
      await prepareButton.click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] 最初の段落\n\n[en>ja] 後続の段落\n\n[en>ja] 最後の段落",
        { timeout: 5000 },
      );
      await expect(prepareButton).toHaveCount(0);
      const state = await getState(page);
      expect(state.translationInputs).toEqual([
        "最初の段落",
        "後続の段落",
        "最後の段落",
      ]);
      expect(state.translatorCreatePairs).toEqual(["ja>en", "en>ja"]);
    });

    test("段落途中の利用不可で完了済み訳文を保持する", async ({ page }) => {
      await installAiStubs(page, {
        detectorAvailability: "available",
        detectorLanguages: ["ja", "en", "en"],
        translatorAvailabilityByDirection: {
          nativeToForeign: "available",
          foreignToNative: "unavailable",
        },
        includePrompt: false,
      });
      await page.reload();
      await expectStubbedPageReady(page, { includePrompt: false });

      await page
        .getByTestId("translate-source-input")
        .fill("最初の段落\n\n利用できない段落\n\n未開始の段落");
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] 最初の段落",
        { timeout: 5000 },
      );
      await expect(page.getByTestId("translate-status")).toContainText(
        "この言語ペア",
      );
      const state = await getState(page);
      expect(state.translationInputs).toEqual(["最初の段落"]);
    });

    test("段落途中の例外で受信済み訳文を保持する", async ({ page }) => {
      await installAiStubs(page, {
        detectorAvailability: "available",
        detectorLanguages: ["ja", "en", "en"],
        translatorAvailabilityByDirection: {
          nativeToForeign: "available",
          foreignToNative: "available",
        },
        includePrompt: false,
      });
      await page.reload();
      await expectStubbedPageReady(page, { includePrompt: false });
      await page.evaluate(() => {
        type TranslatorPrototype = {
          prototype: {
            translateStreaming: (
              this: { sourceLanguage: string; targetLanguage: string },
              input: string,
              options?: { signal?: AbortSignal },
            ) => ReadableStream<string>;
          };
        };
        const translator =
          globalThis.Translator as unknown as TranslatorPrototype;
        const originalTranslateStreaming =
          translator.prototype.translateStreaming;
        const state = (
          globalThis as typeof globalThis & {
            __translateTestState: { translationInputs: string[] };
          }
        ).__translateTestState;
        translator.prototype.translateStreaming = function (
          this: { sourceLanguage: string; targetLanguage: string },
          input: string,
          options?: { signal?: AbortSignal },
        ) {
          if (input !== "途中で失敗") {
            return originalTranslateStreaming.call(this, input, options);
          }
          state.translationInputs.push(input);
          const prefix = `[${this.sourceLanguage}>${this.targetLanguage}] `;
          return new ReadableStream<string>({
            async start(controller) {
              controller.enqueue(prefix);
              controller.enqueue("途中まで");
              await Promise.resolve();
              controller.error(new Error("段落翻訳失敗"));
            },
          });
        };
      });

      await page
        .getByTestId("translate-source-input")
        .fill("最初の段落\n\n途中で失敗\n\n未開始の段落");
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] 最初の段落\n\n[en>ja] 途中まで",
        { timeout: 5000 },
      );
      await expect(page.getByTestId("translate-status")).toContainText(
        "段落翻訳失敗",
      );
      const state = await getState(page);
      expect(state.translationInputs).toEqual(["最初の段落", "途中で失敗"]);
    });

    test("downloadingのTranslator APIは自動経路で翻訳する", async ({
      page,
    }) => {
      await installAiStubs(page, {
        detectorAvailability: "downloading",
        translatorAvailability: "downloading",
      });
      await page.reload();
      await expectStubbedPageReady(page);
      await translateAutomatically(page, "こんにちは", "[ja>en] こんにちは");
      const state = await getState(page);
      expect(state.detectorCreateCount).toBe(1);
      expect(state.translatorCreateCount).toBe(1);
      expect(state.detectorCreateActivationIds).toEqual([0]);
      expect(state.translatorCreateActivationIds).toEqual([0]);
    });

    test("母語以外の文章を母語へ自動翻訳する", async ({ page }) => {
      await installAiStubs(page, { detectorLanguage: "en" });
      await page.reload();
      await expectStubbedPageReady(page);
      await translateAutomatically(page, "hello", "[en>ja] hello");
    });

    test("言語設定を保存して再訪時に復元する", async ({ page }) => {
      await page.getByTestId("translate-foreign-input").fill("フランス語");
      await page.reload();
      await expect(page.getByTestId("translate-foreign-input")).toHaveValue(
        "フランス語",
      );
    });

    test("Prompt APIの選択を保存して自動実行する", async ({ page }) => {
      const engineSelect = page.getByTestId("translate-engine-select");
      await engineSelect.selectOption("prompt");
      await page.reload();
      await expect(page.getByTestId("translate-engine-select")).toHaveValue(
        "prompt",
      );
      await translateAutomatically(page, "hello", "[prompt] hello");
      await expect
        .poll(async () => (await getState(page)).promptCreateCount)
        .toBe(1);
    });

    test("準備中の原文変更後は最新の原文を1回の準備で翻訳する", async ({
      page,
    }) => {
      await installAiStubs(page, {
        detectorAvailability: "downloadable",
        translatorAvailability: "downloadable",
      });
      await page.reload();
      await expectStubbedPageReady(page);
      await page.getByTestId("translate-source-input").fill("最初");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await expect(prepareButton).toBeVisible();
      await page.getByTestId("translate-source-input").fill("変更後");
      await expect(prepareButton).toBeEnabled({ timeout: 5000 });
      await prepareButton.click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>en] 変更後",
        { timeout: 5000 },
      );
    });

    test("準備中の言語設定変更後は最新の翻訳先を使う", async ({ page }) => {
      await installAiStubs(page, {
        detectorAvailability: "downloadable",
        translatorAvailability: "downloadable",
      });
      await page.reload();
      await expectStubbedPageReady(page);
      await page.getByTestId("translate-source-input").fill("こんにちは");
      const prepareButton = page.getByTestId("translate-prepare-btn");
      await expect(prepareButton).toContainText("母語 → 相手言語");
      await page.getByTestId("translate-foreign-input").fill("フランス語");
      await expect(prepareButton).toBeEnabled({ timeout: 5000 });
      await prepareButton.click();
      await expect(page.getByTestId("translate-target-output")).toHaveValue(
        "[ja>fr] こんにちは",
        { timeout: 5000 },
      );
    });

    test("Prompt APIだけが利用可能でも選択状態と利用可能理由を表示する", async ({
      page,
    }) => {
      await installAiStubs(page, {
        includeTranslator: false,
        includePrompt: true,
      });
      await page.reload();
      await expectStubbedPageReady(page, {
        includeTranslator: false,
        includePrompt: true,
      });
      await expect(page.getByTestId("translate-engine-select")).toHaveValue(
        "prompt",
      );
      await expect(page.getByTestId("translate-engine-help")).toContainText(
        "Prompt APIがこの言語設定で利用可能",
      );
      await translateAutomatically(page, "hello", "[prompt] hello");
    });

    test("downloadableのPrompt APIは準備ボタン1回で実行する", async ({
      page,
    }) => {
      await installAiStubs(page, {
        includeTranslator: false,
        includePrompt: true,
        promptAvailability: "downloadable",
      });
      await page.reload();
      await expectStubbedPageReady(page, {
        includeTranslator: false,
        includePrompt: true,
      });
      await prepareTranslator(page, "hello", "[prompt] hello");
      const state = await getState(page);
      expect(state.promptCreateCount).toBe(1);
      expect(state.promptCreateActivationIds[0]).toBeGreaterThan(0);
    });

    test("Promptセッションを実行ごとに分離する", async ({ page }) => {
      await page.getByTestId("translate-engine-select").selectOption("prompt");
      await translateAutomatically(page, "最初の文章", "[prompt] 最初の文章");
      await translateAutomatically(page, "次の文章", "[prompt] 次の文章");
      const state = await getState(page);
      expect(state.promptCloneCount).toBe(2);
      expect(state.promptDestroyCount).toBe(2);
      expect(state.promptInputs).toEqual(["最初の文章", "次の文章"]);
    });

    test("前回の翻訳をAbortSignalで中断する", async ({ page }) => {
      await installAiStubs(page, { blockFirstTranslation: true });
      await page.reload();
      await expectStubbedPageReady(page);
      await page.getByTestId("translate-source-input").fill("最初の文章");
      await expect
        .poll(async () => (await getState(page)).translationInputs.length)
        .toBe(1);
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

    test("対応外のTranslator言語ペアをエラー表示する", async ({ page }) => {
      await installAiStubs(page, { translatorAvailability: "unavailable" });
      await page.reload();
      await expectStubbedPageReady(page);
      await page.getByTestId("translate-source-input").fill("こんにちは");
      await expect(page.getByTestId("translate-status")).toContainText(
        "この言語ペア",
        { timeout: 5000 },
      );
      expect((await getState(page)).translatorCreateCount).toBe(0);
    });

    test("Translatorの作成失敗を利用者向け状態へ表示する", async ({ page }) => {
      await installAiStubs(page, {
        detectorAvailability: "available",
        translatorAvailability: "downloadable",
        translatorCreateError: "translator creation failed",
      });
      await page.reload();
      await expectStubbedPageReady(page);
      await page.getByTestId("translate-source-input").fill("こんにちは");
      await page.getByTestId("translate-prepare-btn").click();
      await expect(page.getByTestId("translate-status")).toContainText(
        "translator creation failed",
      );
    });

    test("Prompt APIへ設定外の対応言語を入力言語として宣言する", async ({
      page,
    }) => {
      await page.getByTestId("translate-engine-select").selectOption("prompt");
      await translateAutomatically(page, "hola", "[prompt] hola");
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

  test("desktopでは両欄をそろえて広い残余領域を使う", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openStubbedPage(page);
    const grid = page.getByTestId("translate-editor-grid");
    const source = page.getByTestId("translate-source-input");
    const target = page.getByTestId("translate-target-output");
    const gridBox = await grid.boundingBox();
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(gridBox).not.toBeNull();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    if (!gridBox || !sourceBox || !targetBox) return;
    expect(gridBox.width).toBeGreaterThan(1150);
    expect(Math.abs(sourceBox.y - targetBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(sourceBox.height - targetBox.height)).toBeLessThanOrEqual(
      1,
    );
    expect(sourceBox.height).toBeGreaterThan(400);
    expect(targetBox.y + targetBox.height).toBeLessThan(880);
  });
});
