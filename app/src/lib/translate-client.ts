/**
 * @fileoverview ブラウザ内蔵AI APIの可用性判定、準備、翻訳実行
 */

import {
  buildPromptLanguageOptions,
  buildTranslationPrompt,
  decideDirection,
  resolveLanguageTag,
  type PromptLanguageOptions,
  type TranslateEngine,
} from "$lib/translate";

export type TranslationPreparationTarget =
  | {
      kind: "translator";
      sourceText: string;
      nativeLanguage: string;
      foreignLanguage: string;
      sourceLanguage: string | undefined;
      targetLanguage: string | undefined;
      availability: Availability;
      requiresUserActivation: boolean;
    }
  | {
      kind: "prompt";
      nativeLanguage: string;
      foreignLanguage: string;
      options: PromptLanguageOptions;
      initialPrompt: string;
      availability: Availability;
      requiresUserActivation: boolean;
    };

export type TranslationResult =
  | { status: "translated" }
  | {
      status: "prepare";
      preparation: readonly TranslationPreparationTarget[];
    }
  | { status: "unavailable"; message: string };

type TranslationPreparationResult = Extract<
  TranslationResult,
  { status: "prepare" }
>;

export type PrepareEngineOptions = {
  engine: TranslateEngine;
  preparation: readonly TranslationPreparationTarget[];
  onProgress: (progress: number) => void;
};

type TranslationResources = {
  detector: LanguageDetector | undefined;
  translator: { key: string; instance: Translator } | undefined;
  prompt: { key: string; instance: LanguageModel } | undefined;
};

const resources: TranslationResources = {
  detector: undefined,
  translator: undefined,
  prompt: undefined,
};

let resourceGeneration = 0;
let detectorCreation: Promise<LanguageDetector> | undefined;
let translatorCreationQueue = Promise.resolve();
let promptCreationQueue = Promise.resolve();

function makePairKey(sourceLanguage: string, targetLanguage: string): string {
  return `${sourceLanguage}\u0000${targetLanguage}`;
}

function makePromptKey(
  nativeLanguage: string,
  foreignLanguage: string,
): string {
  return `${nativeLanguage}\u0000${foreignLanguage}`;
}

function makeMonitor(
  onProgress: (progress: number) => void,
): CreateMonitorCallback {
  return (monitor) => {
    monitor.addEventListener("downloadprogress", (event) => {
      onProgress(event.loaded);
    });
  };
}

function getPreparationLabel(target: TranslationPreparationTarget): string {
  if (target.kind === "prompt") return "翻訳モデル";
  if (!target.sourceLanguage || !target.targetLanguage) return "翻訳モデル";
  return `${target.sourceLanguage}→${target.targetLanguage}`;
}

/**
 * 利用できる翻訳エンジンを既定順で返す。
 * Translator APIとPrompt APIの双方が利用できる場合はTranslator APIを先に返す。
 */
export async function detectEngineAvailability(
  nativeLanguage: string,
  foreignLanguage: string,
): Promise<readonly TranslateEngine[]> {
  const availableEngines: TranslateEngine[] = [];

  if (
    typeof globalThis.Translator !== "undefined" &&
    typeof globalThis.LanguageDetector !== "undefined" &&
    (await globalThis.LanguageDetector.availability()) !== "unavailable"
  ) {
    availableEngines.push("translator");
  }

  const promptOptions = buildPromptLanguageOptions(
    nativeLanguage,
    foreignLanguage,
  );
  if (
    typeof globalThis.LanguageModel !== "undefined" &&
    promptOptions !== null &&
    (await globalThis.LanguageModel.availability(promptOptions)) !==
      "unavailable"
  ) {
    availableEngines.push("prompt");
  }

  return availableEngines;
}

/**
 * 準備対象の内蔵AIインスタンスを作成する。
 * `availability() === "available"`の資源は自動経路で作成し、モデルの
 * ダウンロードを示す資源は利用者操作から検出器・翻訳器を連続して作成する。
 * 同一activation内で複数の`create()`を試行するため、実機での受理結果を
 * 継続して確認する。
 * 仕様: https://developer.chrome.com/docs/ai/get-started
 * https://developer.chrome.com/docs/ai/translator-api
 * https://developer.mozilla.org/en-US/docs/Web/API/Prompt_API/Using
 * https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api
 */
