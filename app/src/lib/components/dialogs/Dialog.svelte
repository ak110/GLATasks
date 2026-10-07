<script lang="ts">
    import { tick, type Snippet } from "svelte";
    import { closeButtonClass, UI_LAYERS } from "#lib/components/ui/styles.ts";
    import { DIALOG_OPENED_EVENT } from "#lib/client/ui/notification-layer.ts";

    type Props = {
        open?: boolean;
        title?: string;
        label?: string;
        titleTestId?: string;
        testId?: string;
        closeTestId?: string;
        lightbox?: boolean;
        widthClass?: string;
        contentClass?: string;
        onClose: () => void;
        onkeydown?: (event: KeyboardEvent) => void;
        initialFocus?: () => HTMLElement | null | undefined;
        children: Snippet;
    };
    let {
        open = true,
        title,
        label,
        titleTestId,
        testId,
        closeTestId,
        lightbox = false,
        widthClass = "max-w-lg",
        contentClass,
        onClose,
        onkeydown,
        initialFocus,
        children,
    }: Props = $props();
    const titleId = $props.id();

    function showDialog(dialog: HTMLDialogElement) {
        dialog.showModal();
        document.dispatchEvent(new Event(DIALOG_OPENED_EVENT));
        void tick().then(() => {
            const target =
                initialFocus?.() ??
                dialog.querySelector<HTMLElement>("input, textarea, select") ??
                dialog.querySelector<HTMLElement>("button");
            target?.focus();
        });
        return () => dialog.close();
    }

    function cancel(event: Event) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
    }
</script>

{#if open}
    <!-- 既存のダイアログ属性セレクターも共通部品で受理する。 -->
    <!-- svelte-ignore a11y_no_redundant_roles -->
    <dialog
        {@attach showDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        data-testid={testId}
        oncancel={cancel}
        onclick={(event) => {
            if (lightbox && event.target === event.currentTarget) onClose();
        }}
        {onkeydown}
        class={lightbox
            ? `m-auto max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-visible bg-transparent p-0 backdrop:bg-black/70 ${UI_LAYERS.dialog}`
            : `m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-white p-0 text-gray-800 shadow-xl backdrop:bg-black/50 dark:bg-gray-800 dark:text-gray-100 ${widthClass} ${UI_LAYERS.dialog}`}
    >
        {#if title}
            <div class="flex items-center justify-between px-6 py-4">
                <h2
                    id={titleId}
                    data-testid={titleTestId}
                    class="text-lg font-semibold"
                >
                    {title}
                </h2>
                <button
                    type="button"
                    onclick={onClose}
                    aria-label="閉じる"
                    title="閉じる"
                    data-testid={closeTestId}
                    class={closeButtonClass}>✕</button
                >
            </div>
        {:else if lightbox}
            <button
                type="button"
                onclick={onClose}
                aria-label="閉じる"
                title="閉じる"
                data-testid={closeTestId}
                class="absolute -top-3 -right-3 cursor-pointer rounded-full bg-gray-800 p-2 text-white shadow"
                >✕</button
            >
        {/if}
        {#if contentClass}
            <div class={contentClass}>{@render children()}</div>
        {:else}
            {@render children()}
        {/if}
    </dialog>
{/if}
