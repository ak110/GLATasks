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

export type TranslationDirectionChoice =
  "native-to-foreign" | "foreign-to-native";

export type TranslationPreparationTarget =
  | {
      kind: "translator";
      sourceText: string;
      nativeLanguage: string;
      foreignLanguage: string;
      sourceLanguage: string;
      targetLanguage: string;
      direction: TranslationDirectionChoice;
      availability: Availability;
      requiresUserActivation: boolean;
      requiresDirectionChoice: boolean;
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
  signal?: AbortSignal;
};

type TranslationResources = {
  detector: LanguageDetector | undefined;
  translator:
    | {
        key: string;
        instance: Translator;
        mode: "detected" | "explicit";
      }
    | undefined;
  prompt: { key: string; instance: LanguageModel } | undefined;
};

const resources: TranslationResources = {
  detector: undefined,
  translator: undefined,
  prompt: undefined,
};

let resourceGeneration = 0;
let detectorCreation:
  { generation: number; promise: Promise<LanguageDetector> } | undefined;
const translatorCreations = new Map<
  string,
  { generation: number; promise: Promise<Translator> }
>();
const promptCreations = new Map<
  string,
  { generation: number; promise: Promise<LanguageModel> }
>();
let translatorCreationSequence = 0;
let promptCreationSequence = 0;

function ensurePreparationActive(
  generation: number,
  signal?: AbortSignal,
): void {
  if (generation !== resourceGeneration || signal?.aborted) {
    throw new DOMException("翻訳準備が中断されました", "AbortError");
  }
}

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
  return `${target.sourceLanguage}→${target.targetLanguage}`;
}

