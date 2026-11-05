<script lang="ts">
    import { untrack } from "svelte";
    import { dialogInputClass } from "#lib/components/ui/styles.ts";
    import Dialog from "#lib/components/dialogs/Dialog.svelte";
    /**
     * @fileoverview リスト統合ダイアログ（統合元リストの全タスクを統合先に移動）
     */

    import type { ListInfo } from "#lib/types.ts";

    interface Props {
        session: object;
        open: boolean;
        sourceList: Pick<ListInfo, "id" | "title">;
        allLists: ListInfo[];
        taskCount: number;
        submitting?: boolean;
        onSubmit: (targetListId: number, isCurrent: () => boolean) => void;
        onClose: () => void;
    }

    let {
        session,
        open,
        sourceList,
        allLists,
        taskCount,
        submitting = false,
        onSubmit,
        onClose,
    }: Props = $props();

    let selectedTargetId = $state("");
    const dialogSession = $derived(session);
    const sourceId = $derived(sourceList.id);
    const dialogOpen = $derived(open);

    // 統合先の候補: アクティブなリスト（自分自身を除く）
    let targetCandidates = $derived(
        allLists.filter((l) => l.status === "active" && l.id !== sourceList.id),
    );

    // 候補の再取得は編集中の選択や送信snapshotを変更しない。
    $effect(() => {
        void dialogSession;
        void sourceId;
        if (dialogOpen) {
            selectedTargetId = untrack(() =>
                targetCandidates.length > 0
                    ? String(targetCandidates[0].id)
                    : "",
            );
        }
    });

    function handleSubmit() {
        if (selectedTargetId && !submitting) {
            const target = selectedTargetId;
            onSubmit(Number(target), () => selectedTargetId === target);
        }
    }
</script>

<Dialog {open} title="リストの統合" widthClass="max-w-md" {onClose}>
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
                class="w-full cursor-pointer {dialogInputClass}"
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
            {#if submitting}<p role="status">統合中...</p>{/if}
            <button
                onclick={handleSubmit}
                disabled={!selectedTargetId || submitting}
                class="cursor-pointer rounded bg-red-600 px-6 py-2 text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >統合</button
            >
        </div>
    </div>
</Dialog>
