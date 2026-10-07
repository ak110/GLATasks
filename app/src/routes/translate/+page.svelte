<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import Header from "#lib/components/layout/Header.svelte";
    import PageScrollArea from "#lib/components/layout/PageScrollArea.svelte";
    import { describePreparationDirection } from "#lib/translate-client.ts";
    import { createTranslationController } from "#lib/translate-controller.svelte.ts";
    import type { TranslateEngine } from "#lib/translate.ts";

    const translation = createTranslationController();
    onMount(translation.initialize);
    onDestroy(translation.destroy);

    function handleNativeLanguageInput(event: Event): void {
        translation.handleNativeLanguageInput(
            (event.currentTarget as HTMLInputElement).value,
        );
    }

    function handleForeignLanguageInput(event: Event): void {
        translation.handleForeignLanguageInput(
            (event.currentTarget as HTMLInputElement).value,
        );
    }

    function handleEngineChange(event: Event): void {
        translation.handleEngineChange(
            (event.currentTarget as HTMLSelectElement).value as TranslateEngine,
        );
    }

    function handleSourceInput(event: Event): void {
        translation.handleSourceInput(
            (event.currentTarget as HTMLTextAreaElement).value,
        );
    }

    function handlePreparationDirectionChange(event: Event): void {
        translation.handlePreparationDirectionChange(
            Number((event.currentTarget as HTMLSelectElement).value),
        );
    }
</script>

<Header page="translate" isLoading={false} />

<PageScrollArea>
    <div
        class="mx-auto flex w-full max-w-7xl flex-1 flex-col px-3 py-4 sm:px-4 sm:py-6"
    >
        <div class="mb-6 shrink-0">
            <h1 class="text-xl font-bold text-gray-800 dark:text-gray-100">
                翻訳
            </h1>
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
                    value={translation.nativeLanguage}
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
                    value={translation.foreignLanguage}
                    oninput={handleForeignLanguageInput}
                    class="rounded border border-gray-300 bg-white px-3 py-2 text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    data-testid="translate-foreign-input"
                />
            </label>
            {#if translation.availableEngines.length > 1 || translation.availableEngines.includes("prompt")}
                <label
                    class="flex cursor-pointer flex-col gap-1 text-sm text-gray-700 dark:text-gray-200"
                >
                    <span>翻訳エンジン</span>
                    <select
                        value={translation.selectedEngine}
                        onchange={handleEngineChange}
                        class="cursor-pointer rounded border border-gray-300 bg-white px-3 py-2 text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        data-testid="translate-engine-select"
                    >
                        {#if translation.availableEngines.includes("translator")}
                            <option value="translator">Translator API</option>
                        {/if}
                        {#if translation.availableEngines.includes("prompt")}
                            <option value="prompt">Prompt API</option>
                        {/if}
                    </select>
                    {#if translation.engineAvailabilityMessage}
                        <span
                            class="text-xs text-gray-500 dark:text-gray-400"
                            data-testid="translate-engine-help"
                            >{translation.engineAvailabilityMessage}</span
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
                    value={translation.sourceText}
                    oninput={handleSourceInput}
                    disabled={translation.sourceDisabled}
                    aria-busy={!translation.initialized ||
                        !translation.availabilityReady}
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
                        onclick={translation.copyTranslation}
                        disabled={!translation.targetText}
                        class="h-8 cursor-pointer rounded bg-gray-100 px-3 text-sm text-gray-600 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                        data-testid="translate-copy-btn">コピー</button
                    >
                </div>
                <textarea
                    id="translate-target"
                    value={translation.targetText}
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
                {translation.displayedStatus}
            </p>
            {#if !translation.sourceDisabled && translation.directionPreparations.length > 1}
                <label
                    class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
                    data-testid="translate-direction-field"
                >
                    <span>翻訳方向</span>
                    <select
                        value={translation.selectedDirectionIndex}
                        onchange={handlePreparationDirectionChange}
                        disabled={translation.isPreparing ||
                            translation.pendingPreparationStale}
                        class="cursor-pointer rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        data-testid="translate-direction-select"
                    >
                        {#each translation.directionPreparations as target, index (target.direction)}
                            <option value={index}
                                >{describePreparationDirection(target)}</option
                            >
                        {/each}
                    </select>
                </label>
            {/if}
            {#if translation.selectedPreparationTarget}
                <span
                    class="text-sm text-gray-600 dark:text-gray-300"
                    data-testid="translate-direction-status"
                >
                    {describePreparationDirection(
                        translation.selectedPreparationTarget,
                    )}
                </span>
            {:else if translation.selectedDirection && translation.directionPreparations[translation.selectedDirectionIndex]}
                <span
                    class="text-sm text-gray-600 dark:text-gray-300"
                    data-testid="translate-direction-status"
                >
                    {describePreparationDirection(
                        translation.directionPreparations[
                            translation.selectedDirectionIndex
                        ],
                    )}
                </span>
            {/if}
            {#if translation.pendingPreparation && !translation.sourceDisabled}
                <button
                    type="button"
                    onclick={translation.handlePrepare}
                    disabled={translation.isPreparing ||
                        translation.pendingPreparationStale}
                    class="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="translate-prepare-btn"
                >
                    {#if translation.isPreparing && translation.preparationProgress !== undefined}
                        準備中（{translation.preparationProgress}%）
                    {:else}
                        モデルを準備する（{translation.selectedPreparationTarget
                            ? describePreparationDirection(
                                  translation.selectedPreparationTarget,
                              )
                            : "モデル"}）
                    {/if}
                </button>
            {/if}
        </div>
    </div>
</PageScrollArea>
