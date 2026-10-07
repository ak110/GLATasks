<script lang="ts">
    import type { Snippet } from "svelte";
    type Props = { testId: string; children: Snippet };
    let { testId, children }: Props = $props();
</script>

<div
    class="flex items-center justify-center gap-3 bg-blue-600 px-4 py-2 text-sm text-white shadow-md dark:bg-blue-700"
    role="status"
    data-testid={testId}
>
    <span>{@render children()}</span>
    <button
        type="button"
        class="cursor-pointer rounded bg-white px-3 py-1 font-semibold text-blue-700 hover:bg-blue-50 dark:bg-blue-100 dark:hover:bg-white"
        onclick={() => location.reload()}>再読み込み</button
    >
</div>
