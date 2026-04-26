<script lang="ts">
    /**
     * @fileoverview タスク編集ダイアログ（内容編集・タグ設定・リスト移動・完了状態変更）
     */

    import type { TagInfo } from "$lib/types";
    import TagEditor from "./TagEditor.svelte";

    type Props = {
        open: boolean;
        text: string;
        moveTo: string;
        keepOrder: boolean;
        completed: boolean;
        tags: TagInfo[];
        listTagCandidates: TagInfo[];
        lists: Array<{ id: number; title: string }>;
        onSubmit: (data: {
            text: string;
            moveTo: string;
            keepOrder: boolean;
            completed: boolean;
            tags: TagInfo[];
            closeAfter: boolean;
        }) => void;
        onClose: () => void;
    };

    let {
        open,
        text,
        moveTo,
        keepOrder,
        completed,
        tags,
        listTagCandidates,
        lists,
        onSubmit,
        onClose,
    }: Props = $props();

    let localText = $state("");
    let localMoveTo = $state("");
    let localKeepOrder = $state(false);
    let localCompleted = $state(false);
    let localTags = $state<TagInfo[]>([]);
    let textareaEl = $state<HTMLTextAreaElement | null>(null);
    let closeButtonEl = $state<HTMLButtonElement | null>(null);

    // open が偽から真へ遷移した瞬間のみローカル状態を初期化する
    // （open=true のまま親が値を同期してきた場合に編集中の値を巻き戻さないため）
    let prevOpen = false;
    $effect(() => {
        if (open && !prevOpen) {
            localText = text;
            localMoveTo = moveTo;
            localKeepOrder = keepOrder;
            localCompleted = completed;
            localTags = [...tags];
            // tick 後にフォーカス
            queueMicrotask(() => textareaEl?.focus());
        }
        prevOpen = open;
    });

    function handleSubmit(closeAfter: boolean) {
        // 「保存」ボタン（closeAfter=false）はダイアログを開いたまま編集を続ける用途のため、
        // 編集中に並び順が動かないよう常に keepOrder=true で送る。
        // チェックボックスは「保存して閉じる」専用の指定として扱う。
        onSubmit({
            text: localText,
            moveTo: localMoveTo,
            keepOrder: closeAfter ? localKeepOrder : true,
            completed: localCompleted,
            tags: localTags,
            closeAfter,
        });
    }

    function handleDialogKeydown(e: KeyboardEvent) {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            handleSubmit(false);
        }
    }
</script>

{#if open}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-0"
        role="dialog"
        aria-modal="true"
        onkeydown={handleDialogKeydown}
    >
        <div
            class="w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-800"
        >
            <div class="flex items-center justify-between px-6 py-4">
                <h2
                    class="text-lg font-semibold text-gray-800 dark:text-gray-100"
                >
                    タスクの編集
                </h2>
                <div class="flex items-center gap-3">
                    <div class="flex items-center gap-2">
                        <input
                            id="edit-keep-order"
                            type="checkbox"
                            bind:checked={localKeepOrder}
                            class="cursor-pointer"
                        />
                        <label
                            for="edit-keep-order"
                            class="cursor-pointer text-sm text-gray-700 dark:text-gray-200"
                            >保存時に並び順を維持する</label
                        >
                    </div>
                    <button
                        bind:this={closeButtonEl}
                        onclick={onClose}
                        class="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                        aria-label="閉じる"
                        title="閉じる"
                    >
                        ✕
                    </button>
                </div>
            </div>
            <div class="p-6">
                <div class="mb-4 flex items-center gap-2">
                    <input
                        id="edit-completed"
                        type="checkbox"
                        bind:checked={localCompleted}
                        class="cursor-pointer"
                    />
                    <label
                        for="edit-completed"
                        class="cursor-pointer text-gray-700 dark:text-gray-200"
                        >完了</label
                    >
                </div>
                <div class="mb-4">
                    <label
                        class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                        for="edit-text">内容</label
                    >
                    <textarea
                        id="edit-text"
                        rows={10}
                        bind:value={localText}
                        bind:this={textareaEl}
                        onkeydown={(e) => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                closeButtonEl?.focus();
                            }
                        }}
                        class="w-full rounded border border-gray-200 px-3 py-2 wrap-break-word break-all focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    ></textarea>
                </div>
                <div class="mb-4">
                    <span
                        class="mb-1 block font-medium text-gray-700 dark:text-gray-200"
                        >タグ</span
                    >
                    <TagEditor
                        bind:tags={localTags}
                        candidates={listTagCandidates}
                    />
                </div>
                <div class="mb-4">
                    <label
                        class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                        for="edit-move-to">リスト</label
                    >
                    <select
                        id="edit-move-to"
                        bind:value={localMoveTo}
                        class="w-full rounded border border-gray-200 px-3 py-2 wrap-break-word break-all focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                        {#each lists as l (l.id)}
                            <option value={String(l.id)}>{l.title}</option>
                        {/each}
                    </select>
                </div>
                <div class="mt-6 flex justify-end gap-2">
                    <button
                        onclick={() => handleSubmit(false)}
                        class="cursor-pointer rounded bg-gray-100 px-6 py-2 text-gray-700 hover:bg-gray-200 focus:outline-none dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                        title="Ctrl+S">保存</button
                    >
                    <button
                        onclick={() => handleSubmit(true)}
                        class="cursor-pointer rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 focus:outline-none"
                        >保存して閉じる</button
                    >
                </div>
            </div>
        </div>
    </div>
{/if}
