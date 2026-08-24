/**
 * @fileoverview 翻訳設定と方向判定のユニットテスト
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPromptLanguageOptions,
  buildTranslationPrompt,
  decideDirection,
  getStoredTranslateSettings,
  LANGUAGE_TAGS,
  PROMPT_LANGUAGE_TAGS,
  resolveLanguageTag,
  setStoredTranslateSettings,
  TRANSLATE_DEFAULTS,
} from "./translate";
import {
  detectEngineAvailability,
  destroyTranslationResources,
  prepareEngine,
  runTranslation,
} from "./translate-client";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", localStorageMock);
  destroyTranslationResources();
});

describe("resolveLanguageTag", () => {
  it.each([
    ["英語", "en"],
    ["English", "en"],
    ["en", "en"],
    ["EN", "en"],
    ["  ja  ", "ja"],
    ["フランス語", "fr"],
    ["zh-Hant", "zh-Hant"],
    ["存在しない言語", null],
  ] as const)("%s を %s へ解決する", (input, expected) => {
    expect(resolveLanguageTag(input)).toBe(expected);
  });

  it("Translator APIの候補タグを保持する", () => {
    expect(LANGUAGE_TAGS).toContain("zh-Hant");
  });
});

describe("decideDirection", () => {
  it("母語と一致する検出結果は相手言語へ訳す", () => {
    expect(decideDirection("en-US", "en", "ja")).toEqual({
      sourceLanguage: "en",
      targetLanguage: "ja",
    });
  });

  it("母語と一致しない検出結果は母語へ訳す", () => {
    expect(decideDirection("en", "ja", "en")).toEqual({
      sourceLanguage: "en",
      targetLanguage: "ja",
    });
  });

  it.each([null, "und"])(
    "検出不能な %s は相手言語から母語へ訳す",
    (detectedLanguage) => {
      expect(decideDirection(detectedLanguage, "ja", "en")).toEqual({
        sourceLanguage: "en",
        targetLanguage: "ja",
      });
    },
  );
});

describe("buildTranslationPrompt", () => {
  it("言語と訳文だけを出力する制約を含める", () => {
    const prompt = buildTranslationPrompt("日本語", "英語");
    expect(prompt).toContain("日本語");
    expect(prompt).toContain("英語");
    expect(prompt).toContain("訳文だけを出力");
    expect(prompt).toContain("説明、注釈、引用符を付けない");
  });
});

describe("buildPromptLanguageOptions", () => {
  it("対応言語全体を入力、設定言語を出力へ指定する", () => {
    expect(buildPromptLanguageOptions("ja", "en")).toEqual({
      expectedInputs: [{ type: "text", languages: [...PROMPT_LANGUAGE_TAGS] }],
      expectedOutputs: [{ type: "text", languages: ["ja", "en"] }],
    });
    expect(buildPromptLanguageOptions("en", "fr")).toEqual({
      expectedInputs: [{ type: "text", languages: [...PROMPT_LANGUAGE_TAGS] }],
      expectedOutputs: [{ type: "text", languages: ["en", "fr"] }],
    });
  });

  it.each([
    ["ja", "中国語"],
    ["ja", "存在しない言語"],
  ] as const)("%s と %s はPrompt APIの設定を生成しない", (native, foreign) => {
    expect(buildPromptLanguageOptions(native, foreign)).toBeNull();
  });
});

describe("translate settings", () => {
  it("未保存時は既定値を返す", () => {
    expect(getStoredTranslateSettings()).toEqual(TRANSLATE_DEFAULTS);
  });

  it("未知のエンジン値は既定値へ戻す", () => {
    storage.set("translateEngine", "unknown");
    expect(getStoredTranslateSettings().engine).toBe(TRANSLATE_DEFAULTS.engine);
  });

  it("保存した母語・相手言語・エンジンを読み取る", () => {
    const settings = {
      nativeLanguage: "English",
      foreignLanguage: "フランス語",
      engine: "prompt" as const,
    };
    setStoredTranslateSettings(settings);
    expect(getStoredTranslateSettings()).toEqual(settings);
  });
});

describe("translate client availability", () => {
  it("Prompt APIだけが利用可能な状態を検出する", async () => {
    vi.stubGlobal("Translator", undefined);
    vi.stubGlobal("LanguageDetector", undefined);
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn().mockResolvedValue("available"),
    });

    await expect(detectEngineAvailability("ja", "en")).resolves.toEqual([
      "prompt",
    ]);
  });

  it("availableのTranslator APIは検出器と翻訳器を自動作成する", async () => {
    const detector = {
      detect: vi
        .fn()
        .mockResolvedValue([{ detectedLanguage: "ja", confidence: 1 }]),
      destroy: vi.fn(),
    };
    const translator = {
      translateStreaming: vi.fn().mockImplementation(
        () =>
          new ReadableStream<string>({
            start(controller) {
              controller.enqueue("translated");
              controller.close();
            },
          }),
      ),
      destroy: vi.fn(),
    };
    const detectorCreate = vi.fn().mockResolvedValue(detector);
    const translatorCreate = vi.fn().mockResolvedValue(translator);
    vi.stubGlobal("LanguageDetector", {
      availability: vi.fn().mockResolvedValue("available"),
      create: detectorCreate,
    });
    vi.stubGlobal("Translator", {
      availability: vi.fn().mockResolvedValue("available"),
      create: translatorCreate,
    });

    const chunks: string[] = [];
    await expect(
      runTranslation(
        "こんにちは",
        "ja",
        "en",
        "translator",
        new AbortController().signal,
        (chunk) => chunks.push(chunk),
      ),
    ).resolves.toEqual({ status: "translated" });
    expect(detectorCreate).toHaveBeenCalledTimes(1);
    expect(translatorCreate).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual(["translated"]);
  });

  it("準備中の原文変更で検出器を重複作成しない", async () => {
    let resolveDetector: ((detector: LanguageDetector) => void) | undefined;
    const detector = {
      detect: vi
        .fn()
        .mockResolvedValue([{ detectedLanguage: "ja", confidence: 1 }]),
      destroy: vi.fn(),
    };
    const detectorCreate = vi.fn(
      () =>
        new Promise<LanguageDetector>((resolve) => {
          resolveDetector = resolve;
        }),
    );
    const translator = {
      translateStreaming: vi.fn().mockImplementation(
        () =>
          new ReadableStream<string>({
            start(controller) {
              controller.enqueue("translated");
              controller.close();
            },
          }),
      ),
      destroy: vi.fn(),
    };
    vi.stubGlobal("LanguageDetector", {
      availability: vi.fn().mockResolvedValue("available"),
      create: detectorCreate,
    });
    vi.stubGlobal("Translator", {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue(translator),
    });

    const first = runTranslation(
      "最初",
      "ja",
      "en",
      "translator",
      new AbortController().signal,
      () => undefined,
    );
    await vi.waitFor(() => expect(detectorCreate).toHaveBeenCalledTimes(1));
    const second = runTranslation(
      "変更後",
      "ja",
      "en",
      "translator",
      new AbortController().signal,
      () => undefined,
    );
    expect(detectorCreate).toHaveBeenCalledTimes(1);
    resolveDetector?.(detector);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "translated" },
      { status: "translated" },
    ]);
    expect(detectorCreate).toHaveBeenCalledTimes(1);
  });

  it("ページ破棄後は検出器作成Promiseを再利用しない", async () => {
    const detectorResolvers: Array<(detector: LanguageDetector) => void> = [];
    const detectorCreate = vi.fn(
      () =>
        new Promise<LanguageDetector>((resolve) => {
          detectorResolvers.push(resolve);
        }),
    );
    const makeDetector = () => ({
      detect: vi
        .fn()
        .mockResolvedValue([{ detectedLanguage: "ja", confidence: 1 }]),
      destroy: vi.fn(),
    });
    const makeTranslator = () => ({
      translateStreaming: vi.fn().mockImplementation(
        () =>
          new ReadableStream<string>({
            start(controller) {
              controller.enqueue("translated");
              controller.close();
            },
          }),
      ),
      destroy: vi.fn(),
    });
    const translatorCreate = vi
      .fn()
      .mockImplementation(() => Promise.resolve(makeTranslator()));
    vi.stubGlobal("LanguageDetector", {
      availability: vi.fn().mockResolvedValue("available"),
      create: detectorCreate,
    });
    vi.stubGlobal("Translator", {
      availability: vi.fn().mockResolvedValue("available"),
      create: translatorCreate,
    });

    const first = runTranslation(
      "最初",
      "ja",
      "en",
      "translator",
      new AbortController().signal,
      () => undefined,
    );
    await vi.waitFor(() => expect(detectorCreate).toHaveBeenCalledTimes(1));

    destroyTranslationResources();

    const second = runTranslation(
      "再訪",
      "ja",
      "en",
      "translator",
      new AbortController().signal,
      () => undefined,
    );
    await vi.waitFor(() => expect(detectorCreate).toHaveBeenCalledTimes(2));

    const staleDetector = makeDetector();
    const currentDetector = makeDetector();
    detectorResolvers[0]?.(staleDetector);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    detectorResolvers[1]?.(currentDetector);
    await expect(second).resolves.toEqual({ status: "translated" });
    expect(staleDetector.destroy).toHaveBeenCalledTimes(1);
    expect(currentDetector.destroy).not.toHaveBeenCalled();
  });

  it("中断済み要求は可用性判定後に検出器を作成しない", async () => {
    let resolveAvailability: ((value: "available") => void) | undefined;
    const detectorCreate = vi.fn();
    vi.stubGlobal("LanguageDetector", {
      availability: vi.fn(
        () =>
          new Promise<"available">((resolve) => {
            resolveAvailability = resolve;
          }),
      ),
      create: detectorCreate,
    });
    vi.stubGlobal("Translator", {
      availability: vi.fn(),
      create: vi.fn(),
    });
    const controller = new AbortController();
    const translation = runTranslation(
      "こんにちは",
      "ja",
      "en",
      "translator",
      controller.signal,
      () => undefined,
    );

    await vi.waitFor(() => expect(resolveAvailability).toBeDefined());
    controller.abort();
    resolveAvailability?.("available");

    await expect(translation).rejects.toMatchObject({ name: "AbortError" });
    expect(detectorCreate).not.toHaveBeenCalled();
  });

  it("検出器downloadable時は方向別のTranslator準備対象を返す", async () => {
    const detectorCreate = vi.fn();
    const translatorAvailability = vi.fn(
      async ({
        sourceLanguage,
        targetLanguage,
      }: {
        sourceLanguage: string;
        targetLanguage: string;
      }) =>
        sourceLanguage === "ja" && targetLanguage === "en"
          ? "downloadable"
          : "available",
    );
    vi.stubGlobal("LanguageDetector", {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: detectorCreate,
    });
    vi.stubGlobal("Translator", {
      availability: translatorAvailability,
      create: vi.fn(),
    });

    const result = await runTranslation(
      "こんにちは",
      "ja",
      "en",
      "translator",
      new AbortController().signal,
      () => undefined,
    );
    expect(result).toMatchObject({
      status: "prepare",
      preparation: [
        {
          kind: "translator",
          availability: "downloadable",
          direction: "native-to-foreign",
          requiresUserActivation: true,
          requiresDirectionChoice: true,
          sourceLanguage: "ja",
          targetLanguage: "en",
        },
        {
          kind: "translator",
          availability: "available",
          direction: "foreign-to-native",
          requiresUserActivation: true,
          requiresDirectionChoice: true,
          sourceLanguage: "en",
          targetLanguage: "ja",
        },
      ],
    });
    expect(detectorCreate).not.toHaveBeenCalled();
    expect(translatorAvailability).toHaveBeenCalledTimes(2);
  });

  it("downloadableのTranslator準備は呼び出しスタック内でcreateを開始する", async () => {
    let resolveTranslator: ((translator: Translator) => void) | undefined;
    const translator = {
      sourceLanguage: "ja",
      targetLanguage: "en",
      translate: vi.fn(),
      translateStreaming: vi.fn(),
      destroy: vi.fn(),
    };
    const translatorCreate = vi.fn(
      () =>
        new Promise<Translator>((resolve) => {
          resolveTranslator = resolve;
        }),
    );
    vi.stubGlobal("Translator", {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: translatorCreate,
    });

    const preparation = {
      kind: "translator" as const,
      sourceText: "こんにちは",
      nativeLanguage: "ja",
      foreignLanguage: "en",
      sourceLanguage: "ja",
      targetLanguage: "en",
      direction: "native-to-foreign" as const,
      availability: "downloadable" as const,
      requiresDirectionChoice: true,
      requiresUserActivation: true,
    };
    const pending = prepareEngine({
      engine: "translator",
      preparation: [preparation],
      onProgress: () => undefined,
    });

    expect(translatorCreate).toHaveBeenCalledTimes(1);
    resolveTranslator?.(translator);
    await expect(pending).resolves.toBeUndefined();
  });

  it("中断済み要求のAbortSignalで共有Translator作成Promiseを失敗させない", async () => {
    let resolveTranslator: ((translator: Translator) => void) | undefined;
    const translator = {
      sourceLanguage: "ja",
      targetLanguage: "en",
      translate: vi.fn(),
      translateStreaming: vi.fn(),
      destroy: vi.fn(),
    };
    const translatorCreate = vi.fn(
      () =>
        new Promise<Translator>((resolve) => {
          resolveTranslator = resolve;
        }),
    );
    vi.stubGlobal("Translator", {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: translatorCreate,
    });
    const preparation = {
      kind: "translator" as const,
      sourceText: "こんにちは",
      nativeLanguage: "ja",
      foreignLanguage: "en",
      sourceLanguage: "ja",
      targetLanguage: "en",
      direction: "native-to-foreign" as const,
      availability: "downloadable" as const,
      requiresDirectionChoice: true,
      requiresUserActivation: true,
    };
    const firstController = new AbortController();
    const first = prepareEngine({
      engine: "translator",
      preparation: [preparation],
      onProgress: () => undefined,
      signal: firstController.signal,
    });
    await vi.waitFor(() => expect(translatorCreate).toHaveBeenCalledTimes(1));
    firstController.abort();

    const second = prepareEngine({
      engine: "translator",
      preparation: [preparation],
      onProgress: () => undefined,
    });
    expect(translatorCreate).toHaveBeenCalledTimes(1);
    resolveTranslator?.(translator);

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toBeUndefined();
  });

  it("検出器の自動経路ではTranslator準備後も入力ごとに方向を再判定する", async () => {
    const detector = {
      detect: vi
        .fn()
        .mockResolvedValueOnce([{ detectedLanguage: "ja", confidence: 1 }])
        .mockResolvedValueOnce([{ detectedLanguage: "en", confidence: 1 }]),
      destroy: vi.fn(),
    };
    const translatorCreate = vi.fn(
      ({ sourceLanguage, targetLanguage }: TranslatorCreateOptions) =>
        Promise.resolve({
          sourceLanguage,
          targetLanguage,
          translate: vi.fn(),
          translateStreaming: vi.fn(),
          destroy: vi.fn(),
        } as Translator),
    );
    vi.stubGlobal("LanguageDetector", {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue(detector),
    });
    vi.stubGlobal("Translator", {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: translatorCreate,
    });

    const first = await runTranslation(
      "こんにちは",
      "ja",
      "en",
      "translator",
      new AbortController().signal,
      () => undefined,
    );
    expect(first).toMatchObject({
      status: "prepare",
      preparation: [
        {
          direction: "native-to-foreign",
          requiresDirectionChoice: false,
        },
      ],
    });
    if (first.status !== "prepare") return;
    await prepareEngine({
      engine: "translator",
      preparation: first.preparation,
      onProgress: () => undefined,
    });

    const second = await runTranslation(
      "hello",
      "ja",
      "en",
      "translator",
      new AbortController().signal,
      () => undefined,
    );
    expect(second).toMatchObject({
      status: "prepare",
      preparation: [
        {
          direction: "foreign-to-native",
          requiresDirectionChoice: false,
        },
      ],
    });
    expect(detector.detect).toHaveBeenCalledTimes(2);
    expect(translatorCreate).toHaveBeenCalledTimes(1);
  });

  it("準備済みの翻訳方向を保持し、方向変更で対象Translatorだけを作成する", async () => {
    const detectorCreate = vi.fn();
    const translatorCreate = vi.fn(
      ({ sourceLanguage, targetLanguage }: TranslatorCreateOptions) =>
        Promise.resolve({
          sourceLanguage,
          targetLanguage,
          translate: vi.fn(),
          translateStreaming: vi.fn(
            () =>
              new ReadableStream<string>({
                start(controller) {
                  controller.enqueue(`[${sourceLanguage}>${targetLanguage}]`);
                  controller.close();
                },
              }),
          ),
          destroy: vi.fn(),
        } as Translator),
    );
    vi.stubGlobal("LanguageDetector", {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: detectorCreate,
    });
    vi.stubGlobal("Translator", {
      availability: vi.fn().mockResolvedValue("available"),
      create: translatorCreate,
    });

    const first = await runTranslation(
      "こんにちは",
      "ja",
      "en",
      "translator",
      new AbortController().signal,
      () => undefined,
    );
    expect(first.status).toBe("prepare");
    if (first.status !== "prepare") return;
    const firstTarget = first.preparation[0];
    if (!firstTarget) return;
    await prepareEngine({
      engine: "translator",
      preparation: [firstTarget],
      onProgress: () => undefined,
    });

    const nativeChunks: string[] = [];
    await expect(
      runTranslation(
        "こんにちは",
        "ja",
        "en",
        "translator",
        new AbortController().signal,
        (chunk) => nativeChunks.push(chunk),
        "native-to-foreign",
      ),
    ).resolves.toEqual({ status: "translated" });
    expect(nativeChunks).toEqual(["[ja>en]"]);

    const foreignChunks: string[] = [];
    await expect(
      runTranslation(
        "hello",
        "ja",
        "en",
        "translator",
        new AbortController().signal,
        (chunk) => foreignChunks.push(chunk),
        "foreign-to-native",
      ),
    ).resolves.toEqual({ status: "translated" });
    expect(foreignChunks).toEqual(["[en>ja]"]);
    expect(detectorCreate).not.toHaveBeenCalled();
    expect(translatorCreate).toHaveBeenCalledTimes(2);
    expect(
      translatorCreate.mock.calls.map(
        ([options]) => `${options.sourceLanguage}>${options.targetLanguage}`,
      ),
    ).toEqual(["ja>en", "en>ja"]);
  });

  it("downloadableのPrompt準備は呼び出しスタック内でcreateを開始する", async () => {
    let resolvePrompt: ((model: LanguageModel) => void) | undefined;
    const prompt = {
      clone: vi.fn(),
      prompt: vi.fn(),
      promptStreaming: vi.fn(),
      destroy: vi.fn(),
    };
    const promptCreate = vi.fn(
      () =>
        new Promise<LanguageModel>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: promptCreate,
    });

    const pending = prepareEngine({
      engine: "prompt",
      preparation: [
        {
          kind: "prompt" as const,
          nativeLanguage: "ja",
          foreignLanguage: "en",
          options: {
            expectedInputs: [{ type: "text" as const, languages: ["en"] }],
            expectedOutputs: [
              { type: "text" as const, languages: ["ja", "en"] },
            ],
          },
          initialPrompt: "翻訳する",
          availability: "downloadable" as const,
          requiresUserActivation: true,
        },
      ],
      onProgress: () => undefined,
    });

    expect(promptCreate).toHaveBeenCalledTimes(1);
    resolvePrompt?.(prompt);
    await expect(pending).resolves.toBeUndefined();
  });

  it("中断済み要求のAbortSignalで共有Prompt作成Promiseを失敗させない", async () => {
    let resolvePrompt: ((model: LanguageModel) => void) | undefined;
    const prompt = {
      clone: vi.fn(),
      prompt: vi.fn(),
      promptStreaming: vi.fn(),
      destroy: vi.fn(),
    } as LanguageModel;
    const promptCreate = vi.fn(
      () =>
        new Promise<LanguageModel>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: promptCreate,
    });
    const preparation = {
      kind: "prompt" as const,
      nativeLanguage: "ja",
      foreignLanguage: "en",
      options: {
        expectedInputs: [{ type: "text" as const, languages: ["en"] }],
        expectedOutputs: [{ type: "text" as const, languages: ["ja", "en"] }],
      },
      initialPrompt: "翻訳する",
      availability: "downloadable" as const,
      requiresUserActivation: true,
    };
    const firstController = new AbortController();
    const first = prepareEngine({
      engine: "prompt",
      preparation: [preparation],
      onProgress: () => undefined,
      signal: firstController.signal,
    });
    await vi.waitFor(() => expect(promptCreate).toHaveBeenCalledTimes(1));
    firstController.abort();

    const second = prepareEngine({
      engine: "prompt",
      preparation: [preparation],
      onProgress: () => undefined,
    });
    expect(promptCreate).toHaveBeenCalledTimes(1);
    resolvePrompt?.(prompt);

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toBeUndefined();
  });
});
