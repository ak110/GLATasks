/**
 * @fileoverview 翻訳画面の要求、準備、実行と設定の状態管理
 */

import { extractErrorMessage } from "#lib/client/ui/extract-error-message.ts";
import {
  getStoredTranslateSettings,
  buildPromptLanguageOptions,
  resolveLanguageTag,
  setStoredTranslateSettings,
  PROMPT_LANGUAGE_TAGS,
  TRANSLATE_DEFAULTS,
  splitTranslationUnits,
  type TranslateEngine,
} from "#lib/client/translate/translate.ts";
import {
  abandonEngineCreations,
  MODEL_UNAVAILABLE,
  describePreparationDirection,
  detectEngineAvailability,
  destroyTranslationResources,
  prepareEngine,
  runTranslation,
  type TranslationDirectionChoice,
  type TranslationPreparationTarget,
} from "#lib/client/translate/translate-client.ts";

export function createTranslationController() {
  type TranslationRequest = {
    sourceText: string;
    nativeLanguage: string;
    foreignLanguage: string;
    engine: TranslateEngine;
    direction?: TranslationDirectionChoice;
  };

  type TranslatorPreparation = Extract<
    TranslationPreparationTarget,
    { kind: "translator" }
  >;

  type PendingPreparation = {
    request: TranslationRequest;
    translationUnits: readonly string[];
    preparation: readonly TranslationPreparationTarget[];
    selectedIndex: number;
    translationIndex: number;
    translatedText: string;
  };

  let nativeLanguage = $state<string>(TRANSLATE_DEFAULTS.nativeLanguage);
  let foreignLanguage = $state<string>(TRANSLATE_DEFAULTS.foreignLanguage);
  let selectedEngine = $state<TranslateEngine>(TRANSLATE_DEFAULTS.engine);
  let sourceText = $state("");
  let targetText = $state("");
  let availableEngines = $state<TranslateEngine[]>([]);
  let availabilityReady = $state(false);
  let initialized = $state(false);
  let statusMessage = $state("");
  let isPreparing = $state(false);
  let preparationProgress = $state<number | undefined>(undefined);
  let pendingPreparation = $state<PendingPreparation | undefined>(undefined);
  let pendingPreparationStale = $state(false);
  let directionPreparations = $state<readonly TranslatorPreparation[]>([]);
  let selectedDirection = $state<
    TranslatorPreparation["direction"] | undefined
  >(undefined);

  const selectedPreparationTarget = $derived(
    pendingPreparation?.preparation[pendingPreparation.selectedIndex],
  );
  const selectedDirectionIndex = $derived.by(() => {
    const pendingTarget = selectedPreparationTarget;
    const direction =
      pendingTarget?.kind === "translator"
        ? pendingTarget.direction
        : selectedDirection;
    const index = direction
      ? directionPreparations.findIndex(
          (target) => target.direction === direction,
        )
      : 0;
    return index >= 0 ? index : 0;
  });

  let requestSequence = 0;
  let availabilitySequence = 0;
  let activeController: AbortController | undefined;
  let scheduledTranslationTimer: ReturnType<typeof setTimeout> | undefined;

  const nativeTag = $derived(resolveLanguageTag(nativeLanguage));
  const foreignTag = $derived(resolveLanguageTag(foreignLanguage));
  const promptOptions = $derived(
    buildPromptLanguageOptions(nativeLanguage, foreignLanguage),
  );
  const languageStatus = $derived.by(() => {
    if (nativeTag === null || foreignTag === null) {
      return "母語・相手言語を解決できません。言語タグ（en・fr）を入力してください";
    }
    if (availableEngines.includes("translator") && promptOptions === null) {
      return `この設定では${MODEL_UNAVAILABLE.prompt}。対応言語: ${PROMPT_LANGUAGE_TAGS.join("・")}`;
    }
    return "";
  });
  const engineAvailabilityMessage = $derived(
    availableEngines.length === 1 && availableEngines[0] === "prompt"
      ? "Prompt APIがこの言語設定で利用可能です。"
      : "",
  );
  const displayedStatus = $derived.by(() => {
    if (statusMessage) return statusMessage;
    if (!initialized) return "";
    if (!availabilityReady) return "翻訳機能を確認しています...";
    if (availableEngines.length === 0) {
      return "このブラウザはブラウザ内蔵の翻訳機能に対応していません。Chrome 138以降のデスクトップ版とブラウザ内蔵モデルが必要です";
    }
    if (pendingPreparationStale)
      return "入力または設定の変更を確認しています...";
    return languageStatus;
  });
  const sourceDisabled = $derived(
    initialized && availabilityReady && availableEngines.length === 0,
  );

  function makeCurrentRequest(): TranslationRequest {
    return {
      sourceText,
      nativeLanguage,
      foreignLanguage,
      engine: selectedEngine,
      direction:
        selectedEngine === "translator" ? selectedDirection : undefined,
    };
  }

  function isCurrentRequest(request: TranslationRequest): boolean {
    return (
      request.sourceText === sourceText &&
      request.nativeLanguage === nativeLanguage &&
      request.foreignLanguage === foreignLanguage &&
      request.engine === selectedEngine &&
      request.direction ===
        (selectedEngine === "translator" ? selectedDirection : undefined)
    );
  }

  function saveSettings(): void {
    setStoredTranslateSettings({
      nativeLanguage,
      foreignLanguage,
      engine: selectedEngine,
    });
  }

  /** 準備要求を陳腐化としてマークする */
  function markPendingPreparationStale(): void {
    if (pendingPreparation) pendingPreparationStale = true;
  }

  /**
   * 準備対象を陳腐化としてマークし、進行中の要求と共有作成を中断する
   *
   * 言語・エンジンの変更は準備対象を変えるため、以前の対象の作成を継続しない。
   * 要求を先に中断することで、共有作成の放棄が状態表示へ到達しないようにする。
   */
  function invalidatePendingPreparation(): void {
    markPendingPreparationStale();
    activeController?.abort();
    abandonEngineCreations();
  }

  function resetSettings(): void {
    selectedDirection = undefined;
    directionPreparations = [];
    statusMessage = "";
    invalidatePendingPreparation();
    saveSettings();
  }

  function handleNativeLanguageInput(value: string): void {
    nativeLanguage = value;
    resetSettings();
  }

  function handleForeignLanguageInput(value: string): void {
    foreignLanguage = value;
    resetSettings();
  }

  function handleEngineChange(value: TranslateEngine): void {
    selectedEngine = value;
    resetSettings();
  }

  /**
   * 原文の変更を反映する
   *
   * 原文はTranslatorの言語ペアもPromptの準備キーも変えないため、進行中のモデル作成は
   * 中断せず、準備要求の陳腐化だけを記録する。
   */
  function handleSourceInput(value: string): void {
    sourceText = value;
    statusMessage = "";
    markPendingPreparationStale();
    if (!sourceText.trim()) targetText = "";
  }

  function handlePreparationDirectionChange(selectedIndex: number): void {
    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= directionPreparations.length
    ) {
      return;
    }
    const selectedTarget = directionPreparations[selectedIndex];
    if (!selectedTarget) return;

    if (pendingPreparation) {
      const pendingIndex = pendingPreparation.preparation.findIndex(
        (target) =>
          target.kind === "translator" &&
          target.direction === selectedTarget.direction,
      );
      if (pendingIndex >= 0) {
        pendingPreparation = {
          ...pendingPreparation,
          selectedIndex: pendingIndex,
        };
        statusMessage = `準備対象: ${describePreparationDirection(selectedTarget)}`;
      }
      return;
    }

    selectedDirection = selectedTarget.direction;
    statusMessage = `翻訳方向を変更しました: ${describePreparationDirection(selectedTarget)}`;
  }

  function updateDirectionPreparations(
    preparation: readonly TranslationPreparationTarget[],
  ): void {
    const next = [...directionPreparations];
    for (const target of preparation) {
      if (target.kind === "translator") {
        const index = next.findIndex(
          (candidate) => candidate.direction === target.direction,
        );
        if (index >= 0) next[index] = target;
        else next.push(target);
      }
    }
    directionPreparations = next;
  }

  async function executeTranslation(
    request: TranslationRequest,
    sequence: number,
    resume?: Pick<
      PendingPreparation,
      "translationUnits" | "translationIndex" | "translatedText"
    >,
  ): Promise<void> {
    if (
      sequence !== requestSequence ||
      !request.sourceText.trim() ||
      !availableEngines.includes(request.engine)
    ) {
      return;
    }

    const controller = new AbortController();
    activeController = controller;
    pendingPreparation = undefined;
    pendingPreparationStale = false;
    const translationUnits =
      resume?.translationUnits ?? splitTranslationUnits(request.sourceText);
    const startIndex = resume?.translationIndex ?? 0;
    let translatedText = resume?.translatedText ?? "";
    targetText = translatedText;
    statusMessage = "翻訳中...";

    try {
      for (let index = startIndex; index < translationUnits.length; index++) {
        if (sequence !== requestSequence || controller.signal.aborted) {
          return;
        }
        const translationUnit = translationUnits[index];
        if (translationUnit === undefined) continue;
        let receivedChunk = false;
        const result = await runTranslation(
          translationUnit,
          request.nativeLanguage,
          request.foreignLanguage,
          request.engine,
          controller.signal,
          (chunk) => {
            if (sequence === requestSequence && !controller.signal.aborted) {
              if (!receivedChunk && translatedText) {
                translatedText += "\n\n";
              }
              receivedChunk = true;
              translatedText += chunk;
              targetText = translatedText;
            }
          },
          request.direction,
        );

        if (sequence !== requestSequence || controller.signal.aborted) {
          return;
        }

        if (result.status === "prepare") {
          const translatorPreparations = result.preparation.filter(
            (target): target is TranslatorPreparation =>
              target.kind === "translator",
          );
          const directionChoicePreparations = translatorPreparations.filter(
            (target) => target.requiresDirectionChoice,
          );
          if (directionChoicePreparations.length > 0) {
            updateDirectionPreparations(directionChoicePreparations);
          } else {
            directionPreparations = [];
            selectedDirection = undefined;
          }
          const selectedIndex = request.direction
            ? result.preparation.findIndex(
                (target) =>
                  target.kind === "translator" &&
                  target.direction === request.direction,
              )
            : 0;
          pendingPreparation = {
            request,
            translationUnits,
            preparation: result.preparation,
            selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
            translationIndex: index,
            translatedText,
          };
          pendingPreparationStale = false;
          statusMessage = `準備が必要です: ${result.preparation.map(describePreparationDirection).join("、")}`;
          return;
        }
        if (result.status === "unavailable") {
          statusMessage = result.message;
          return;
        }
      }
      statusMessage = "";
    } catch (error) {
      if (sequence === requestSequence && !controller.signal.aborted) {
        statusMessage = extractErrorMessage(error);
      }
    } finally {
      if (sequence === requestSequence) {
        if (activeController === controller) activeController = undefined;
      }
    }
  }

  async function handlePrepare(): Promise<void> {
    if (
      isPreparing ||
      pendingPreparationStale ||
      !pendingPreparation ||
      !isCurrentRequest(pendingPreparation.request)
    ) {
      return;
    }

    const selectedTarget =
      pendingPreparation.preparation[pendingPreparation.selectedIndex];
    if (!selectedTarget) return;

    if (
      selectedTarget.kind === "translator" &&
      selectedTarget.requiresDirectionChoice
    ) {
      selectedDirection = selectedTarget.direction;
      updateDirectionPreparations(pendingPreparation.preparation);
    } else {
      selectedDirection = undefined;
      directionPreparations = [];
    }

    if (
      selectedTarget.requiresUserActivation &&
      typeof navigator !== "undefined" &&
      navigator.userActivation &&
      !navigator.userActivation.isActive
    ) {
      statusMessage = "準備するにはこのボタンをもう一度押してください";
      return;
    }

    if (scheduledTranslationTimer) {
      clearTimeout(scheduledTranslationTimer);
      scheduledTranslationTimer = undefined;
    }
    activeController?.abort();
    const preparationRequest = pendingPreparation;
    const request = makeCurrentRequest();
    const sequence = ++requestSequence;
    isPreparing = true;
    preparationProgress = 0;
    statusMessage = "準備中...";

    try {
      await prepareEngine({
        engine: request.engine,
        preparation: [selectedTarget],
        onProgress: (progress) => {
          if (isCurrentRequest(request)) {
            preparationProgress = Math.round(progress * 100);
          }
        },
      });

      if (!isCurrentRequest(request) || sequence !== requestSequence) {
        if (pendingPreparation === preparationRequest) {
          pendingPreparation = undefined;
          pendingPreparationStale = false;
        }
        return;
      }

      pendingPreparation = undefined;
      pendingPreparationStale = false;
      statusMessage = "";
      const nextSequence = ++requestSequence;
      void executeTranslation(request, nextSequence, {
        translationUnits: preparationRequest.translationUnits,
        translationIndex: preparationRequest.translationIndex,
        translatedText: preparationRequest.translatedText,
      });
    } catch (error) {
      if (isCurrentRequest(request)) {
        statusMessage = extractErrorMessage(error);
      }
    } finally {
      isPreparing = false;
      preparationProgress = undefined;
    }
  }

  async function copyTranslation(): Promise<void> {
    if (!targetText) return;
    try {
      await navigator.clipboard.writeText(targetText);
      statusMessage = "訳文をコピーしました";
    } catch (error) {
      statusMessage = extractErrorMessage(error);
    }
  }

  $effect(() => {
    const native = nativeLanguage;
    const foreign = foreignLanguage;
    if (!initialized) return;

    availabilityReady = false;
    const sequence = ++availabilitySequence;
    void detectEngineAvailability(native, foreign)
      .then((engines) => {
        if (sequence !== availabilitySequence) return;
        availableEngines = [...engines];
        availabilityReady = true;
      })
      .catch((error: unknown) => {
        if (sequence !== availabilitySequence) return;
        availableEngines = [];
        availabilityReady = true;
        statusMessage = extractErrorMessage(error);
      });
  });

  $effect(() => {
    if (!initialized || !availabilityReady) return;
    if (availableEngines.includes(selectedEngine)) return;

    selectedEngine = availableEngines[0] ?? TRANSLATE_DEFAULTS.engine;
    saveSettings();
  });

  $effect(() => {
    const request = makeCurrentRequest();
    if (!initialized || !availabilityReady) return;

    if (scheduledTranslationTimer) {
      clearTimeout(scheduledTranslationTimer);
      scheduledTranslationTimer = undefined;
    }
    const sequence = ++requestSequence;
    activeController?.abort();
    activeController = undefined;
    statusMessage = "";

    if (!request.sourceText.trim()) {
      targetText = "";
      return;
    }
    if (
      availableEngines.length === 0 ||
      !availableEngines.includes(request.engine)
    ) {
      targetText = "";
      return;
    }

    scheduledTranslationTimer = setTimeout(() => {
      scheduledTranslationTimer = undefined;
      void executeTranslation(request, sequence);
    }, 600);
    return () => {
      clearTimeout(scheduledTranslationTimer);
      scheduledTranslationTimer = undefined;
    };
  });

  function initialize(): void {
    const settings = getStoredTranslateSettings();
    nativeLanguage = settings.nativeLanguage;
    foreignLanguage = settings.foreignLanguage;
    selectedEngine = settings.engine;
    initialized = true;
  }

  function destroy(): void {
    activeController?.abort();
    if (scheduledTranslationTimer) clearTimeout(scheduledTranslationTimer);
    destroyTranslationResources();
  }

  return {
    get nativeLanguage() {
      return nativeLanguage;
    },
    get foreignLanguage() {
      return foreignLanguage;
    },
    get selectedEngine() {
      return selectedEngine;
    },
    get sourceText() {
      return sourceText;
    },
    get targetText() {
      return targetText;
    },
    get availableEngines() {
      return availableEngines;
    },
    get availabilityReady() {
      return availabilityReady;
    },
    get initialized() {
      return initialized;
    },
    get isPreparing() {
      return isPreparing;
    },
    get preparationProgress() {
      return preparationProgress;
    },
    get pendingPreparation() {
      return pendingPreparation;
    },
    get pendingPreparationStale() {
      return pendingPreparationStale;
    },
    get directionPreparations() {
      return directionPreparations;
    },
    get selectedDirection() {
      return selectedDirection;
    },
    get selectedPreparationTarget() {
      return selectedPreparationTarget;
    },
    get selectedDirectionIndex() {
      return selectedDirectionIndex;
    },
    get engineAvailabilityMessage() {
      return engineAvailabilityMessage;
    },
    get displayedStatus() {
      return displayedStatus;
    },
    get sourceDisabled() {
      return sourceDisabled;
    },
    handleNativeLanguageInput,
    handleForeignLanguageInput,
    handleEngineChange,
    handleSourceInput,
    handlePreparationDirectionChange,
    handlePrepare,
    copyTranslation,
    initialize,
    destroy,
  };
}
