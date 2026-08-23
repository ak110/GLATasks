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
  | { kind: "detector" }
  | {
      kind: "translator";
      sourceLanguage: string;
      targetLanguage: string;
    }
  | {
      kind: "prompt";
      nativeLanguage: string;
      foreignLanguage: string;
      options: PromptLanguageOptions;
      initialPrompt: string;
    };

export type TranslationResult =
  | { status: "translated" }
  | {
      status: "prepare";
      preparation: readonly TranslationPreparationTarget[];
    }
  | { status: "unavailable"; message: string };

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
  if (target.kind === "detector") return "翻訳モデル";
  if (target.kind === "prompt") return "翻訳モデル";
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
 * 利用者操作のイベントハンドラ内で不足する内蔵AIインスタンスを作成する。
 * `create()`はブラウザのtransient activationを要するため、自動翻訳から呼び出さない。
 * https://developer.mozilla.org/en-US/docs/Web/API/Prompt_API/Using
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
    if (engine === "translator" && target.kind === "prompt") continue;
    if (engine === "prompt" && target.kind !== "prompt") continue;

    if (target.kind === "detector") {
      if (resources.detector) continue;
      if (typeof globalThis.LanguageDetector === "undefined") {
        throw new Error("Language Detector APIを利用できません");
      }
      resources.detector = await globalThis.LanguageDetector.create({
        monitor,
      });
      continue;
    }

    if (target.kind === "translator") {
      const key = makePairKey(target.sourceLanguage, target.targetLanguage);
      if (resources.translator?.key === key) continue;
      resources.translator?.instance.destroy();
      resources.translator = undefined;
      if (typeof globalThis.Translator === "undefined") {
        throw new Error("Translator APIを利用できません");
      }
      resources.translator = {
        key,
        instance: await globalThis.Translator.create({
          sourceLanguage: target.sourceLanguage,
          targetLanguage: target.targetLanguage,
          monitor,
        }),
      };
      continue;
    }

    const key = makePromptKey(target.nativeLanguage, target.foreignLanguage);
    if (resources.prompt?.key === key) continue;
    resources.prompt?.instance.destroy();
    resources.prompt = undefined;
    if (typeof globalThis.LanguageModel === "undefined") {
      throw new Error("Prompt APIを利用できません");
    }
    resources.prompt = {
      key,
      instance: await globalThis.LanguageModel.create({
        ...target.options,
        initialPrompts: [{ role: "system", content: target.initialPrompt }],
        monitor,
      }),
    };
  }
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

function makePrepareResult(
  preparation: TranslationPreparationTarget,
): TranslationResult {
  return { status: "prepare", preparation: [preparation] };
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
      return makePrepareResult({
        kind: "prompt",
        nativeLanguage,
        foreignLanguage,
        options: promptOptions,
        initialPrompt: buildTranslationPrompt(nativeLanguage, foreignLanguage),
      });
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
    return makePrepareResult({ kind: "detector" });
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
    return makePrepareResult({
      kind: "translator",
      sourceLanguage: direction.sourceLanguage,
      targetLanguage: direction.targetLanguage,
    });
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
