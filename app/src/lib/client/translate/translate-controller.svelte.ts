/**
 * @fileoverview 翻訳画面の要求、準備、実行と設定の状態管理
 */

import { untrack } from "svelte";
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
  let availability = $state<
    "uninitialized" | "checking" | "ready" | "destroyed"
  >("uninitialized");
  const initialized = $derived(
    availability === "checking" || availability === "ready",
  );
  const availabilityReady = $derived(availability === "ready");
  let statusMessage = $state("");
  type TranslationWork =
    | { phase: "idle" }
    | { phase: "scheduled"; timer: ReturnType<typeof setTimeout> }
    | { phase: "translating"; controller: AbortController }
    | { phase: "waiting"; pending: PendingPreparation; stale: boolean };
  type PreparationWork = {
    pending: PendingPreparation;
    progress: number;
    token: object;
  };
  type Work =
    | TranslationWork
    | ({ phase: "preparing" } & PreparationWork)
    | ({ phase: "refreshing"; latest: TranslationWork } & PreparationWork);
  let work = $state.raw<Work>({ phase: "idle" });
  const isPreparing = $derived(
    work.phase === "preparing" || work.phase === "refreshing",
  );
  const preparationProgress = $derived(
    work.phase === "preparing" || work.phase === "refreshing"
      ? work.progress
      : undefined,
  );
  const pendingPreparation = $derived.by(() => {
    if (work.phase === "refreshing") {
      return work.latest.phase === "waiting"
        ? work.latest.pending
        : work.pending;
    }
    return work.phase === "waiting" || work.phase === "preparing"
      ? work.pending
      : undefined;
  });
  const pendingPreparationStale = $derived(
    (work.phase === "waiting" && work.stale) ||
      (work.phase === "refreshing" &&
        (work.latest.phase !== "waiting" || work.latest.stale)),
  );

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

  function cancelTranslation(previous: Work): void {
    if (previous.phase === "scheduled") clearTimeout(previous.timer);
    if (previous.phase === "translating") previous.controller.abort();
    if (previous.phase === "refreshing") cancelTranslation(previous.latest);
  }

  function transition(next: Work): void {
    const previous = work;
    work = next;
    cancelTranslation(previous);
  }

  function transitionTranslation(next: TranslationWork): void {
    if (work.phase === "refreshing") {
      const previous = work.latest;
      work = { ...work, latest: next };
      cancelTranslation(previous);
    } else {
      transition(next);
    }
  }

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

  function makeCurrentRequest(
    direction: TranslationDirectionChoice | undefined,
  ): TranslationRequest {
    return {
      sourceText,
      nativeLanguage,
      foreignLanguage,
      engine: selectedEngine,
      direction: selectedEngine === "translator" ? direction : undefined,
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
    if (work.phase === "preparing") {
      // 原文が変わっても共有モデル作成は続ける。その間も新しい原文の準備要否は独立して判定する。
      work = { ...work, phase: "refreshing", latest: { phase: "idle" } };
    } else if (work.phase === "waiting") {
      work = { ...work, stale: true };
    } else if (work.phase === "refreshing" && work.latest.phase === "waiting") {
      work = { ...work, latest: { ...work.latest, stale: true } };
    } else {
      transitionTranslation({ phase: "idle" });
    }
  }

  /**
   * 準備対象を陳腐化としてマークし、進行中の要求と共有作成を中断する
   *
   * 言語・エンジンの変更は準備対象を変えるため、以前の対象の作成を継続しない。
   * 要求を先に中断することで、共有作成の放棄が状態表示へ到達しないようにする。
   */
  function invalidatePendingPreparation(): void {
    transition({ phase: "idle" });
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
    if (nativeLanguage === value) return;
    nativeLanguage = value;
    resetSettings();
  }

  function handleForeignLanguageInput(value: string): void {
    if (foreignLanguage === value) return;
    foreignLanguage = value;
    resetSettings();
  }

  function handleEngineChange(value: TranslateEngine): void {
    if (selectedEngine === value) return;
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
    if (sourceText === value) return;
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

    if (isPreparing) return;
    if (work.phase === "waiting") {
      const pendingIndex = work.pending.preparation.findIndex(
        (target) =>
          target.kind === "translator" &&
          target.direction === selectedTarget.direction,
      );
      if (pendingIndex >= 0) {
        work = {
          ...work,
          pending: { ...work.pending, selectedIndex: pendingIndex },
        };
        statusMessage = `準備対象: ${describePreparationDirection(selectedTarget)}`;
      }
      return;
    }

    selectedDirection = selectedTarget.direction;
    if (availabilityReady)
      scheduleTranslation(makeCurrentRequest(selectedDirection));
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
    transitionTranslation({ phase: "translating", controller });
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
          const pending: PendingPreparation = {
            request,
            translationUnits,
            preparation: result.preparation,
            selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
            translationIndex: index,
            translatedText,
          };
          transitionTranslation({ phase: "waiting", pending, stale: false });
          statusMessage = `準備が必要です: ${result.preparation.map(describePreparationDirection).join("、")}。「モデルを準備する」ボタンを押してください`;
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
      const current = work.phase === "refreshing" ? work.latest : work;
      if (
        current.phase === "translating" &&
        current.controller === controller
      ) {
        transitionTranslation({ phase: "idle" });
      }
    }
  }

  async function handlePrepare(): Promise<void> {
    if (
      work.phase !== "waiting" ||
      work.stale ||
      !isCurrentRequest(work.pending.request)
    )
      return;
    const pending = work.pending;
    const selectedTarget = pending.preparation[pending.selectedIndex];
    if (!selectedTarget) return;

    if (
      selectedTarget.requiresUserActivation &&
      typeof navigator !== "undefined" &&
      navigator.userActivation &&
      !navigator.userActivation.isActive
    ) {
      statusMessage = "準備するにはこのボタンをもう一度押してください";
      return;
    }

    const token = {};
    transition({
      phase: "preparing",
      pending,
      progress: 0,
      token,
    });
    statusMessage = "準備中...";
    const currentPreparation = () =>
      (work.phase === "preparing" || work.phase === "refreshing") &&
      work.token === token
        ? work
        : undefined;
    try {
      await prepareEngine({
        engine: pending.request.engine,
        preparation: [selectedTarget],
        onProgress: (progress) => {
          const current = currentPreparation();
          if (current?.phase === "preparing") {
            work = { ...current, progress: Math.round(progress * 100) };
          }
        },
      });

      const current = currentPreparation();
      if (current?.phase !== "preparing" || !isCurrentRequest(pending.request))
        return;
      if (
        selectedTarget.kind === "translator" &&
        selectedTarget.requiresDirectionChoice
      ) {
        selectedDirection = selectedTarget.direction;
        updateDirectionPreparations(pending.preparation);
      } else {
        selectedDirection = undefined;
        directionPreparations = [];
      }
      const request = makeCurrentRequest(selectedDirection);
      transition({ phase: "idle" });
      void executeTranslation(request, ++requestSequence, pending);
    } catch (error) {
      const current = currentPreparation();
      if (current?.phase === "preparing" && isCurrentRequest(pending.request)) {
        statusMessage = extractErrorMessage(error);
        transition({ phase: "waiting", pending, stale: false });
      }
    } finally {
      const current = currentPreparation();
      // 準備されたモデルは共有資源に残るが、操作が古ければ画面には反映しない。
      if (current?.phase === "refreshing") work = current.latest;
      else if (current) transition({ phase: "idle" });
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

    availability = "checking";
    const sequence = ++availabilitySequence;
    void detectEngineAvailability(native, foreign)
      .then((engines) => {
        if (sequence !== availabilitySequence) return;
        availableEngines = [...engines];
        availability = "ready";
      })
      .catch((error: unknown) => {
        if (sequence !== availabilitySequence) return;
        availableEngines = [];
        availability = "ready";
        statusMessage = extractErrorMessage(error);
      });
  });

  $effect(() => {
    if (!initialized || !availabilityReady) return;
    if (availableEngines.includes(selectedEngine)) return;

    selectedEngine = availableEngines[0] ?? TRANSLATE_DEFAULTS.engine;
    saveSettings();
  });

  function scheduleTranslation(request: TranslationRequest): void {
    const sequence = ++requestSequence;
    statusMessage = "";
    if (
      !request.sourceText.trim() ||
      !availableEngines.includes(request.engine)
    ) {
      transitionTranslation({ phase: "idle" });
      targetText = "";
      return;
    }
    const timer = setTimeout(() => {
      void executeTranslation(request, sequence);
    }, 600);
    transitionTranslation({ phase: "scheduled", timer });
  }

  $effect(() => {
    // 準備から再開する時にも方向を確定するため、その更新だけでは先頭から再実行しない。
    const request = makeCurrentRequest(untrack(() => selectedDirection));
    if (!availabilityReady) return;
    void availableEngines;
    untrack(() => scheduleTranslation(request));
  });

  function initialize(): void {
    if (initialized) return;
    const settings = getStoredTranslateSettings();
    nativeLanguage = settings.nativeLanguage;
    foreignLanguage = settings.foreignLanguage;
    selectedEngine = settings.engine;
    availability = "checking";
  }

  function destroy(): void {
    availability = "destroyed";
    availabilitySequence++;
    requestSequence++;
    transition({ phase: "idle" });
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
