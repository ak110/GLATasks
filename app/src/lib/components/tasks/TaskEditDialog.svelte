<script lang="ts">
    import { createAttachmentInput } from "#lib/client/attachments/task-attachments.svelte.ts";
    import Dialog from "#lib/components/dialogs/Dialog.svelte";
    /**
     * @fileoverview タスク編集ダイアログ（内容編集・区分切替・タグ設定・リスト移動・完了状態変更）
     */

    import type { AttachmentMeta, TagInfo } from "#lib/types.ts";
    import type { TaskEditSubmission } from "#lib/client/tasks/task-form-types.ts";
    import {
        trpc,
        type RouterInputs,
        type RouterOutputs,
    } from "#lib/client/trpc.ts";
    import { showErrorToast } from "#lib/client/ui/toast-store.svelte.ts";
    import { extractErrorMessage } from "#lib/client/ui/extract-error-message.ts";
    import {
        uploadAttachment,
        FILE_DROP_HIGHLIGHT_CLASSES,
        isImageAttachment,
    } from "#lib/client/attachments/attachment-utils.ts";
    import { createTaskThumbnails } from "#lib/client/attachments/task-attachments.svelte.ts";
    import ImageLightbox from "#lib/components/dialogs/ImageLightbox.svelte";
    import TagEditor from "./TagEditor.svelte";
    import AttachmentPicker from "./AttachmentPicker.svelte";
    import ConfirmDialog from "#lib/components/dialogs/ConfirmDialog.svelte";

    interface Props {
        open: boolean;
        text: string;
        moveTo: string;
        completed: boolean;
        tags: TagInfo[];
        kind: TaskEditSubmission["kind"];
        listTagCandidates: TagInfo[];
        lists: Pick<RouterOutputs["lists"]["list"][number], "id" | "title">[];
        taskId: number;
        sessionId: number;
        attachments: AttachmentMeta[];
        onAttachmentChange: () => void;
        onSubmit: (
            data: TaskEditSubmission,
            isCurrent: () => boolean,
        ) => Promise<boolean> | void;
        onClose: () => void;
    }

    let {
        open,
        text,
        moveTo,
        completed,
        tags,
        kind,
        listTagCandidates,
        lists,
        taskId,
        sessionId,
        attachments,
        onAttachmentChange,
        onSubmit,
        onClose,
    }: Props = $props();

    let localText = $state("");
    let localMoveTo = $state("");
    let localCompleted = $state(false);
    let localTags = $state<TagInfo[]>([]);
    let localKind = $state<TaskEditSubmission["kind"]>("normal");
    let textareaEl = $state<HTMLTextAreaElement | null>(null);
    // 未保存変更がある状態で閉じようとしたときの確認ダイアログ
    let confirmCloseOpen = $state(false);
    let saving = $state<{
        sessionId: number;
        taskId: number;
        snapshot: string;
    }>();
    let attachmentOperations = $state(0);
    // ダイアログ本体へのファイルドラッグアンドドロップ中かどうか
    const attachmentInput = createAttachmentInput(handleAddAttachments);

    // 未保存判定の基準値。本文・リスト・完了状態・タグの4項目について、
    // ダイアログ初期化時または直近の保存後に同期された props を記録し、
    // 現在の編集中値との差分から未保存フラグを派生させる
    let baselineText = $state("");
    let baselineMoveTo = $state("");
    let baselineCompleted = $state(false);
    // タグは順序込みで比較したいため JSON 文字列化して扱う
    let baselineTagsKey = $state("[]");
    let baselineKind = $state<TaskEditSubmission["kind"]>("normal");

    // 添付一覧はダイアログ内の編集状態として保持し、追加・削除の更新処理成功後に
    // onAttachmentChange 経由で親側キャッシュが更新され次第、プロパティ経由で反映する
    let localAttachments = $state<AttachmentMeta[]>([]);
    $effect(() => {
        if (!open) return;
        localAttachments = attachments;
    });

    const isDirty = $derived(
        localText !== baselineText ||
            localMoveTo !== baselineMoveTo ||
            localCompleted !== baselineCompleted ||
            JSON.stringify(localTags) !== baselineTagsKey ||
            localKind !== baselineKind,
    );

    let prevOpen = false;
    let prevSessionId: number | undefined;
    let prevTaskId: number | undefined;
    $effect(() => {
        if (
            open &&
            (!prevOpen || prevSessionId !== sessionId || prevTaskId !== taskId)
        ) {
            localText = text;
            localMoveTo = moveTo;
            localCompleted = completed;
            localTags = [...tags];
            localKind = kind;
            confirmCloseOpen = false;
            saving = undefined;
            attachmentOperations = 0;
            thumbnails.close();
            // tick 後にフォーカス
            queueMicrotask(() => textareaEl?.focus());
        }
        prevOpen = open;
        prevSessionId = sessionId;
        prevTaskId = taskId;
    });

    // 開いた瞬間と、open のまま親が保存後の値を同期してきたタイミングで baseline を取り直す。
    // 失敗時は親側で props を更新しないため baseline も更新されず、未保存のまま扱われる
    $effect(() => {
        if (!open) return;
        baselineText = text;
        baselineMoveTo = moveTo;
        baselineCompleted = completed;
        baselineTagsKey = JSON.stringify(tags);
        baselineKind = kind;
    });

    function inputSnapshot() {
        return JSON.stringify([
            localText,
            localMoveTo,
            localCompleted,
            localTags,
            localKind,
        ]);
    }

    async function handleSubmit(closeAfter: boolean) {
        if (saving || !open) return;
        // 保存ボタンの役割分担:
        // - 「保存」（closeAfter=false）: 編集続行用。同一リスト内編集では並び順を維持する
        // - 「保存して閉じる」（closeAfter=true）: 同一リスト内編集では並び順を更新して閉じる
        // リスト変更を伴う場合は両ボタンとも移動先リストの先頭へ配置される（サーバー仕様）。
        // keepOrder の値は呼び出し側で closeAfter から決定する
        const request = { sessionId, taskId, snapshot: inputSnapshot() };
        saving = request;
        const data: TaskEditSubmission = {
            text: localText,
            moveTo: localMoveTo,
            completed: localCompleted,
            tags: localTags.map((tag) => ({ ...tag })),
            kind: localKind,
            closeAfter,
        };
        try {
            const success = await onSubmit(
                data,
                () =>
                    open &&
                    sessionId === request.sessionId &&
                    taskId === request.taskId &&
                    inputSnapshot() === request.snapshot,
            );
            if (
                success &&
                closeAfter &&
                open &&
                sessionId === request.sessionId &&
                taskId === request.taskId &&
                inputSnapshot() === request.snapshot
            ) {
                onClose();
            }
        } catch (error) {
            if (
                open &&
                sessionId === request.sessionId &&
                taskId === request.taskId
            )
                showErrorToast(extractErrorMessage(error));
        } finally {
            if (
                saving?.sessionId === request.sessionId &&
                saving.taskId === request.taskId &&
                saving.snapshot === request.snapshot
            )
                saving = undefined;
        }
    }

    /** ファイル群を順次アップロードする（`<input type="file">`経路とドラッグアンドドロップ経路の共通処理） */
    async function uploadFiles(files: FileList | File[]) {
        const targetTaskId = taskId;
        const targetSessionId = sessionId;
        const attachmentChange = onAttachmentChange;
        attachmentOperations += 1;
        try {
            // 複数ファイル選択時は順次アップロードする（並列は不要）
            for (const file of Array.from(files)) {
                try {
                    await uploadAttachment(targetTaskId, file);
                    if (
                        open &&
                        sessionId === targetSessionId &&
                        taskId === targetTaskId
                    )
                        attachmentChange();
                } catch (error) {
                    if (
                        open &&
                        sessionId === targetSessionId &&
                        taskId === targetTaskId
                    )
                        showErrorToast(extractErrorMessage(error));
                }
            }
        } finally {
            if (sessionId === targetSessionId && taskId === targetTaskId)
                attachmentOperations -= 1;
        }
    }

    function handleAddAttachments(files: File[]) {
        void uploadFiles(files);
    }

    async function handleDeleteAttachment(
        attachmentId: RouterInputs["attachments"]["delete"]["attachmentId"],
    ) {
        const targetTaskId = taskId;
        const targetSessionId = sessionId;
        const attachmentChange = onAttachmentChange;
        attachmentOperations += 1;
        try {
            await trpc.attachments.delete.mutate({ attachmentId });
            if (
                open &&
                sessionId === targetSessionId &&
                taskId === targetTaskId
            )
                attachmentChange();
        } catch (error) {
            if (
                open &&
                sessionId === targetSessionId &&
                taskId === targetTaskId
            )
                showErrorToast(extractErrorMessage(error));
        } finally {
            if (sessionId === targetSessionId && taskId === targetTaskId)
                attachmentOperations -= 1;
        }
    }

    function requestClose() {
        if (isDirty) {
            confirmCloseOpen = true;
            return;
        }
        onClose();
    }

    const thumbnails = createTaskThumbnails(() =>
        localAttachments.map((attachment) => attachment.id),
    );

    function handleDialogKeydown(e: KeyboardEvent) {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            void handleSubmit(false);
        }
    }
