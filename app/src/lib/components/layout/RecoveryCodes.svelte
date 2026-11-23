<script lang="ts">
    import { grayButtonClass } from "#lib/components/ui/styles.ts";
    let {
        codes,
        onSaved,
    }: { codes: string[]; onSaved: () => void | Promise<void> } = $props();
    let savedCodes = $state<string>();
    const displayedCodes = $derived(codes.join("\n"));
</script>

<section
    aria-label="復旧コード"
    class="my-4 space-y-3"
    data-testid="recovery-codes"
>
    <h2 class="font-semibold">復旧コードを保存</h2>
    <p>
        再表示できません。安全な場所に保存してください。各コードは1回だけ使えます。
    </p>
    <pre
        class="overflow-x-auto rounded bg-gray-100 p-3 text-sm dark:bg-gray-700">{displayedCodes}</pre>
    <label class="flex cursor-pointer gap-2">
        <input
            type="checkbox"
            checked={savedCodes === displayedCodes}
            onchange={(event) => {
                savedCodes = event.currentTarget.checked
                    ? displayedCodes
                    : undefined;
            }}
            data-testid="codes-saved"
        />安全な場所に保存済み
    </label>
    <button
        type="button"
        class={grayButtonClass}
        disabled={savedCodes !== displayedCodes}
        onclick={onSaved}
        data-testid="codes-continue"
    >
        続ける
    </button>
</section>
