<script lang="ts">
    /**
     * @fileoverview 検索結果表示コンポーネント
     *
     * 全文検索の結果をリスト別グループで表示する。
     * 各タスクの notes の折りたたみ状態と clamp 検知を内包する。
     */

    import { SvelteSet } from "svelte/reactivity";
    import type { SearchTaskResult } from "$lib/types";
    import { clampDetector } from "$lib/actions/clamp";
    import { linkify } from "$lib/linkify";

    type Props = {
        /** 現在の検索クエリ（見出し表示用） */
        query: string;
        /** 検索結果をリスト id でグループ化したマップ */
        searchResultsByList: Map<
            number,
            { title: string; tasks: SearchTaskResult[] }
        >;
        /** 検索クエリ実行中フラグ */
        isLoading: boolean;
        /** 検索結果のタスクをクリックしたときのコールバック */
        onGoToResult: (listId: number) => void;
    };

    let { query, searchResultsByList, isLoading, onGoToResult }: Props =
        $props();

    // notes のクランプ状態（scrollHeight > clientHeight になっている id セット）
    let clampedNotes = new SvelteSet<number>();
    // ユーザーが明示的に展開した id セット
    let expandedNotes = new SvelteSet<number>();

    function toggleExpand(taskId: number) {
        if (expandedNotes.has(taskId)) expandedNotes.delete(taskId);
        else expandedNotes.add(taskId);
    }

    /** clampDetector アクション用コールバックを task id ごとに生成 */
    function makeClampCallback(taskId: number) {
        return (isClamped: boolean) => {
            if (isClamped) clampedNotes.add(taskId);
            else clampedNotes.delete(taskId);
        };
    }
</script>

<!-- 検索結果見出し -->
<div
    class="border-b border-gray-200 bg-blue-50 px-4 py-3 dark:border-gray-700 dark:bg-blue-900/30"
>
    <h2 class="font-semibold text-gray-800 dark:text-gray-100">
        検索結果: "{query}"
    </h2>
</div>

{#if isLoading}
    <p class="p-4 text-gray-400 dark:text-gray-500">検索中...</p>
{:else if searchResultsByList.size === 0}
    <p class="p-4 text-gray-400 dark:text-gray-500">
        該当するタスクがありません
    </p>
{:else}
    {#each [...searchResultsByList] as [listId, group] (listId)}
        <div
            class="border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900"
        >
            <button
                class="cursor-pointer text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                onclick={() => onGoToResult(listId)}
            >
                {group.title}
            </button>
        </div>
        {#each group.tasks as task (task.id)}
            <div
                class="flex items-start gap-3 border-b border-gray-200 px-3 py-3 hover:bg-gray-50 sm:px-5 dark:border-gray-700 dark:hover:bg-gray-700"
            >
                <div class="min-w-0 flex-1 wrap-break-word break-all">
                    {#if !task.title && task.notes}
                        <!-- タイトルなし: notes を主表示として折りたたみ -->
                        <button
                            class="cursor-pointer text-left leading-tight hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400"
                            class:line-through={task.status === "completed"}
                            class:text-gray-400={task.status === "completed"}
                            class:line-clamp-5={!expandedNotes.has(task.id)}
                            onclick={() => onGoToResult(listId)}
                            use:clampDetector={makeClampCallback(task.id)}
                        >
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -- linkify()が自前でHTMLエスケープ済み -->
                            {@html linkify(task.notes)}
                        </button>
                    {:else}
                        <button
                            class="cursor-pointer text-left leading-tight hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400"
                            class:line-through={task.status === "completed"}
                            class:text-gray-400={task.status === "completed"}
                            onclick={() => onGoToResult(listId)}
                        >
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -- linkify()が自前でHTMLエスケープ済み -->
                            {@html linkify(task.title || "（空のタスク）")}
                        </button>
                        {#if task.notes}
                            <p
                                class="mt-0.5 whitespace-pre-wrap text-gray-500 dark:text-gray-400"
                                class:line-clamp-5={!expandedNotes.has(task.id)}
                                use:clampDetector={makeClampCallback(task.id)}
                            >
                                <!-- eslint-disable-next-line svelte/no-at-html-tags -- linkify()が自前でHTMLエスケープ済み -->
                                {@html linkify(task.notes)}
                            </p>
                        {/if}
                    {/if}
                </div>
                {#if clampedNotes.has(task.id) || expandedNotes.has(task.id)}
                    <button
                        onclick={() => toggleExpand(task.id)}
                        class="shrink-0 cursor-pointer rounded p-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-400"
                        aria-label={expandedNotes.has(task.id)
                            ? "notesを折りたたむ"
                            : "notesを展開"}
                        title={expandedNotes.has(task.id)
                            ? "折りたたむ"
                            : "展開"}
                    >
                        {expandedNotes.has(task.id) ? "▲" : "▼"}
                    </button>
                {/if}
            </div>
        {/each}
    {/each}
{/if}