function getDirectionLabel(direction: TranslationDirectionChoice): string {
  return direction === "native-to-foreign"
    ? "母語 → 相手言語"
    : "相手言語 → 母語";
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
 * `available`と`downloading`は自動経路で作成し、`downloadable`だけを
 * 利用者操作へ分岐する。LanguageDetectorが`downloadable`のときは、
 * 検出器を作成せずに方向別のTranslatorを利用者へ選択させる。
 * 作成は共通の「create an AI model object」アルゴリズムに従い、
 * 利用者操作起点の`create()`をPromiseキューで遅延させない。
 * 仕様: https://webmachinelearning.github.io/writing-assistance-apis/#create-an-ai-model-object
 * https://webmachinelearning.github.io/translation-api/#dom-translator-create
 * https://developer.mozilla.org/en-US/docs/Web/API/Prompt_API/Using
 * https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api
 */
export async function prepareEngine({
  engine,
  preparation,
  onProgress,
  signal,
}: PrepareEngineOptions): Promise<void> {
  if (preparation.length === 0) return;
  const generation = resourceGeneration;
  ensurePreparationActive(generation, signal);
  onProgress(0);
  const monitor = makeMonitor(onProgress);

  for (const target of preparation) {
    ensurePreparationActive(generation, signal);
    if (engine === "translator" && target.kind === "translator") {
      await prepareTranslator(target, monitor, generation, signal);
    }
    if (engine === "prompt" && target.kind === "prompt") {
      await preparePrompt(target, monitor, generation, signal);
    }
  }
}

async function createDetector(
  monitor: CreateMonitorCallback,
  generation = resourceGeneration,
  signal?: AbortSignal,
): Promise<LanguageDetector> {
  ensurePreparationActive(generation, signal);
  if (resources.detector) return resources.detector;
  if (detectorCreation?.generation === generation) {
    return detectorCreation.promise;
  }
  if (typeof globalThis.LanguageDetector === "undefined") {
    throw new Error("Language Detector APIを利用できません");
  }
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
  detectorCreation = { generation, promise: creation };
  try {
    return await creation;
  } finally {
    if (detectorCreation?.promise === creation) detectorCreation = undefined;
  }
}

async function createTranslator(
  sourceLanguage: string,
  targetLanguage: string,
  monitor: CreateMonitorCallback,
  mode: "detected" | "explicit",
  generation = resourceGeneration,
  signal?: AbortSignal,
): Promise<Translator> {
  const key = makePairKey(sourceLanguage, targetLanguage);
  ensurePreparationActive(generation, signal);
  if (resources.translator?.key === key) {
    resources.translator.mode = mode;
    return resources.translator.instance;
  }
  if (typeof globalThis.Translator === "undefined") {
    throw new Error("Translator APIを利用できません");
  }
  const existing = translatorCreations.get(key);
  if (existing?.generation === generation) return existing.promise;

  resources.translator?.instance.destroy();
  resources.translator = undefined;
  const creationSequence = ++translatorCreationSequence;
  let creation: Promise<Translator>;
  try {
    // create()は利用者操作の呼び出しスタック内で開始し、Promiseキューで遅延させない。
    creation = Promise.resolve(
      globalThis.Translator.create({
        sourceLanguage,
        targetLanguage,
        monitor,
      }),
    ).then((instance) => {
      if (
        generation !== resourceGeneration ||
        creationSequence !== translatorCreationSequence
      ) {
        instance.destroy();
        throw new DOMException("翻訳準備が中断されました", "AbortError");
      }
      resources.translator = { key, instance, mode };
      return instance;
    });
  } catch (error) {
    creation = Promise.reject(error);
  }
  translatorCreations.set(key, { generation, promise: creation });
  void creation.then(
    () => {
      if (translatorCreations.get(key)?.promise === creation) {
        translatorCreations.delete(key);
      }
    },
    () => {
      if (translatorCreations.get(key)?.promise === creation) {
        translatorCreations.delete(key);
      }
    },
  );
  return creation;
}

async function createPrompt(
  target: Extract<TranslationPreparationTarget, { kind: "prompt" }>,
  monitor: CreateMonitorCallback,
  generation = resourceGeneration,
  signal?: AbortSignal,
): Promise<LanguageModel> {
  const key = makePromptKey(target.nativeLanguage, target.foreignLanguage);
  ensurePreparationActive(generation, signal);
  if (resources.prompt?.key === key) return resources.prompt.instance;
  if (typeof globalThis.LanguageModel === "undefined") {
    throw new Error("Prompt APIを利用できません");
  }
  const existing = promptCreations.get(key);
  if (existing?.generation === generation) return existing.promise;

  resources.prompt?.instance.destroy();
  resources.prompt = undefined;
  const creationSequence = ++promptCreationSequence;
  let creation: Promise<LanguageModel>;
  try {
    // downloadableのPromptもクリックイベントの呼び出しスタック内でcreate()を開始する。
    creation = Promise.resolve(
      globalThis.LanguageModel.create({
        ...target.options,
        initialPrompts: [{ role: "system", content: target.initialPrompt }],
        monitor,
      }),
    ).then((instance) => {
      if (
        generation !== resourceGeneration ||
        creationSequence !== promptCreationSequence
      ) {
        instance.destroy();
        throw new DOMException("翻訳準備が中断されました", "AbortError");
      }
      resources.prompt = { key, instance };
      return instance;
    });
  } catch (error) {
    creation = Promise.reject(error);
  }
  promptCreations.set(key, { generation, promise: creation });
  void creation.then(
    () => {
      if (promptCreations.get(key)?.promise === creation) {
        promptCreations.delete(key);
      }
    },
    () => {
      if (promptCreations.get(key)?.promise === creation) {
        promptCreations.delete(key);
      }
    },
  );
  return creation;
}

async function prepareTranslator(
  target: Extract<TranslationPreparationTarget, { kind: "translator" }>,
  monitor: CreateMonitorCallback,
  generation: number,
  signal?: AbortSignal,
): Promise<void> {
  ensurePreparationActive(generation, signal);
  if (typeof globalThis.Translator === "undefined") {
    throw new Error("Translator APIを利用できません");
  }
  if (target.availability === "unavailable") {
    throw new Error(
      `この言語ペア（${target.sourceLanguage}→${target.targetLanguage}）は翻訳できません`,
    );
  }
  await createTranslator(
    target.sourceLanguage,
    target.targetLanguage,
    monitor,
    "explicit",
    generation,
    signal,
  );
  ensurePreparationActive(generation, signal);
}

async function preparePrompt(
  target: Extract<TranslationPreparationTarget, { kind: "prompt" }>,
  monitor: CreateMonitorCallback,
  generation: number,
  signal?: AbortSignal,
): Promise<void> {
  ensurePreparationActive(generation, signal);
  if (typeof globalThis.LanguageModel === "undefined") {
    throw new Error("Prompt APIを利用できません");
  }
  if (target.availability === "unavailable") {
    throw new Error("Prompt APIを利用できません");
  }
  await createPrompt(target, monitor, generation, signal);
  ensurePreparationActive(generation, signal);
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
  sourceLanguage: string,
  targetLanguage: string,
  direction: TranslationDirectionChoice,
  availability: Availability,
  requiresDirectionChoice = false,
  requiresUserActivation = true,
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
        direction,
        availability,
        requiresDirectionChoice,
        requiresUserActivation,
      },
    ],
  };
}

