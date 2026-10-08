<script module lang="ts">
    // DOMの配置順ではなく、showModalで開いた順を使う。
    interface OpenDialog {
        dialog: HTMLDialogElement;
        previousFocus: HTMLElement | null;
        previousDialog: OpenDialog | undefined;
    }
    const openDialogs: OpenDialog[] = [];
</script>

<script lang="ts">
    import { tick, type Snippet } from "svelte";
    import { closeButtonClass, UI_LAYERS } from "#lib/components/ui/styles.ts";
    import { DIALOG_OPENED_EVENT } from "#lib/client/ui/notification-layer.ts";

    interface Props {
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
    }
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
        const entry: OpenDialog = {
            dialog,
            previousFocus:
                document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null,
            previousDialog: openDialogs.at(-1),
        };
        dialog.showModal();
        openDialogs.push(entry);
        document.dispatchEvent(new Event(DIALOG_OPENED_EVENT));
        void tick().then(() => {
            if (!dialog.open || openDialogs.at(-1)?.dialog !== dialog) return;
            const target =
                initialFocus?.() ??
                dialog.querySelector<HTMLElement>("input, textarea, select") ??
                dialog.querySelector<HTMLElement>("button");
            target?.focus();
        });
        return () => {
            const wasTop = openDialogs.at(-1) === entry;
            const index = openDialogs.indexOf(entry);
            if (index !== -1) openDialogs.splice(index, 1);
            dialog.close();
            if (!wasTop) return;
            // attachmentの後始末では既にDOMが外れているため、更新後に起点へ戻す。
            void tick().then(() => {
                let target = entry.previousFocus;
                let previous = entry.previousDialog;
                // 破棄確定で複数層を閉じても、取り外した編集画面へは戻さない。
                while (previous && !openDialogs.includes(previous)) {
                    target = previous.previousFocus;
                    previous = previous.previousDialog;
                }
                // 更新中に別のモーダルを開いた場合、そのフォーカスを奪わない。
                if (openDialogs.at(-1) !== previous) return;
                if (
                    target?.isConnected &&
                    (!previous || previous.dialog.contains(target))
                ) {
                    target.focus();
                } else {
                    previous?.dialog.focus();
                }
            });
        };
    }

    function handleKeydown(event: KeyboardEvent) {
        const dialog = event.currentTarget as HTMLDialogElement;
        if (openDialogs.at(-1)?.dialog !== dialog) return;
        onkeydown?.(event);
        if (
            event.defaultPrevented ||
            event.key !== "Tab" ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
        )
            return;

        const targets = Array.from(
            dialog.querySelectorAll<HTMLElement>(
                "button, input, textarea, select, a[href], [tabindex], [contenteditable]",
            ),
        )
            .filter((element) => {
                const style = getComputedStyle(element);
                return (
                    element.tabIndex >= 0 &&
                    !element.matches(":disabled") &&
                    !element.closest("[hidden], [inert]") &&
                    element.closest("dialog") === dialog &&
                    style.visibility !== "hidden" &&
                    style.visibility !== "collapse" &&
                    element.getClientRects().length > 0
                );
            })
            .sort(
                (left, right) =>
                    (left.tabIndex || Infinity) - (right.tabIndex || Infinity),
            );
        const first = targets[0];
        const last = targets.at(-1);
        const active = document.activeElement;
        // 内部の通常移動はブラウザーに任せ、ブラウザーUIへ抜ける両端だけ循環させる。
        if (
            !first ||
            !targets.includes(active as HTMLElement) ||
            (event.shiftKey ? active === first : active === last)
        ) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
            if (!first) dialog.focus();
        }
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
        onkeydown={handleKeydown}
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
