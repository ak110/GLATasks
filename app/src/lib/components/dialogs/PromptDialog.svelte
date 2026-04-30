<script lang="ts">
    /**
     * @fileoverview 入力ダイアログ（globalThis.prompt の代替）
     *
     * OK/Cancelボタンを持つため `onCancel`/`onSubmit` 命名を採用している。
     * 既存の `onClose`/`onSubmit` 命名（TaskEditDialog等）とは意図的に分離している。
     */

    // タイトルあり時は <h2> の id を aria-labelledby で参照し、
    // タイトルなし時は aria-label でフォールバックする
    const titleId = crypto.randomUUID();

    type Props = {
        open: boolean;
        title?: string;
        message?: string;
        placeholder?: string;
        defaultValue?: string;
        submitLabel?: string;
        cancelLabel?: string;
        onSubmit: (value: string) => void | Promise<void>;
        onCancel: () => void;
        /** バリデーター。エラーメッセージを返す。問題なければ null を返す */
        validator?: (value: string) => string | null;
    };

    let {
        open,
        title,
        message,
        placeholder = "",
        defaultValue = "",
        submitLabel = "OK",
        cancelLabel = "キャンセル",
        onSubmit,
        onCancel,
        validator,
    }: Props = $props();

    let inputValue = $state("");
    let inputEl = $state<HTMLInputElement | null>(null);

    const validationError = $derived(validator ? validator(inputValue) : null);

    // open が偽から真へ遷移した瞬間にローカル状態を初期化し、input へフォーカスを移す
    // $state にすることで $effect の依存追跡が正しく機能する
    let prevOpen = $state(false);
    $effect(() => {
        if (open && !prevOpen) {
            inputValue = defaultValue;
            queueMicrotask(() => {
                inputEl?.focus();
                inputEl?.select();
            });
        }
        prevOpen = open;
    });

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
        }
    }

    function handleSubmit() {
        if (validationError !== null) return;
        onSubmit(inputValue);
    }
</script>

{#if open}
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 sm:p-0"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "入力ダイアログ"}
        onkeydown={handleKeydown}
    >
        <div
            class="w-full max-w-sm rounded-lg bg-white shadow-xl dark:bg-gray-800"
        >
            {#if title}
                <div class="flex items-center justify-between px-6 py-4">
                    <h2
                        id={titleId}
                        class="text-lg font-semibold text-gray-800 dark:text-gray-100"
                    >
                        {title}
                    </h2>
                    <button
                        onclick={onCancel}
                        class="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                        aria-label="閉じる"
                        title="閉じる"
                    >
                        ✕
                    </button>
                </div>
            {:else}
                <div class="pt-6"></div>
            {/if}
            <div class="p-6">
                {#if message}
                    <p class="mb-4 text-gray-700 dark:text-gray-200">
                        {message}
                    </p>
                {/if}
                <input
                    bind:this={inputEl}
                    bind:value={inputValue}
                    type="text"
                    {placeholder}
                    onkeydown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            handleSubmit();
                        }
                    }}
                    class="w-full rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                {#if validationError}
                    <p class="mt-1 text-sm text-red-600 dark:text-red-400">
                        {validationError}
                    </p>
                {/if}
                <div class="mt-6 flex justify-end gap-2">
                    <button
                        onclick={onCancel}
                        class="cursor-pointer rounded bg-gray-100 px-6 py-2 text-gray-700 hover:bg-gray-200 focus:outline-none dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onclick={handleSubmit}
                        disabled={validationError !== null}
                        class="cursor-pointer rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {submitLabel}
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}
