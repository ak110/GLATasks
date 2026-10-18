/**
 * @fileoverview ブラウザ内蔵AI APIの可用性判定、準備、翻訳実行
 */

import {
  modelSlots,
  createSharedModel,
  ensurePreparationActive,
  getModelApi,
  getResourceGeneration,
} from "#lib/client/translate/translate-resources.ts";
export {
  abandonEngineCreations,
  destroyTranslationResources,
} from "#lib/client/translate/translate-resources.ts";

import {
  buildPromptLanguageOptions,
  buildTranslationPrompt,
  decideDirection,
  resolveLanguageTag,
  type PromptLanguageOptions,
  type TranslateEngine,
} from "#lib/client/translate/translate.ts";

/** 言語の組を変える操作。画面の入力欄の表示名で案内する */
const CHANGE_LANGUAGE =
  "「入力側の言語（母語）」か「母語のときの翻訳先」を別の言語へ変更してください";

/** Translator APIを使えない場合の代わりの操作 */
const USE_PROMPT_INSTEAD =
  "翻訳エンジンでPrompt APIを選ぶか、Chrome 138以降のデスクトップ版で開いてください";

export const MODEL_UNAVAILABLE = {
  detector: `Language Detector APIを利用できません。${USE_PROMPT_INSTEAD}`,
  translator: `Translator APIを利用できません。${USE_PROMPT_INSTEAD}`,
  prompt:
    "Prompt APIを利用できません。翻訳エンジンでTranslator APIを選ぶか、Chrome 148以降のデスクトップ版で開いてください",
} as const;

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
    getModelApi("translator") &&
    getModelApi("detector") &&
    (await getModelApi("detector")!.availability()) !== "unavailable"
  ) {
    availableEngines.push("translator");
  }

  const promptOptions = buildPromptLanguageOptions(
    nativeLanguage,
    foreignLanguage,
  );
  if (
    getModelApi("prompt") &&
    promptOptions !== null &&
    (await getModelApi("prompt")!.availability(promptOptions)) !== "unavailable"
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
 * 進捗は0〜1の割合で通知する。仕様上、割合が1に達した後もモデルの初期化工程が続き、
 * その間は進捗を通知しない。
 */
export async function prepareEngine({
  engine,
  preparation,
  onProgress,
  signal,
}: PrepareEngineOptions): Promise<void> {
  if (preparation.length === 0) return;
  const generation = getResourceGeneration();
  ensurePreparationActive(generation, signal);
  onProgress(0);
  const monitor = makeMonitor(onProgress);

  for (const target of preparation) {
    ensurePreparationActive(generation, signal);
    if (engine === target.kind) {
      await prepareTarget(target, monitor, generation, signal);
    }
  }
}

async function createDetector(
  monitor: CreateMonitorCallback,
  generation = getResourceGeneration(),
  signal?: AbortSignal,
): Promise<LanguageDetector> {
  return createSharedModel(
    "detector",
    "detector",
    (sharedSignal) => {
      const api = getModelApi("detector");
      if (!api) throw new Error(MODEL_UNAVAILABLE.detector);
      return api.create({ monitor, signal: sharedSignal });
    },
    generation,
    signal,
  );
}

async function createTranslator(
  sourceLanguage: string,
  targetLanguage: string,
  monitor: CreateMonitorCallback,
  generation = getResourceGeneration(),
  signal?: AbortSignal,
): Promise<Translator> {
  return createSharedModel(
    "translator",
    makePairKey(sourceLanguage, targetLanguage),
    (sharedSignal) => {
      const api = getModelApi("translator");
      if (!api) throw new Error(MODEL_UNAVAILABLE.translator);
      return api.create({
        sourceLanguage,
        targetLanguage,
        monitor,
        signal: sharedSignal,
      });
    },
    generation,
    signal,
  );
}

async function createPrompt(
  target: Extract<TranslationPreparationTarget, { kind: "prompt" }>,
  monitor: CreateMonitorCallback,
  generation = getResourceGeneration(),
  signal?: AbortSignal,
): Promise<LanguageModel> {
  return createSharedModel(
    "prompt",
    makePromptKey(target.nativeLanguage, target.foreignLanguage),
    (sharedSignal) => {
      const api = getModelApi("prompt");
      if (!api) throw new Error(MODEL_UNAVAILABLE.prompt);
      return api.create({
        ...target.options,
        initialPrompts: [{ role: "system", content: target.initialPrompt }],
        monitor,
        signal: sharedSignal,
      });
    },
    generation,
    signal,
  );
}

async function prepareTarget(
  target: TranslationPreparationTarget,
  monitor: CreateMonitorCallback,
  generation: number,
  signal?: AbortSignal,
): Promise<void> {
  ensurePreparationActive(generation, signal);
  if (!getModelApi(target.kind))
    throw new Error(MODEL_UNAVAILABLE[target.kind]);
  if (target.availability === "unavailable") {
    throw new Error(
      target.kind === "prompt"
        ? MODEL_UNAVAILABLE.prompt
        : `この言語ペア（${target.sourceLanguage}→${target.targetLanguage}）は翻訳できません。${CHANGE_LANGUAGE}`,
    );
  }
  if (target.kind === "translator") {
    await createTranslator(
      target.sourceLanguage,
      target.targetLanguage,
      monitor,
      generation,
      signal,
    );
  } else {
    await createPrompt(target, monitor, generation, signal);
  }
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
  generation = getResourceGeneration(),
  signal?: AbortSignal,
): Promise<TranslationResult> {
  ensurePreparationActive(generation, signal);
  if (!getModelApi("translator")) {
    return {
      status: "unavailable",
      message: MODEL_UNAVAILABLE.translator,
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
      const availability = await getModelApi("translator")!.availability({
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
      message: `この言語設定（${nativeTag}↔${foreignTag}）は翻訳できません。${CHANGE_LANGUAGE}`,
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
 * getResourceGeneration()で共有所有し、個別要求の中断で共有作成Promiseを壊さない。
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
  const generation = getResourceGeneration();
  ensurePreparationActive(generation, signal);
  if (engine === "prompt") {
    return runPromptTranslation(
      text,
      nativeLanguage,
      foreignLanguage,
      signal,
      onChunk,
      generation,
    );
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
  if (!getModelApi("translator") || !getModelApi("detector")) {
    return {
      status: "unavailable",
      message: `このブラウザはTranslator APIに対応していません。${USE_PROMPT_INSTEAD}`,
    };
  }
  return directionChoice
    ? runDirectedTranslation(
        text,
        nativeLanguage,
        foreignLanguage,
        signal,
        onChunk,
        generation,
        nativeTag,
        foreignTag,
        directionChoice,
      )
    : runDetectedTranslation(
        text,
        nativeLanguage,
        foreignLanguage,
        signal,
        onChunk,
        generation,
        nativeTag,
        foreignTag,
      );
}

async function runPromptTranslation(
  text: string,
  nativeLanguage: string,
  foreignLanguage: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
  generation: number,
): Promise<TranslationResult> {
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
  if (
    !modelSlots.prompt.resource ||
    modelSlots.prompt.resource.key !== promptKey
  ) {
    if (!getModelApi("prompt")) {
      return {
        status: "unavailable",
        message: MODEL_UNAVAILABLE.prompt,
      };
    }
    const availability =
      await getModelApi("prompt")!.availability(promptOptions);
    ensurePreparationActive(generation, signal);
    if (availability === "unavailable") {
      return {
        status: "unavailable",
        message: MODEL_UNAVAILABLE.prompt,
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
      engine: "prompt",
      preparation: preparation.preparation,
      onProgress: () => undefined,
      signal,
    });
  }

  ensurePreparationActive(generation, signal);
  if (!modelSlots.prompt.resource) {
    return {
      status: "unavailable",
      message: MODEL_UNAVAILABLE.prompt,
    };
  }
  let executionSession: LanguageModel | undefined;
  try {
    executionSession = await modelSlots.prompt.resource.instance.clone({
      signal,
    });
    await consumeStream(
      await executionSession.promptStreaming(text, { signal }),
      onChunk,
    );
    return { status: "translated" };
  } finally {
    executionSession?.destroy();
  }
}

async function runDirectedTranslation(
  text: string,
  nativeLanguage: string,
  foreignLanguage: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
  generation: number,
  nativeTag: string,
  foreignTag: string,
  directionChoice: TranslationDirectionChoice,
): Promise<TranslationResult> {
  const direction =
    directionChoice === "native-to-foreign"
      ? { sourceLanguage: nativeTag, targetLanguage: foreignTag }
      : { sourceLanguage: foreignTag, targetLanguage: nativeTag };
  const pairKey = makePairKey(
    direction.sourceLanguage,
    direction.targetLanguage,
  );

  if (modelSlots.translator.resource?.key !== pairKey) {
    const availability =
      await getModelApi("translator")!.availability(direction);
    ensurePreparationActive(generation, signal);
    if (availability === "unavailable") {
      return {
        status: "unavailable",
        message: `この言語ペア（${direction.sourceLanguage}→${direction.targetLanguage}）は翻訳できません。${CHANGE_LANGUAGE}`,
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
      generation,
      signal,
    );
  }

  ensurePreparationActive(generation, signal);
  if (
    !modelSlots.translator.resource ||
    modelSlots.translator.resource.key !== pairKey
  ) {
    return {
      status: "unavailable",
      message: MODEL_UNAVAILABLE.translator,
    };
  }
  await consumeStream(
    await modelSlots.translator.resource.instance.translateStreaming(text, {
      signal,
    }),
    onChunk,
  );
  return { status: "translated" };
}

async function runDetectedTranslation(
  text: string,
  nativeLanguage: string,
  foreignLanguage: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
  generation: number,
  nativeTag: string,
  foreignTag: string,
): Promise<TranslationResult> {
  if (!modelSlots.detector.resource?.instance) {
    const availability = await getModelApi("detector")!.availability();
    ensurePreparationActive(generation, signal);
    if (availability === "unavailable") {
      return {
        status: "unavailable",
        message: `このブラウザはLanguage Detector APIに対応していません。${USE_PROMPT_INSTEAD}`,
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
  if (!modelSlots.detector.resource?.instance) {
    return {
      status: "unavailable",
      message: MODEL_UNAVAILABLE.detector,
    };
  }
  const detections = await modelSlots.detector.resource?.instance.detect(text, {
    signal,
  });
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
  if (
    !modelSlots.translator.resource ||
    modelSlots.translator.resource.key !== pairKey
  ) {
    const availability = await getModelApi("translator")!.availability({
      sourceLanguage: direction.sourceLanguage,
      targetLanguage: direction.targetLanguage,
    });
    ensurePreparationActive(generation, signal);
    if (availability === "unavailable") {
      return {
        status: "unavailable",
        message: `この言語ペア（${direction.sourceLanguage}→${direction.targetLanguage}）は翻訳できません。${CHANGE_LANGUAGE}`,
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
      generation,
      signal,
    );
  }

  ensurePreparationActive(generation, signal);
  if (!modelSlots.translator.resource) {
    return {
      status: "unavailable",
      message: MODEL_UNAVAILABLE.translator,
    };
  }
  await consumeStream(
    await modelSlots.translator.resource.instance.translateStreaming(text, {
      signal,
    }),
    onChunk,
  );
  return { status: "translated" };
}

/** 翻訳方向の選択肢を利用者向けの日本語へ変換する */
export function describePreparationDirection(
  target: TranslationPreparationTarget,
): string {
  return target.kind === "prompt"
    ? "Prompt API"
    : getDirectionLabel(target.direction);
}
