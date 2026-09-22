<script lang="ts">
    import type { Snippet } from "svelte";

    let {
        title,
        onClose,
        children,
    }: {
        title: string;
        onClose: () => void;
        children: Snippet;
    } = $props();
    const titleId = $props.id();

    function showDialog(dialog: HTMLDialogElement) {
        dialog.showModal();
        return () => dialog.close();
    }
</script>

<dialog
    {@attach showDialog}
    aria-labelledby={titleId}
    oncancel={onClose}
    class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg bg-white p-6 text-gray-800 shadow-xl backdrop:bg-black/50 dark:bg-gray-800 dark:text-gray-100"
>
    <div class="mb-4 flex items-center justify-between gap-3">
        <h2 id={titleId} class="text-lg font-semibold">{title}</h2>
        <button
            type="button"
            onclick={onClose}
            aria-label="閉じる"
            class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            >✕</button
        >
    </div>
    {@render children()}
</dialog>
