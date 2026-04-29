<script lang="ts">
    /**
     * @fileoverview 確認ダイアログ（globalThis.confirm の代替）
     *
     * OK/Cancelボタンを持つため `onCancel`/`onConfirm` 命名を採用している。
     * 既存の `onClose`/`onSubmit` 命名（TaskEditDialog等）とは意図的に分離している。
     */

    // タイトルあり時は <h2> の id を aria-labelledby で参照し、
    // タイトルなし時は aria-label でフォールバックする
    const titleId = crypto.randomUUID();

    type Props = {
        open: boolean;
        title?: string;
        message: string;
        confirmLabel?: string;
        cancelLabel?: string;
        /** "danger" を指定すると確認ボタンが赤系になる */
        variant?: "default" | "danger";
        onConfirm: () => void | Promise<void>;
        onCancel: () => void;
    };

    let {
        open,
        title,
        message,
        confirmLabel = "OK",
        cancelLabel = "キャンセル",
        variant = "default",
        onConfirm,
        onCancel,
    }: Props = $props();

    let cancelButtonEl = $state<HTMLButtonElement | null>(null);

    // open が偽から真へ遷移した瞬間にキャンセルボタンへフォーカスを移す
    // $state にすることで $effect の依存追跡が正しく機能する
    let prevOpen = $state(false);
    $effect(() => {
        if (open && !prevOpen) {
            queueMicrotask(() => cancelButtonEl?.focus());
        }
        prevOpen = open;
    });

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
        }
    }

    const confirmClass = $derived(
        variant === "danger"
            ? "cursor-pointer rounded bg-red-600 px-6 py-2 text-white hover:bg-red-700 focus:outline-none"
            : "cursor-pointer rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 focus:outline-none",
    );
</script>

{#if open}
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 sm:p-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "確認ダイアログ"}
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
                <p class="text-gray-700 dark:text-gray-200">{message}</p>
                <div class="mt-6 flex justify-end gap-2">
                    <button
                        bind:this={cancelButtonEl}
                        onclick={onCancel}
                        class="cursor-pointer rounded bg-gray-100 px-6 py-2 text-gray-700 hover:bg-gray-200 focus:outline-none dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                    >
                        {cancelLabel}
                    </button>
                    <button onclick={onConfirm} class={confirmClass}>
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}