async function makeDirectionPreparations(
  sourceText: string,
  nativeLanguage: string,
  foreignLanguage: string,
  nativeTag: string,
  foreignTag: string,
  generation = resourceGeneration,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  ensurePreparationActive(generation, signal);
  if (typeof globalThis.Translator === "undefined") {
    return {
      status: "unavailable",
      message: "Translator APIを利用できません",
    };
  }
  const directions = [
    {
      direction: "native-to-foreign" as const,
      sourceLanguage: nativeTag,
      targetLanguage: foreignTag,
    },
    {
      direction: "foreign-to-native" as const,
      sourceLanguage: foreignTag,
      targetLanguage: nativeTag,
    },
  ].filter(
    (candidate, index, candidates) =>
      candidates.findIndex(
        (other) =>
          other.sourceLanguage === candidate.sourceLanguage &&
          other.targetLanguage === candidate.targetLanguage,
      ) === index,
  );
  const preparations = await Promise.all(
    directions.map(async (candidate) => {
      const availability = await globalThis.Translator!.availability({
        sourceLanguage: candidate.sourceLanguage,
        targetLanguage: candidate.targetLanguage,
      });
      return {
        kind: "translator" as const,
        sourceText,
        nativeLanguage,
        foreignLanguage,
        sourceLanguage: candidate.sourceLanguage,
        targetLanguage: candidate.targetLanguage,
        direction: candidate.direction,
        availability,
        // Detector未準備の方向選択は、available/downloadingでも1回の明示操作で確定する。
        requiresUserActivation: true,
        requiresDirectionChoice: true,
      };
    }),
  );
  ensurePreparationActive(generation, signal);
  const availablePreparations = preparations.filter(
    (preparation) => preparation.availability !== "unavailable",
  );
  if (availablePreparations.length === 0) {
    return {
      status: "unavailable",
      message: `この言語設定（${nativeTag}↔${foreignTag}）は翻訳できません`,
    };
  }
  return { status: "prepare", preparation: availablePreparations };
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
 * 実行ごとのAbortSignalは検出・翻訳・Prompt実行へ渡す。モデル作成は
 * resourceGenerationで共有所有し、個別要求の中断で共有作成Promiseを壊さない。
 * 利用者操作起点のcreate()自体は、この関数から呼び出す準備処理の呼び出し
 * スタック内で開始する。
 */
export async function runTranslation(
  text: string,
  nativeLanguage: string,
  foreignLanguage: string,
  engine: TranslateEngine,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
  directionChoice?: TranslationDirectionChoice,
): Promise<TranslationResult> {
  const generation = resourceGeneration;
  ensurePreparationActive(generation, signal);
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
      ensurePreparationActive(generation, signal);
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
      if (availability === "downloadable") return preparation;
      await prepareEngine({
        engine,
        preparation: preparation.preparation,
        onProgress: () => undefined,
        signal,
      });
    }

    ensurePreparationActive(generation, signal);
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
  if (directionChoice) {
    const direction =
      directionChoice === "native-to-foreign"
        ? { sourceLanguage: nativeTag, targetLanguage: foreignTag }
        : { sourceLanguage: foreignTag, targetLanguage: nativeTag };
    const pairKey = makePairKey(
      direction.sourceLanguage,
      direction.targetLanguage,
    );

    if (resources.translator?.key !== pairKey) {
      const availability = await globalThis.Translator.availability(direction);
      ensurePreparationActive(generation, signal);
      if (availability === "unavailable") {
        return {
          status: "unavailable",
          message: `この言語ペア（${direction.sourceLanguage}→${direction.targetLanguage}）は翻訳できません`,
        };
      }
      if (availability === "downloadable") {
        return makeTranslatorPreparation(
          text,
          nativeLanguage,
          foreignLanguage,
          direction.sourceLanguage,
          direction.targetLanguage,
          directionChoice,
          availability,
          true,
        );
      }
      await createTranslator(
        direction.sourceLanguage,
        direction.targetLanguage,
        () => undefined,
        "explicit",
        generation,
        signal,
      );
    }

    ensurePreparationActive(generation, signal);
    if (!resources.translator || resources.translator.key !== pairKey) {
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

  if (!resources.detector) {
    const availability = await globalThis.LanguageDetector.availability();
    ensurePreparationActive(generation, signal);
    if (availability === "unavailable") {
      return {
        status: "unavailable",
        message: "このブラウザはLanguage Detector APIに対応していません",
      };
    }
    if (availability === "downloadable") {
      return makeDirectionPreparations(
        text,
        nativeLanguage,
        foreignLanguage,
        nativeTag,
        foreignTag,
        generation,
        signal,
      );
    }
    await createDetector(() => undefined, generation, signal);
  }

  ensurePreparationActive(generation, signal);
  if (!resources.detector) {
    return {
      status: "unavailable",
      message: "Language Detector APIを利用できません",
    };
  }
  const detections = await resources.detector.detect(text, { signal });
  ensurePreparationActive(generation, signal);
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
    ensurePreparationActive(generation, signal);
    if (availability === "unavailable") {
      return {
        status: "unavailable",
        message: `この言語ペア（${direction.sourceLanguage}→${direction.targetLanguage}）は翻訳できません`,
      };
    }
    if (availability === "downloadable") {
      const preparation = makeTranslatorPreparation(
        text,
        nativeTag,
        foreignTag,
        direction.sourceLanguage,
        direction.targetLanguage,
        direction.sourceLanguage === nativeTag &&
          direction.targetLanguage === foreignTag
          ? "native-to-foreign"
          : "foreign-to-native",
        availability,
      );
      return preparation;
    }
    await createTranslator(
      direction.sourceLanguage,
      direction.targetLanguage,
      () => undefined,
      "detected",
      generation,
      signal,
    );
  }

  ensurePreparationActive(generation, signal);
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
  translatorCreationSequence += 1;
  promptCreationSequence += 1;
  detectorCreation = undefined;
  translatorCreations.clear();
  promptCreations.clear();
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

/** 翻訳方向の選択肢を利用者向けの日本語へ変換する */
export function describePreparationDirection(
  target: TranslationPreparationTarget,
): string {
  return target.kind === "prompt"
    ? "Prompt API"
    : getDirectionLabel(target.direction);
}
