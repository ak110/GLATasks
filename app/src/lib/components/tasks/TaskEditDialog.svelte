<script lang="ts">
    /**
     * @fileoverview タスク編集ダイアログ（内容編集・区分切替・タグ設定・リスト移動・完了状態変更）
     */

    import type { AttachmentMeta, TagInfo } from "$lib/types";
    import { trpc } from "$lib/trpc";
    import { showErrorToast } from "$lib/toast-store.svelte";
    import { extractErrorMessage } from "$lib/extract-error-message";
    import {
        uploadAttachment,
        FILE_DROP_HIGHLIGHT_CLASSES,
        extractImageFilesFromClipboard,
        isImageAttachment,
    } from "$lib/attachment-utils";
    import { createThumbnailManager } from "$lib/image-attachment-utils.svelte";
    import ImageLightbox from "$lib/components/dialogs/ImageLightbox.svelte";
    import TagEditor from "./TagEditor.svelte";
    import AttachmentPicker from "./AttachmentPicker.svelte";
    import ConfirmDialog from "$lib/components/dialogs/ConfirmDialog.svelte";

    // role="dialog"のaria-labelledby参照先として<h2>を識別する
    const titleId = crypto.randomUUID();

    type Props = {
        open: boolean;
        text: string;
        moveTo: string;
        completed: boolean;
        tags: TagInfo[];
        kind: "normal" | "todo";
        listTagCandidates: TagInfo[];
        lists: Array<{ id: number; title: string }>;
        taskId: number;
        attachments: AttachmentMeta[];
        onAttachmentChange: () => void;
        onSubmit: (data: {
            text: string;
            moveTo: string;
            completed: boolean;
            tags: TagInfo[];
            kind: "normal" | "todo";
            closeAfter: boolean;
        }) => void;
        onClose: () => void;
    };

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
        attachments,
        onAttachmentChange,
        onSubmit,
        onClose,
    }: Props = $props();

    let localText = $state("");
    let localMoveTo = $state("");
    let localCompleted = $state(false);
    let localTags = $state<TagInfo[]>([]);
    let localKind = $state<"normal" | "todo">("normal");
    let textareaEl = $state<HTMLTextAreaElement | null>(null);
    // 未保存変更がある状態で閉じようとしたときの確認ダイアログ
    let confirmCloseOpen = $state(false);
    // ダイアログ本体へのファイルドラッグアンドドロップ中かどうか
    let isDragOver = $state(false);

    // 未保存判定の基準値。本文・リスト・完了状態・タグの4項目について、
    // ダイアログ初期化時または直近の保存後に同期された props を記録し、
    // 現在の編集中値との差分から未保存フラグを派生させる
    let baselineText = $state("");
    let baselineMoveTo = $state("");
    let baselineCompleted = $state(false);
    // タグは順序込みで比較したいため JSON 文字列化して扱う
    let baselineTagsKey = $state("[]");
    let baselineKind = $state<"normal" | "todo">("normal");

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

    // open が偽から真へ遷移した瞬間のみローカル状態を初期化する
    // （open=true のまま親が値を同期してきた場合に編集中の値を巻き戻さないため）
    let prevOpen = false;
    $effect(() => {
        if (open && !prevOpen) {
            localText = text;
            localMoveTo = moveTo;
            localCompleted = completed;
            localTags = [...tags];
            localKind = kind;
            // tick 後にフォーカス
            queueMicrotask(() => textareaEl?.focus());
        }
        prevOpen = open;
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

    function handleSubmit(closeAfter: boolean) {
        // 保存ボタンの役割分担:
        // - 「保存」（closeAfter=false）: 編集続行用。同一リスト内編集では並び順を維持する
        // - 「保存して閉じる」（closeAfter=true）: 同一リスト内編集では並び順を更新して閉じる
        // リスト変更を伴う場合は両ボタンとも移動先リストの先頭へ配置される（サーバー仕様）。
        // keep_order の値は呼び出し側で closeAfter から決定する
        onSubmit({
            text: localText,
            moveTo: localMoveTo,
            completed: localCompleted,
            tags: localTags,
            kind: localKind,
            closeAfter,
        });
    }

    /** ファイル群を順次アップロードする（`<input type="file">`経路とドラッグアンドドロップ経路の共通処理） */
    async function uploadFiles(files: FileList | File[]) {
        // 複数ファイル選択時は順次アップロードする（並列は不要）
        for (const file of Array.from(files)) {
            try {
                await uploadAttachment(taskId, file);
                onAttachmentChange();
            } catch (error) {
                showErrorToast(extractErrorMessage(error));
            }
        }
    }

    function handleAddAttachments(files: File[]) {
        void uploadFiles(files);
    }

    function handleDialogBodyDragOver(e: DragEvent) {
        if (e.dataTransfer?.types.includes("Files")) {
            e.preventDefault();
            isDragOver = true;
        }
    }

    function handleDialogBodyDragLeave() {
        isDragOver = false;
    }

    async function handleDialogBodyDrop(e: DragEvent) {
        e.preventDefault();
        isDragOver = false;
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            await uploadFiles(files);
        }
    }

    async function handleDeleteAttachment(attachmentId: number) {
        try {
            await trpc.attachments.delete.mutate({ attachmentId });
            onAttachmentChange();
        } catch (error) {
            showErrorToast(extractErrorMessage(error));
        }
    }

    function requestClose() {
        if (isDirty) {
            confirmCloseOpen = true;
            return;
        }
        onClose();
    }

    const thumbnails = createThumbnailManager();

    $effect(() => {
        thumbnails.sync(localAttachments.map((a) => a.id));
    });

    $effect(() => {
        return () => {
            thumbnails.dispose();
        };
    });

    async function handleThumbnailOpen(attachmentId: number) {
        try {
            await thumbnails.open(attachmentId);
        } catch (error) {
            showErrorToast(extractErrorMessage(error));
        }
    }

    function handleTextareaPaste(event: ClipboardEvent) {
        const images = extractImageFilesFromClipboard(event);
        if (images.length === 0) return;
        event.preventDefault();
        handleAddAttachments(images);
    }

    function handleDialogKeydown(e: KeyboardEvent) {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            handleSubmit(false);
        } else if (e.key === "Escape") {
            e.preventDefault();
            requestClose();
        }
    }
