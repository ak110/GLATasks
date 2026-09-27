<script lang="ts">
    // 追加欄の入力を検索語として兼用するため、検索で一覧を限定している間だけ理由と解除操作を示す
    type Props = {
        keywords: string[];
        onClear: () => void;
    };

    let { keywords, onClear }: Props = $props();
</script>

{#if keywords.length > 0}
    <div
        class="mb-2 flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300"
        role="status"
        data-testid="calorie-filter-status"
    >
        <span class="min-w-0 truncate"
            >{keywords
                .map((keyword) => `「${keyword}」`)
                .join("")}で検索中</span
        >
        <button
            type="button"
            onclick={onClear}
            class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            aria-label="検索を解除"
            title="検索を解除">×</button
        >
    </div>
{/if}
