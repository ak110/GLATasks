<script lang="ts">
    import Dialog from "#lib/components/dialogs/Dialog.svelte";
    type Props = { imageUrl: string; onClose: () => void };
    let { imageUrl, onClose }: Props = $props();
</script>

<Dialog
    label="画像の原寸表示"
    testId="image-lightbox"
    closeTestId="image-lightbox-close"
    lightbox
    {onClose}
>
    <img
        src={imageUrl}
        alt="添付画像の原寸表示"
        class="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] object-contain"
    />
</Dialog>
