<script lang="ts">
    import type { Snippet } from "svelte";
    interface Props {
        testId: string;
        children: Snippet;
        showReloadButton?: boolean;
        actions?: Snippet<[string]>;
    }
    let {
        testId,
        children,
        showReloadButton = true,
        actions,
    }: Props = $props();

    const buttonClass =
        "cursor-pointer whitespace-nowrap rounded bg-white px-3 py-1 font-semibold text-blue-700 hover:bg-blue-50 dark:bg-blue-100 dark:hover:bg-white";
    const secondaryButtonClass =
        "cursor-pointer whitespace-nowrap rounded border border-white px-3 py-1 font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-800";

    function reloadPage(): void {
        // eslint-disable-next-line no-restricted-syntax -- 利用者の操作で起こる再読み込み。通信断ならオフライン画面になるが、利用者が求めた結果である
        location.reload();
    }
</script>

<div
    class="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 bg-blue-600 px-4 py-2 text-sm text-white shadow-md dark:bg-blue-700"
    role="status"
    data-testid={testId}
>
    <span class="min-w-0">{@render children()}</span>
    {#if actions || showReloadButton}
        <div class="flex shrink-0 flex-wrap items-center gap-2">
            {@render actions?.(buttonClass)}
            {#if showReloadButton}
                <button
                    type="button"
                    class={actions ? secondaryButtonClass : buttonClass}
                    onclick={reloadPage}
                >
                    再読み込み
                </button>
            {/if}
        </div>
    {/if}
</div>