</script>

<!-- {#if open}ブロック外に置くことで、ダイアログが閉じる遷移中もConfirmDialogが有効に表示される -->
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

{#if open}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabindex="-1"
        onkeydown={handleDialogKeydown}
    >
        <div
            class="w-full max-w-2xl rounded-lg shadow-xl {isDragOver
                ? FILE_DROP_HIGHLIGHT_CLASSES
                : 'bg-white dark:bg-gray-800'}"
            role="group"
            aria-label="タスク編集フォーム（ファイルドロップ対応）"
            ondragover={handleDialogBodyDragOver}
            ondragleave={handleDialogBodyDragLeave}
            ondrop={handleDialogBodyDrop}
        >
            <div class="flex items-center justify-between px-6 py-4">
                <h2
                    id={titleId}
                    class="text-lg font-semibold text-gray-800 dark:text-gray-100"
                >
                    タスクの編集
                </h2>
                <button
                    onclick={requestClose}
                    class="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    aria-label="閉じる"
                    title="閉じる"
                >
                    ✕
                </button>
            </div>
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
                        onpaste={handleTextareaPaste}
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
                                                    handleThumbnailOpen(
                                                        attachment.id,
                                                    )}
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
                                            handleDeleteAttachment(
                                                attachment.id,
                                            )}
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

{#if thumbnails.lightboxImageUrl}
    <ImageLightbox
        imageUrl={thumbnails.lightboxImageUrl}
        onClose={() => thumbnails.close()}
    />
{/if}
