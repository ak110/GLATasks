<script lang="ts">
    /**
     * @fileoverview タグ編集UI（現在のタグ表示＋削除、候補クリック追加、新規入力）
     *
     * タスク追加フォームと編集ダイアログで共通利用する。
     */

    import type { TagInfo, TagColorKey } from "$lib/types";
    import { getTagColorClass, resolveTagColor } from "$lib/tag-palette";

    type Props = {
        /** 現在設定中のタグ配列（双方向バインド） */
        tags: TagInfo[];
        /** 同一リスト内で既に使われているタグ候補 */
        candidates: TagInfo[];
    };

    let { tags = $bindable(), candidates }: Props = $props();

    let input = $state("");

    // 未設定の候補（現在のタグに含まれないもの）
    const availableCandidates = $derived(
        candidates.filter((c) => !tags.some((t) => t.name === c.name)),
    );

    function addTag(name: string, presetColor?: TagColorKey) {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (tags.some((t) => t.name === trimmed)) return;
        const color = presetColor ?? resolveTagColor(trimmed, tags);
        tags = [...tags, { name: trimmed, color }];
    }

    function removeTag(name: string) {
        tags = tags.filter((t) => t.name !== name);
    }

    function handleInputKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            // タグ入力のEnterは親フォームの送信と分離する
            e.preventDefault();
            addTag(input);
            input = "";
        }
    }

    function handleAddClick() {
        addTag(input);
        input = "";
    }
</script>

<div class="flex flex-col gap-1.5" data-testid="tag-editor">
    {#if tags.length > 0}
        <div class="flex flex-wrap gap-1">
            {#each tags as tag (tag.name)}
                <span
                    class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight {getTagColorClass(
                        tag.color,
                    )}"
                    data-testid="tag-editor-current"
                >
                    {tag.name}
                    <button
                        type="button"
                        onclick={() => removeTag(tag.name)}
                        class="cursor-pointer text-inherit opacity-70 hover:opacity-100"
                        aria-label="タグ {tag.name} を外す"
                        title="外す"
                    >
                        ✕
                    </button>
                </span>
            {/each}
        </div>
    {/if}
    {#if availableCandidates.length > 0}
        <div class="flex flex-wrap items-center gap-1">
            <span class="text-[11px] text-gray-500 dark:text-gray-400">
                候補:
            </span>
            {#each availableCandidates as candidate (candidate.name)}
                <button
                    type="button"
                    onclick={() => addTag(candidate.name, candidate.color)}
                    class="inline-flex cursor-pointer items-center rounded px-1.5 py-0.5 text-[11px] leading-tight opacity-70 hover:opacity-100 {getTagColorClass(
                        candidate.color,
                    )}"
                    data-testid="tag-editor-candidate"
                >
                    + {candidate.name}
                </button>
            {/each}
        </div>
    {/if}
    <div class="flex items-center gap-1">
        <input
            type="text"
            bind:value={input}
            onkeydown={handleInputKeydown}
            placeholder="新しいタグ"
            maxlength={40}
            class="flex-1 rounded border border-gray-200 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            data-testid="tag-editor-input"
        />
        <button
            type="button"
            onclick={handleAddClick}
            disabled={!input.trim()}
            class="cursor-pointer rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-gray-300 dark:hover:bg-gray-700 dark:disabled:text-gray-500"
            data-testid="tag-editor-add"
        >
            追加
        </button>
    </div>
</div>
