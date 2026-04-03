<script lang="ts">
    /**
     * @fileoverview リスト統合ダイアログ（統合元リストの全タスクを統合先に移動）
     */

    import type { ListInfo } from "$lib/types";

    type Props = {
        open: boolean;
        sourceList: { id: number; title: string };
        allLists: ListInfo[];
        taskCount: number;
        onSubmit: (targetListId: number) => void;
        onClose: () => void;
    };

    let { open, sourceList, allLists, taskCount, onSubmit, onClose }: Props =
        $props();

    let selectedTargetId = $state("");

    // 統合先の候補: アクティブなリスト（自分自身を除く）
    let targetCandidates = $derived(
        allLists.filter((l) => l.status === "active" && l.id !== sourceList.id),
    );

    // ダイアログが開くたびに選択をリセット
    $effect(() => {
        if (open) {
            const candidates = allLists.filter(
                (l) => l.status === "active" && l.id !== sourceList.id,
            );
            selectedTargetId =
                candidates.length > 0 ? String(candidates[0].id) : "";
        }
    });

    function handleSubmit() {
        if (selectedTargetId) {
            onSubmit(Number(selectedTargetId));
        }
    }
</script>

{#if open}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-0"
        role="dialog"
        aria-modal="true"
    >
        <div
            class="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-800"
        >
            <div class="flex items-center justify-between px-6 py-4">
                <h2
                    class="text-lg font-semibold text-gray-800 dark:text-gray-100"
                >
                    リストの統合
                </h2>
                <button
                    onclick={onClose}
                    class="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    aria-label="閉じる"
                    title="閉じる"
                >
                    ✕
                </button>
            </div>
            <div class="p-6">
                <p class="mb-4 text-gray-700 dark:text-gray-200">
                    「{sourceList.title}」の{taskCount}件のタスクを別のリストに移動し、このリストを削除します。
                </p>

                <div class="mb-4">
                    <label
                        class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                        for="merge-target">統合先リスト</label
                    >
                    <select
                        id="merge-target"
                        bind:value={selectedTargetId}
                        class="w-full cursor-pointer rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                        {#each targetCandidates as l (l.id)}
                            <option value={String(l.id)}>{l.title}</option>
                        {/each}
                    </select>
                </div>

                <p class="mb-6 text-sm text-red-600 dark:text-red-400">
                    この操作は元に戻せません。
                </p>

                <div class="flex justify-end">
                    <button
                        onclick={handleSubmit}
                        disabled={!selectedTargetId}
                        class="cursor-pointer rounded bg-red-600 px-6 py-2 text-white hover:bg-red-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >統合</button
                    >
                </div>
            </div>
        </div>
    </div>
{/if}