export async function prepareEngine({
  engine,
  preparation,
  onProgress,
}: PrepareEngineOptions): Promise<void> {
  if (preparation.length === 0) return;
  onProgress(0);
  const monitor = makeMonitor(onProgress);

  for (const target of preparation) {
    if (engine === "translator" && target.kind === "translator") {
      await prepareTranslator(target, monitor);
    }
    if (engine === "prompt" && target.kind === "prompt") {
      await preparePrompt(target, monitor);
    }
  }
}

async function createDetector(
  monitor: CreateMonitorCallback,
): Promise<LanguageDetector> {
  if (resources.detector) return resources.detector;
  if (detectorCreation) return detectorCreation;
  if (typeof globalThis.LanguageDetector === "undefined") {
    throw new Error("Language Detector APIを利用できません");
  }
  const generation = resourceGeneration;
  const creation = globalThis.LanguageDetector.create({ monitor }).then(
    (instance) => {
      if (generation !== resourceGeneration) {
        instance.destroy();
        throw new DOMException("翻訳準備が中断されました", "AbortError");
      }
      resources.detector = instance;
      return instance;
    },
  );
  detectorCreation = creation;
  try {
    return await creation;
  } finally {
    if (detectorCreation === creation) detectorCreation = undefined;
  }
}

async function createTranslator(
  sourceLanguage: string,
  targetLanguage: string,
  monitor: CreateMonitorCallback,
): Promise<Translator> {
  const key = makePairKey(sourceLanguage, targetLanguage);
  if (resources.translator?.key === key) return resources.translator.instance;
  if (typeof globalThis.Translator === "undefined") {
    throw new Error("Translator APIを利用できません");
  }
  const generation = resourceGeneration;
  const creation = translatorCreationQueue.then(async () => {
    if (resources.translator?.key === key) return resources.translator.instance;
    resources.translator?.instance.destroy();
    resources.translator = undefined;
    const instance = await globalThis.Translator.create({
      sourceLanguage,
      targetLanguage,
      monitor,
    });
    if (generation !== resourceGeneration) {
      instance.destroy();
      throw new DOMException("翻訳準備が中断されました", "AbortError");
    }
    resources.translator = { key, instance };
    return instance;
  });
  translatorCreationQueue = creation.then(
    () => undefined,
    () => undefined,
  );
  return creation;
}

async function createPrompt(
  target: Extract<TranslationPreparationTarget, { kind: "prompt" }>,
  monitor: CreateMonitorCallback,
): Promise<LanguageModel> {
  const key = makePromptKey(target.nativeLanguage, target.foreignLanguage);
  if (resources.prompt?.key === key) return resources.prompt.instance;
  if (typeof globalThis.LanguageModel === "undefined") {
    throw new Error("Prompt APIを利用できません");
  }
  const generation = resourceGeneration;
  const creation = promptCreationQueue.then(async () => {
    if (resources.prompt?.key === key) return resources.prompt.instance;
    resources.prompt?.instance.destroy();
    resources.prompt = undefined;
    const instance = await globalThis.LanguageModel.create({
      ...target.options,
      initialPrompts: [{ role: "system", content: target.initialPrompt }],
      monitor,
    });
    if (generation !== resourceGeneration) {
      instance.destroy();
      throw new DOMException("翻訳準備が中断されました", "AbortError");
    }
    resources.prompt = { key, instance };
    return instance;
  });
  promptCreationQueue = creation.then(
    () => undefined,
    () => undefined,
  );
  return creation;
}

