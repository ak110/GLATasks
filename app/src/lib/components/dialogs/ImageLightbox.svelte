<script lang="ts">
    /**
     * @fileoverview 添付画像の原寸表示ライトボックス
     *
     * 親ダイアログ（TaskEditDialog等）の内側から開かれる可能性を考慮し、
     * Escキーの伝播抑止はoverlay要素へのonkeydownで行う。
     * `<svelte:window>`経由ではdialog要素のonkeydownが先に発火して親の閉じ処理と競合するため使わない。
     */

    interface Props {
        imageUrl: string;
        onClose: () => void;
    }

    const { imageUrl, onClose }: Props = $props();

    let overlayEl: HTMLDivElement | undefined = $state();

    // マウント時にoverlayへフォーカスを移し、Escキーがoverlay側で受理されるようにする
    $effect(() => {
        overlayEl?.focus();
    });

    function handleOverlayClick(event: MouseEvent) {
        if (event.target === event.currentTarget) {
            onClose();
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        }
    }
</script>

<div
    bind:this={overlayEl}
    role="dialog"
    aria-modal="true"
    aria-label="画像の原寸表示"
    data-testid="image-lightbox"
    tabindex="-1"
    class="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 focus:outline-none"
    onclick={handleOverlayClick}
    onkeydown={handleKeydown}
>
    <button
        type="button"
        onclick={onClose}
        aria-label="閉じる"
        data-testid="image-lightbox-close"
        class="absolute top-4 right-4 cursor-pointer rounded-full bg-white/80 px-3 py-1 text-lg text-gray-900 hover:bg-white dark:bg-gray-800/80 dark:text-gray-100 dark:hover:bg-gray-700"
    >
        ×
    </button>
    <img
        src={imageUrl}
        alt="添付画像の原寸表示"
        class="max-h-full max-w-full object-contain"
    />
</div>
