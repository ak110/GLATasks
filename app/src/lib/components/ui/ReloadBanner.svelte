<script lang="ts">
    import type { Snippet } from "svelte";
    interface Props {
        testId: string;
        children: Snippet;
        /** 再読み込みボタンを表示するか。再読み込みで解決しない案内では偽にする */
        showReloadButton?: boolean;
        /** 再読み込みボタンの前に並べる追加の操作 */
        actions?: Snippet<[string]>;
    }
    let {
        testId,
        children,
        showReloadButton = true,
        actions,
    }: Props = $props();

    const buttonClass =
        "cursor-pointer rounded bg-white px-3 py-1 font-semibold text-blue-700 hover:bg-blue-50 dark:bg-blue-100 dark:hover:bg-white";

    function reloadPage(): void {
        // eslint-disable-next-line no-restricted-syntax -- 利用者の操作で起こる再読み込み。通信断ならオフライン画面になるが、利用者が求めた結果である
        location.reload();
    }
</script>

<div
    class="flex items-center justify-center gap-3 bg-blue-600 px-4 py-2 text-sm text-white shadow-md dark:bg-blue-700"
    role="status"
    data-testid={testId}
>
    <span>{@render children()}</span>
    {@render actions?.(buttonClass)}
    {#if showReloadButton}
        <button type="button" class={buttonClass} onclick={reloadPage}
            >再読み込み</button
        >
    {/if}
</div>