async function prepareTranslator(
  target: Extract<TranslationPreparationTarget, { kind: "translator" }>,
  monitor: CreateMonitorCallback,
): Promise<void> {
  let sourceLanguage = target.sourceLanguage;
  let targetLanguage = target.targetLanguage;
  if (!sourceLanguage || !targetLanguage) {
    const detector = await createDetector(monitor);
    const detections = await detector.detect(target.sourceText);
    const nativeTag = resolveLanguageTag(target.nativeLanguage);
    const foreignTag = resolveLanguageTag(target.foreignLanguage);
    if (nativeTag === null || foreignTag === null) {
      throw new Error(
        "母語・相手言語を解決できません。言語名または言語タグ（en・fr）を入力してください",
      );
    }
    const direction = decideDirection(
      getDetectedLanguage(detections),
      nativeTag,
      foreignTag,
    );
    sourceLanguage = direction.sourceLanguage;
    targetLanguage = direction.targetLanguage;
  }

  if (typeof globalThis.Translator === "undefined") {
    throw new Error("Translator APIを利用できません");
  }
  if (!sourceLanguage || !targetLanguage) {
    throw new Error("翻訳方向を決定できません");
  }
  const availability = await globalThis.Translator.availability({
    sourceLanguage,
    targetLanguage,
  });
  if (availability === "unavailable") {
    throw new Error(
      `この言語ペア（${sourceLanguage}→${targetLanguage}）は翻訳できません`,
    );
  }
  await createTranslator(sourceLanguage, targetLanguage, monitor);
}

async function preparePrompt(
  target: Extract<TranslationPreparationTarget, { kind: "prompt" }>,
  monitor: CreateMonitorCallback,
): Promise<void> {
  if (typeof globalThis.LanguageModel === "undefined") {
    throw new Error("Prompt APIを利用できません");
  }
  const availability = await globalThis.LanguageModel.availability(
    target.options,
  );
  if (availability === "unavailable") {
    throw new Error("Prompt APIを利用できません");
  }
  await createPrompt(target, monitor);
}

function getDetectedLanguage(
  detections: readonly LanguageDetectionResult[],
): string | null {
  const first = detections[0];
  if (!first || first.detectedLanguage === "und" || first.confidence < 0.5) {
    return null;
  }
  return first.detectedLanguage;
}

function makeTranslatorPreparation(
  sourceText: string,
  nativeLanguage: string,
  foreignLanguage: string,
  sourceLanguage: string | undefined,
  targetLanguage: string | undefined,
  availability: Availability,
): TranslationPreparationResult {
  return {
    status: "prepare",
    preparation: [
      {
        kind: "translator",
        sourceText,
        nativeLanguage,
        foreignLanguage,
        sourceLanguage,
        targetLanguage,
        availability,
        requiresUserActivation: true,
      },
    ],
  };
}

function makePromptPreparation(
  nativeLanguage: string,
  foreignLanguage: string,
  options: PromptLanguageOptions,
  availability: Availability,
): TranslationPreparationResult {
  return {
    status: "prepare",
    preparation: [
      {
        kind: "prompt",
        nativeLanguage,
        foreignLanguage,
        options,
        initialPrompt: buildTranslationPrompt(nativeLanguage, foreignLanguage),
        availability,
        requiresUserActivation: true,
      },
    ],
  };
}

async function consumeStream(
  stream: ReadableStream<string>,
  onChunk: (chunk: string) => void,
): Promise<void> {
  for await (const chunk of stream) {
    onChunk(chunk);
  }
}

/**
 * 作成済みの内蔵AIインスタンスで翻訳し、必要な準備があればその対象を返す。
 * 実行ごとのAbortSignalは検出・翻訳・Prompt実行へ渡し、create()には渡さない。
 */
