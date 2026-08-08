<script lang="ts">
    /**
     * @fileoverview ファイル選択inputと、任意で選択済みファイル一覧を表示する共通コンポーネント
     * タスク追加フォーム・タスク編集ダイアログの双方から利用する
     */

    type Props = {
        attachments?: File[];
        onAdd: (files: File[]) => void;
        onRemove?: (index: number) => void;
        disabled?: boolean;
    };

    let {
        attachments = undefined,
        onAdd,
        onRemove = undefined,
        disabled = false,
    }: Props = $props();

    function handleFileChange(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        if (input.files) {
            onAdd(Array.from(input.files));
        }
        input.value = "";
    }
</script>

{#if attachments && attachments.length > 0}
    <ul
        class="mb-2 flex max-h-48 flex-col gap-1 overflow-y-auto"
        data-testid="selected-attachments"
    >
        {#each attachments as file, i (i)}
            <li
                class="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-600"
            >
                <span
                    class="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200"
                    title={file.name}>{file.name}</span
                >
                <button
                    type="button"
                    onclick={() => onRemove?.(i)}
                    class="cursor-pointer rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                    aria-label={`${file.name}を削除`}
                    title="削除">🗑️</button
                >
            </li>
        {/each}
    </ul>
{/if}
<input
    type="file"
    multiple
    {disabled}
    onchange={handleFileChange}
    class="block w-full text-sm text-gray-700 file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-gray-700 hover:file:bg-gray-200 dark:text-gray-200 dark:file:bg-gray-700 dark:file:text-gray-200 dark:hover:file:bg-gray-600"
/>
