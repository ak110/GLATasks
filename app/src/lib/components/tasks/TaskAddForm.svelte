<script lang="ts">
    import { createAttachmentInput } from "#lib/client/attachments/task-attachments.svelte.ts";

    import type { TaskAddSubmission } from "#lib/client/tasks/task-form-types.ts";
    import type { TagInfo } from "#lib/types.ts";
    import { FILE_DROP_HIGHLIGHT_CLASSES } from "#lib/client/attachments/attachment-utils.ts";
    import TagEditor from "./TagEditor.svelte";
    import AttachmentPicker from "./AttachmentPicker.svelte";
    import { TagsSchema } from "#lib/schemas.ts";
    import {
        holdUnsavedDraft,
        restoreRecoveryDraft,
    } from "#lib/client/ui/user-busy.ts";

    interface Props {
        value: string;
        listId: number;
        listTagCandidates: TagInfo[];
        onSubmit: (data: TaskAddSubmission) => Promise<boolean>;
    }

    let {
        value = $bindable(),
        listId,
        listTagCandidates,
        onSubmit,
    }: Props = $props();
    let formFocused = $state(false);
    let tags = $state<TagInfo[]>([]);
    let selectedAttachments = $state<File[]>([]);
    let isTodo = $state(false);
    const attachmentInput = createAttachmentInput(addAttachments);

    const expanded = $derived(
        formFocused ||
            value.length > 0 ||
            tags.length > 0 ||
            selectedAttachments.length > 0,
    );

    $effect(() => {
        restoreRecoveryDraft(`task-add-options:${listId}`, (raw) => {
            const data = JSON.parse(raw) as { tags: unknown; isTodo: unknown };
            const result = TagsSchema.safeParse(data.tags);
            if (!result.success || typeof data.isTodo !== "boolean")
                return false;
            tags = result.data;
            isTodo = data.isTodo;
            return true;
        });
    });

    $effect(() => {
        if (tags.length > 0 || selectedAttachments.length > 0 || isTodo)
            return holdUnsavedDraft({
                key: `task-add-options:${listId}`,
                serialize: () =>
                    selectedAttachments.length > 0
                        ? undefined
                        : JSON.stringify({ tags, isTodo }),
            });
    });

    function handleBlur(e: FocusEvent) {
        const form = (e.currentTarget as HTMLElement).closest("form");
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
</script>

<div
    class="max-h-[calc(100%-16rem)] shrink-0 overflow-y-auto border-b border-gray-200 px-3 py-2 sm:px-4 dark:border-gray-700 {attachmentInput.isDragOver
        ? FILE_DROP_HIGHLIGHT_CLASSES
        : 'bg-white dark:bg-gray-800'}"
    data-testid="task-add-form"
    role="group"
    aria-label="タスク追加フォーム（ファイルドロップ対応）"
    ondragover={attachmentInput.ondragover}
    ondragleave={attachmentInput.ondragleave}
    ondrop={attachmentInput.ondrop}
>
    <form onsubmit={handleSubmit} class="flex flex-col gap-2">
        <div class="flex items-start gap-2">
            <textarea
                bind:value
                data-recovery-key={`task-add:${listId}`}
                placeholder="タスクを追加... (Ctrl+Enter で送信)"
                rows={expanded ? 5 : 1}
                onfocus={() => (formFocused = true)}
                onblur={handleBlur}
                onkeydown={handleKeydown}
                onpaste={attachmentInput.onpaste}
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