export async function runTranslation(
  text: string,
  nativeLanguage: string,
  foreignLanguage: string,
  engine: TranslateEngine,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<TranslationResult> {
  if (engine === "prompt") {
    const promptOptions = buildPromptLanguageOptions(
      nativeLanguage,
      foreignLanguage,
    );
    if (promptOptions === null) {
      return {
        status: "unavailable",
        message:
          "Prompt APIでは母語・相手言語を対応言語（en・ja・es・de・fr）で指定してください",
      };
    }
    const promptKey = makePromptKey(nativeLanguage, foreignLanguage);
    if (!resources.prompt || resources.prompt.key !== promptKey) {
      if (typeof globalThis.LanguageModel === "undefined") {
        return {
          status: "unavailable",
          message: "Prompt APIを利用できません",
        };
      }
      const availability =
        await globalThis.LanguageModel.availability(promptOptions);
      if (availability === "unavailable") {
        return {
          status: "unavailable",
          message: "Prompt APIを利用できません",
        };
      }
      const preparation = makePromptPreparation(
        nativeLanguage,
        foreignLanguage,
        promptOptions,
        availability,
      );
      if (availability !== "available") return preparation;
      await prepareEngine({
        engine,
        preparation: preparation.preparation,
        onProgress: () => undefined,
      });
    }

    if (!resources.prompt) {
      return {
        status: "unavailable",
        message: "Prompt APIを利用できません",
      };
    }
    let executionSession: LanguageModel | undefined;
    try {
      executionSession = await resources.prompt.instance.clone({ signal });
      await consumeStream(
        await executionSession.promptStreaming(text, { signal }),
        onChunk,
      );
      return { status: "translated" };
    } finally {
      executionSession?.destroy();
    }
  }

  const nativeTag = resolveLanguageTag(nativeLanguage);
  const foreignTag = resolveLanguageTag(foreignLanguage);
  if (nativeTag === null || foreignTag === null) {
    return {
      status: "unavailable",
      message:
        "母語・相手言語を解決できません。言語名または言語タグ（en・fr）を入力してください",
    };
  }
  if (
    typeof globalThis.Translator === "undefined" ||
    typeof globalThis.LanguageDetector === "undefined"
  ) {
    return {
      status: "unavailable",
      message: "このブラウザはTranslator APIに対応していません",
    };
  }
  if (!resources.detector) {
    const availability = await globalThis.LanguageDetector.availability();
    if (availability === "unavailable") {
      return {
        status: "unavailable",
        message: "このブラウザはLanguage Detector APIに対応していません",
      };
    }
    if (availability !== "available") {
      return makeTranslatorPreparation(
        text,
        nativeTag,
        foreignTag,
        undefined,
        undefined,
        availability,
      );
    }
    await createDetector(() => undefined);
  }

  if (!resources.detector) {
    return {
      status: "unavailable",
      message: "Language Detector APIを利用できません",
    };
  }
  const detections = await resources.detector.detect(text, { signal });
  const direction = decideDirection(
    getDetectedLanguage(detections),
    nativeTag,
    foreignTag,
  );
  const pairKey = makePairKey(
    direction.sourceLanguage,
    direction.targetLanguage,
  );
  if (!resources.translator || resources.translator.key !== pairKey) {
    const availability = await globalThis.Translator.availability({
      sourceLanguage: direction.sourceLanguage,
      targetLanguage: direction.targetLanguage,
    });
    if (availability === "unavailable") {
      return {
        status: "unavailable",
        message: `この言語ペア（${direction.sourceLanguage}→${direction.targetLanguage}）は翻訳できません`,
      };
    }
    const preparation = makeTranslatorPreparation(
      text,
      nativeTag,
      foreignTag,
      direction.sourceLanguage,
      direction.targetLanguage,
      availability,
    );
    if (availability !== "available") return preparation;
    await createTranslator(
      direction.sourceLanguage,
      direction.targetLanguage,
      () => undefined,
    );
  }

  if (!resources.translator) {
    return {
      status: "unavailable",
      message: "Translator APIを利用できません",
    };
  }
  await consumeStream(
    await resources.translator.instance.translateStreaming(text, {
      signal,
    }),
    onChunk,
  );
  return { status: "translated" };
}

/** 保持中の検出器、翻訳器、Promptセッションを解放する */
export function destroyTranslationResources(): void {
  resourceGeneration += 1;
  resources.detector?.destroy();
  resources.translator?.instance.destroy();
  resources.prompt?.instance.destroy();
  resources.detector = undefined;
  resources.translator = undefined;
  resources.prompt = undefined;
}

/** 準備対象を画面表示用の日本語へ変換する */
export function describePreparationTarget(
  target: TranslationPreparationTarget,
): string {
  return getPreparationLabel(target);
}
