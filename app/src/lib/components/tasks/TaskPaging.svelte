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
    function jump(event: SubmitEvent) {
        event.preventDefault();
        if (!(event.currentTarget instanceof HTMLFormElement)) return;
        const requested = Number(new FormData(event.currentTarget).get("page"));
        if (
            Number.isInteger(requested) &&
            requested >= 1 &&
            requested <= pageCount
        ) {
            onPage(requested - 1);
        }
    }
</script>

{#if pageCount > 1}
    <nav
        aria-label="ページ切り替え"
        class="flex shrink-0 flex-wrap items-center justify-center gap-3 p-2"
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
        <form class="flex items-center gap-2" onsubmit={jump}>
            <input
                type="number"
                name="page"
                aria-label="ページ番号"
                class="w-20 rounded border px-2 py-1"
                min="1"
                max={pageCount}
                value={data.page + 1}
                required
            />
            <button type="submit" class={grayButtonClass}>移動</button>
        </form>
    </nav>
{/if}
