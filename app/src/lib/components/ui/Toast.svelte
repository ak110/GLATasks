<script lang="ts">
    /**
     * @fileoverview エラートースト通知コンポーネント
     *
     * 画面右下に赤系のエラーメッセージを表示し、5秒後に自動消去する。
     * TimerAlarmMonitor のトースト（top-14）と重ならないよう bottom-4 に配置。
     */

    import { getToasts, dismissToast } from "$lib/toast-store.svelte";

    const toasts = $derived(getToasts());
</script>

{#if toasts.length > 0}
    <div class="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {#each toasts as toast (toast.id)}
            <div
                class="flex items-center gap-2 rounded-lg bg-red-100 text-red-800 shadow-lg dark:bg-red-900/40 dark:text-red-400"
                role="alert"
                data-testid="toast-error"
            >
                <span class="px-4 py-3 text-sm">{toast.message}</span>
                <button
                    class="cursor-pointer rounded p-1 pr-3 hover:bg-red-200 dark:hover:bg-red-900/60"
                    onclick={() => dismissToast(toast.id)}
                >
                    ✕
                </button>
            </div>
        {/each}
    </div>
{/if}
