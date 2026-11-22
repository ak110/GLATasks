<script lang="ts">
    import { grayButtonClass } from "#lib/components/ui/styles.ts";

    let {
        data,
        onPage,
    }: {
        data: { page: number; pageSize: number; total: number };
        onPage: (page: number) => void;
    } = $props();

    const pageCount = $derived(
        Math.max(1, Math.ceil(data.total / data.pageSize)),
    );
</script>

{#if pageCount > 1}
    <nav
        aria-label="ページ切り替え"
        class="flex shrink-0 items-center justify-center gap-3 p-2"
    >
        <button
            type="button"
            class={grayButtonClass}
            disabled={data.page === 0}
            onclick={() => onPage(data.page - 1)}>前のページ</button
        >
        <span role="status">{data.page + 1} / {pageCount}</span>
        <button
            type="button"
            class={grayButtonClass}
            disabled={data.page + 1 >= pageCount}
            onclick={() => onPage(data.page + 1)}>次のページ</button
        >
    </nav>
{/if}
