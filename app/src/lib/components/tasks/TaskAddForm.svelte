<script lang="ts">
    /**
     * @fileoverview タスク追加フォーム（テキストエリア + タグ設定 + 追加ボタン）
     */

    import type { TagInfo } from "$lib/types";
    import {
        FILE_DROP_HIGHLIGHT_CLASSES,
        extractImageFilesFromClipboard,
    } from "$lib/attachment-utils";
    import TagEditor from "./TagEditor.svelte";
    import AttachmentPicker from "./AttachmentPicker.svelte";

    type Props = {
        value: string;
        listTagCandidates: TagInfo[];
        onSubmit: (data: {
            text: string;
            tags: TagInfo[];
            attachments: File[];
            kind: "normal" | "todo";
        }) => Promise<boolean>;
    };

    let { value = $bindable(), listTagCandidates, onSubmit }: Props = $props();
    let formFocused = $state(false);
    let tags = $state<TagInfo[]>([]);
    let selectedAttachments = $state<File[]>([]);
    let isTodo = $state(false);
    // フォームルート要素へのファイルドラッグアンドドロップ中かどうか
    let isDragOver = $state(false);

    // タグ削除などでフォーカスを失っても、入力中のテキストやタグ・添付があれば展開を維持する
    const expanded = $derived(
        formFocused ||
            value.length > 0 ||
            tags.length > 0 ||
            selectedAttachments.length > 0,
    );

    /** フォーム内のどこかにフォーカスがあるかを遅延チェック */
    function handleBlur(e: FocusEvent) {
        const form = (e.currentTarget as HTMLElement).closest("form");
        // relatedTarget がフォーム内ならフォーカス維持
        if (
            form &&
            e.relatedTarget instanceof Node &&
            form.contains(e.relatedTarget)
        ) {
            return;
        }
        formFocused = false;
    }

    async function handleSubmit(e: Event) {
        e.preventDefault();
        const text = value.trimEnd();
        if (!text) return;
        const ok = await onSubmit({
            text,
            tags,
            attachments: selectedAttachments,
            kind: isTodo ? "todo" : "normal",
        });
        // 送信成功時のみタグ・添付・区分をリセットしフォームを折りたたむ。失敗時は
        // テキスト・タグ・添付・フォーカス状態を残し、ユーザーが修正して再送信できるようにする
        if (ok) {
            tags = [];
            selectedAttachments = [];
            isTodo = false;
            formFocused = false;
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void handleSubmit(e);
        }
    }

    function addAttachments(files: File[]) {
        selectedAttachments = [...selectedAttachments, ...files];
    }

    function removeAttachment(index: number) {
        selectedAttachments = selectedAttachments.filter((_, i) => i !== index);
    }

    function handleFormDragOver(e: DragEvent) {
        if (e.dataTransfer?.types.includes("Files")) {
            e.preventDefault();
            isDragOver = true;
        }
    }

    function handleFormDragLeave() {
        isDragOver = false;
    }

    function handleFormDrop(e: DragEvent) {
        e.preventDefault();
        isDragOver = false;
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            addAttachments(Array.from(files));
        }
    }

    function handleTextareaPaste(event: ClipboardEvent) {
        const images = extractImageFilesFromClipboard(event);
        if (images.length === 0) return;
        event.preventDefault();
        addAttachments(images);
    }
</script>

<div
    class="border-b border-gray-200 px-3 py-2 sm:px-4 dark:border-gray-700 {isDragOver
        ? FILE_DROP_HIGHLIGHT_CLASSES
        : 'bg-white dark:bg-gray-800'}"
    data-testid="task-add-form"
    role="group"
    aria-label="タスク追加フォーム（ファイルドロップ対応）"
    ondragover={handleFormDragOver}
    ondragleave={handleFormDragLeave}
    ondrop={handleFormDrop}
>
    <form onsubmit={handleSubmit} class="flex flex-col gap-2">
        <div class="flex items-start gap-2">
            <textarea
                bind:value
                placeholder="タスクを追加... (Ctrl+Enter で送信)"
                rows={expanded ? 5 : 1}
                onfocus={() => (formFocused = true)}
                onblur={handleBlur}
                onkeydown={handleKeydown}
                onpaste={handleTextareaPaste}
                class="flex-1 resize-none rounded border border-gray-200 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            ></textarea>
            {#if expanded}
                <button
                    type="submit"
                    onfocus={() => (formFocused = true)}
                    onblur={handleBlur}
                    class="cursor-pointer rounded bg-blue-100 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-400 dark:hover:bg-blue-900/60"
                >
                    追加
                </button>
            {/if}
        </div>
        {#if expanded}
            <label
                class="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300"
                onfocusin={() => (formFocused = true)}
                onfocusout={handleBlur}
            >
                <input
                    type="checkbox"
                    bind:checked={isTodo}
                    class="cursor-pointer"
                    data-testid="task-add-todo-checkbox"
                />
                TODO
            </label>
            <div
                onfocusin={() => (formFocused = true)}
                onfocusout={handleBlur}
                role="group"
                aria-label="タグ"
            >
                <TagEditor bind:tags candidates={listTagCandidates} />
            </div>
            <div onfocusin={() => (formFocused = true)} onfocusout={handleBlur}>
                <AttachmentPicker
                    attachments={selectedAttachments}
                    onAdd={addAttachments}
                    onRemove={removeAttachment}
                />
            </div>
        {/if}
    </form>
</div>