</script>

<ConfirmDialog
    open={confirmCloseOpen}
    title="変更を破棄"
    message="未保存の変更があります。破棄して閉じますか？"
    confirmLabel="破棄して閉じる"
    variant="danger"
    onConfirm={() => {
        confirmCloseOpen = false;
        onClose();
    }}
    onCancel={() => (confirmCloseOpen = false)}
/>
<Dialog
    {open}
    title="タスクの編集"
    widthClass="max-w-4xl"
    onClose={requestClose}
    initialFocus={() => textareaEl}
    onkeydown={handleDialogKeydown}
>
    <div
        role="group"
        aria-label="タスク編集フォーム（ファイルドロップ対応）"
        class={attachmentInput.isDragOver
            ? FILE_DROP_HIGHLIGHT_CLASSES
            : undefined}
        ondragover={attachmentInput.ondragover}
        ondragleave={attachmentInput.ondragleave}
        ondrop={attachmentInput.ondrop}
    >
        <div class="max-h-[80vh] overflow-y-auto p-6">
            <div class="mb-4 flex items-center gap-4">
                <label
                    class="flex cursor-pointer items-center gap-2 text-gray-700 dark:text-gray-200"
                >
                    <input
                        type="checkbox"
                        bind:checked={localCompleted}
                        class="cursor-pointer"
                    />
                    完了
                </label>
                <label
                    class="flex cursor-pointer items-center gap-2 text-gray-700 dark:text-gray-200"
                >
                    <input
                        type="checkbox"
                        checked={localKind === "todo"}
                        onchange={(e) =>
                            (localKind = e.currentTarget.checked
                                ? "todo"
                                : "normal")}
                        class="cursor-pointer"
                        data-testid="task-edit-todo-checkbox"
                    />
                    TODO
                </label>
            </div>
            <div class="mb-4">
                <textarea
                    id="edit-text"
                    rows={10}
                    bind:value={localText}
                    bind:this={textareaEl}
                    onpaste={attachmentInput.onpaste}
                    aria-label="内容"
                    class="w-full rounded border border-gray-200 px-3 py-2 wrap-break-word break-all focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                ></textarea>
            </div>
            <div class="mb-4" role="group" aria-label="タグ">
                <TagEditor
                    bind:tags={localTags}
                    candidates={listTagCandidates}
                />
            </div>
            <div class="mb-4" role="group" aria-label="添付ファイル">
                {#if attachmentOperations > 0}
                    <p role="status">添付ファイルを更新中…</p>
                {/if}
                {#if localAttachments.length > 0}
                    <ul class="mb-2 flex flex-col gap-1">
                        {#each localAttachments as attachment (attachment.id)}
                            <li
                                class="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-600"
                            >
                                {#if isImageAttachment(attachment.mimeType)}
                                    {#await thumbnails.ensure(attachment.id) then imageUrl}
                                        <button
                                            type="button"
                                            onclick={() =>
                                                thumbnails.open(attachment.id)}
                                            class="shrink-0 cursor-pointer"
                                            data-testid="task-attachment-thumbnail"
                                            title={attachment.filename}
                                            aria-label={`${attachment.filename}を拡大表示`}
                                        >
                                            <img
                                                src={imageUrl}
                                                alt={attachment.filename}
                                                class="h-12 w-12 rounded object-cover"
                                            />
                                        </button>
                                    {:catch}
                                        <span
                                            class="shrink-0 text-sm text-gray-400"
                                            title={attachment.filename}
                                            aria-label={`${attachment.filename}の画像取得に失敗`}
                                            >⚠️</span
                                        >
                                    {/await}
                                {/if}
                                <span
                                    class="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200"
                                    title={attachment.filename}
                                    >{attachment.filename}</span
                                >
                                <button
                                    onclick={() =>
                                        handleDeleteAttachment(attachment.id)}
                                    class="cursor-pointer rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                                    aria-label={`${attachment.filename}を削除`}
                                    title="削除">🗑️</button
                                >
                            </li>
                        {/each}
                    </ul>
                {/if}
                <AttachmentPicker onAdd={handleAddAttachments} />
            </div>
            <div class="mb-4">
                <select
                    id="edit-move-to"
                    bind:value={localMoveTo}
                    aria-label="リスト"
                    class="w-full rounded border border-gray-200 px-3 py-2 wrap-break-word break-all focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                    {#each lists as l (l.id)}
                        <option value={String(l.id)}>{l.title}</option>
                    {/each}
                </select>
            </div>
            <div class="mt-6 flex justify-end gap-2">
                {#if saving}
                    <p role="status">保存中…</p>
                {/if}
                <button
                    onclick={() => handleSubmit(false)}
                    disabled={!!saving}
                    class="cursor-pointer rounded bg-gray-100 px-6 py-2 text-gray-700 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                    data-testid="task-edit-save-btn"
                    title="Ctrl+S">保存</button
                >
                <button
                    onclick={() => handleSubmit(true)}
                    disabled={!!saving}
                    class="cursor-pointer rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                    data-testid="task-edit-save-close-btn"
                    >保存して閉じる</button
                >
            </div>
        </div>
    </div>
</Dialog>

{#if thumbnails.lightboxImageUrl}
    <ImageLightbox
        imageUrl={thumbnails.lightboxImageUrl}
        onClose={() => thumbnails.close()}
    />
{/if}
