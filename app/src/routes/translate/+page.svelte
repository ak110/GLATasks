<script lang="ts">
    /**
     * @fileoverview ブラウザ内蔵AIによる翻訳ページ
     */

    import { onDestroy, onMount } from "svelte";
    import Header from "$lib/components/layout/Header.svelte";
    import { extractErrorMessage } from "$lib/extract-error-message";
    import {
        getStoredTranslateSettings,
        buildPromptLanguageOptions,
        resolveLanguageTag,
        setStoredTranslateSettings,
        PROMPT_LANGUAGE_TAGS,
        TRANSLATE_DEFAULTS,
        type TranslateEngine,
    } from "$lib/translate";
    import {
        describePreparationDirection,
        detectEngineAvailability,
        destroyTranslationResources,
        prepareEngine,
        runTranslation,
        type TranslationPreparationTarget,
    } from "$lib/translate-client";

    type TranslationRequest = {
        sourceText: string;
        nativeLanguage: string;
        foreignLanguage: string;
        engine: TranslateEngine;
    };

    type PendingPreparation = {
        request: TranslationRequest;
        preparation: readonly TranslationPreparationTarget[];
        selectedIndex: number;
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

    const selectedPreparationTarget = $derived(
        pendingPreparation?.preparation[pendingPreparation.selectedIndex],
    );

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
            return `この設定ではPrompt APIを利用できません。対応言語: ${PROMPT_LANGUAGE_TAGS.join("・")}`;
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
        };
    }

    function isCurrentRequest(request: TranslationRequest): boolean {
        return (
            request.sourceText === sourceText &&
            request.nativeLanguage === nativeLanguage &&
            request.foreignLanguage === foreignLanguage &&
            request.engine === selectedEngine
        );
    }

    function saveSettings(): void {
        setStoredTranslateSettings({
            nativeLanguage,
            foreignLanguage,
            engine: selectedEngine,
        });
    }

    function markPendingPreparationStale(): void {
        if (pendingPreparation) pendingPreparationStale = true;
    }

    function handleNativeLanguageInput(event: Event): void {
        nativeLanguage = (event.currentTarget as HTMLInputElement).value;
        statusMessage = "";
        markPendingPreparationStale();
        saveSettings();
    }

    function handleForeignLanguageInput(event: Event): void {
        foreignLanguage = (event.currentTarget as HTMLInputElement).value;
        statusMessage = "";
        markPendingPreparationStale();
        saveSettings();
    }

    function handleEngineChange(event: Event): void {
        selectedEngine = (event.currentTarget as HTMLSelectElement)
            .value as TranslateEngine;
        statusMessage = "";
        markPendingPreparationStale();
        saveSettings();
    }

    function handleSourceInput(event: Event): void {
        sourceText = (event.currentTarget as HTMLTextAreaElement).value;
        statusMessage = "";
        markPendingPreparationStale();
        if (!sourceText.trim()) targetText = "";
    }

    function handlePreparationDirectionChange(event: Event): void {
        if (!pendingPreparation) return;
        const selectedIndex = Number(
            (event.currentTarget as HTMLSelectElement).value,
        );
        if (
            !Number.isInteger(selectedIndex) ||
            selectedIndex < 0 ||
            selectedIndex >= pendingPreparation.preparation.length
        ) {
            return;
        }
        pendingPreparation = { ...pendingPreparation, selectedIndex };
        statusMessage = `準備対象: ${describePreparationDirection(pendingPreparation.preparation[selectedIndex])}`;
    }

    async function executeTranslation(
        request: TranslationRequest,
        sequence: number,
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
        targetText = "";
        statusMessage = "翻訳中...";
        let translatedText = "";

        try {
            const result = await runTranslation(
                request.sourceText,
                request.nativeLanguage,
                request.foreignLanguage,
                request.engine,
                controller.signal,
                (chunk) => {
                    if (
                        sequence === requestSequence &&
                        !controller.signal.aborted
                    ) {
                        translatedText += chunk;
                        targetText = translatedText;
                    }
                },
            );

            if (sequence !== requestSequence || controller.signal.aborted) {
                return;
            }

            if (result.status === "prepare") {
                pendingPreparation = {
                    request,
                    preparation: result.preparation,
                    selectedIndex: 0,
                };
                pendingPreparationStale = false;
                statusMessage = `準備が必要です: ${result.preparation.map(describePreparationDirection).join("、")}`;
            } else if (result.status === "unavailable") {
                statusMessage = result.message;
            } else {
                statusMessage = "";
            }
        } catch (error) {
            if (sequence === requestSequence && !controller.signal.aborted) {
                statusMessage = extractErrorMessage(error);
            }
        } finally {
            if (sequence === requestSequence) {
                if (activeController === controller)
                    activeController = undefined;
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
            void executeTranslation(request, nextSequence);
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

    onMount(() => {
        const settings = getStoredTranslateSettings();
        nativeLanguage = settings.nativeLanguage;
        foreignLanguage = settings.foreignLanguage;
        selectedEngine = settings.engine;
        initialized = true;
    });

    onDestroy(() => {
        activeController?.abort();
        if (scheduledTranslationTimer) clearTimeout(scheduledTranslationTimer);
        destroyTranslationResources();
    });
</script>

<svelte:head>
    <title>翻訳 - GLATasks</title>
</svelte:head>

<Header page="translate" isLoading={false} />

<div
    class="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-7xl flex-col px-3 py-4 sm:px-4 sm:py-6"
>
    <div class="mb-6 shrink-0">
        <h1 class="text-xl font-bold text-gray-800 dark:text-gray-100">翻訳</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            入力を止めると、ブラウザ内蔵AIで自動的に翻訳します。
        </p>
    </div>

    <div class="mb-4 grid shrink-0 gap-3 sm:grid-cols-2">
        <label
            class="flex cursor-pointer flex-col gap-1 text-sm text-gray-700 dark:text-gray-200"
        >
            <span>入力側の言語（母語）</span>
            <input
                type="text"
                value={nativeLanguage}
                oninput={handleNativeLanguageInput}
                class="rounded border border-gray-300 bg-white px-3 py-2 text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                data-testid="translate-native-input"
            />
        </label>
        <label
            class="flex cursor-pointer flex-col gap-1 text-sm text-gray-700 dark:text-gray-200"
        >
            <span>母語のときの翻訳先</span>
            <input
                type="text"
                value={foreignLanguage}
                oninput={handleForeignLanguageInput}
                class="rounded border border-gray-300 bg-white px-3 py-2 text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                data-testid="translate-foreign-input"
            />
        </label>
        {#if availableEngines.length > 1 || availableEngines.includes("prompt")}
            <label
                class="flex cursor-pointer flex-col gap-1 text-sm text-gray-700 dark:text-gray-200"
            >
                <span>翻訳エンジン</span>
                <select
                    value={selectedEngine}
                    onchange={handleEngineChange}
                    class="cursor-pointer rounded border border-gray-300 bg-white px-3 py-2 text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    data-testid="translate-engine-select"
                >
                    {#if availableEngines.includes("translator")}
                        <option value="translator">Translator API</option>
                    {/if}
                    {#if availableEngines.includes("prompt")}
                        <option value="prompt">Prompt API</option>
                    {/if}
                </select>
                {#if engineAvailabilityMessage}
                    <span
                        class="text-xs text-gray-500 dark:text-gray-400"
                        data-testid="translate-engine-help"
                        >{engineAvailabilityMessage}</span
                    >
                {/if}
            </label>
        {/if}
    </div>

    <div
        class="grid min-h-0 flex-1 gap-3 sm:grid-cols-2"
        data-testid="translate-editor-grid"
    >
        <div class="flex min-h-64 min-w-0 flex-col gap-2 sm:min-h-0">
            <label
                for="translate-source"
                class="flex h-8 cursor-pointer items-center text-sm font-semibold text-gray-700 dark:text-gray-200"
                >原文</label
            >
            <textarea
                id="translate-source"
                value={sourceText}
                oninput={handleSourceInput}
                disabled={sourceDisabled}
                placeholder="翻訳する文章を入力"
                class="min-h-64 flex-1 resize-none rounded border border-gray-300 bg-white p-3 text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 sm:min-h-0 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:disabled:bg-gray-700"
                data-testid="translate-source-input"></textarea>
        </div>

        <div class="flex min-h-64 min-w-0 flex-col gap-2 sm:min-h-0">
            <div class="flex h-8 items-center justify-between gap-2">
                <label
                    for="translate-target"
                    class="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-200"
                    >訳文</label
                >
                <button
                    type="button"
                    onclick={copyTranslation}
                    disabled={!targetText}
                    class="h-8 cursor-pointer rounded bg-gray-100 px-3 text-sm text-gray-600 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    data-testid="translate-copy-btn">コピー</button
                >
            </div>
            <textarea
                id="translate-target"
                value={targetText}
                readonly
                class="min-h-64 flex-1 resize-none rounded border border-gray-300 bg-gray-50 p-3 text-gray-800 sm:min-h-0 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                data-testid="translate-target-output"></textarea>
        </div>
    </div>

    <div class="mt-3 flex min-h-9 shrink-0 flex-wrap items-center gap-3">
        <p
            class="text-sm text-gray-500 dark:text-gray-400"
            aria-live="polite"
            data-testid="translate-status"
        >
            {displayedStatus}
        </p>
        {#if pendingPreparation && !sourceDisabled}
            {#if pendingPreparation.preparation.length > 1}
                <label
                    class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
                    data-testid="translate-direction-field"
                >
                    <span>翻訳方向</span>
                    <select
                        value={pendingPreparation.selectedIndex}
                        onchange={handlePreparationDirectionChange}
                        disabled={isPreparing || pendingPreparationStale}
                        class="cursor-pointer rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        data-testid="translate-direction-select"
                    >
                        {#each pendingPreparation.preparation as target, index (target.kind === "translator" ? target.direction : target.kind)}
                            <option value={index}
                                >{describePreparationDirection(target)}</option
                            >
                        {/each}
                    </select>
                </label>
            {/if}
            {#if selectedPreparationTarget}
                <span
                    class="text-sm text-gray-600 dark:text-gray-300"
                    data-testid="translate-direction-status"
                >
                    {describePreparationDirection(selectedPreparationTarget)}
                </span>
            {/if}
            <button
                type="button"
                onclick={handlePrepare}
                disabled={isPreparing || pendingPreparationStale}
                class="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="translate-prepare-btn"
            >
                {#if isPreparing && preparationProgress !== undefined}
                    準備中（{preparationProgress}%）
                {:else}
                    モデルを準備する（{selectedPreparationTarget
                        ? describePreparationDirection(
                              selectedPreparationTarget,
                          )
                        : "モデル"}）
                {/if}
            </button>
        {/if}
    </div>
</div>
