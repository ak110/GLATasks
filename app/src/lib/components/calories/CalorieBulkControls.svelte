<script lang="ts">
    /**
     * @fileoverview 期間を指定したカロリー記録の一括追加と一括削除
     */

    import ConfirmDialog from "$lib/components/dialogs/ConfirmDialog.svelte";

    type Item = { id: number; name: string };
    type BulkCreateInput = {
        start_date: string;
        end_date: string;
        time_of_day: string;
        item_id: number;
        quantity: number;
        tz_offset_minutes: number;
    };
    type BulkDeleteInput = {
        start_date: string;
        end_date: string;
        item_id: number;
        tz_offset_minutes: number;
    };
    type Props = {
        items: Item[];
        onBulkCreate: (input: BulkCreateInput) => Promise<{ added: number }>;
        onBulkDelete: (input: BulkDeleteInput) => Promise<{ deleted: number }>;
    };

    let { items, onBulkCreate, onBulkDelete }: Props = $props();
    let createStart = $state("");
    let createEnd = $state("");
    let createTime = $state("");
    let createItemName = $state("");
    let createQuantity = $state("1");
    let deleteStart = $state("");
    let deleteEnd = $state("");
    let deleteItemName = $state("");
    let pendingDelete = $state<BulkDeleteInput | undefined>();
    let statusMessage = $state("");

    /** `<input type="date">`の値（yyyy-MM-dd）をAPIの日付形式（yyyy/MM/dd）へ変換する */
    function toApiDate(value: string): string {
        return value.replaceAll("-", "/");
    }

    function findItem(name: string): Item | undefined {
        return items.find((candidate) => candidate.name === name);
    }

    async function submitCreate(event: SubmitEvent) {
        event.preventDefault();
        const item = findItem(createItemName);
        const quantity = Number(createQuantity);
        if (!item || !Number.isInteger(quantity) || quantity < 0) return;
        const result = await onBulkCreate({
            start_date: toApiDate(createStart),
            end_date: toApiDate(createEnd),
            time_of_day: createTime,
            item_id: item.id,
            quantity,
            tz_offset_minutes: -new Date().getTimezoneOffset(),
        });
        statusMessage = `${result.added}件の記録を追加しました`;
    }

    function submitDelete(event: SubmitEvent) {
        event.preventDefault();
        const item = findItem(deleteItemName);
        if (!item) return;
        pendingDelete = {
            start_date: toApiDate(deleteStart),
            end_date: toApiDate(deleteEnd),
            item_id: item.id,
            tz_offset_minutes: -new Date().getTimezoneOffset(),
        };
    }

    async function confirmDelete() {
        if (!pendingDelete) return;
        const result = await onBulkDelete(pendingDelete);
        pendingDelete = undefined;
        statusMessage = `${result.deleted}件の記録を削除しました`;
    }

    const inputClass =
        "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
</script>

<section
    class="rounded border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
    aria-labelledby="calorie-bulk-title"
>
    <h2
        id="calorie-bulk-title"
        class="mb-3 text-lg font-bold text-gray-800 dark:text-gray-100"
    >
        一括操作
    </h2>
    <datalist id="calorie-bulk-item-options">
        {#each items as item (item.id)}<option value={item.name}
            ></option>{/each}
    </datalist>

    <h3 class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
        期間の各日に記録を追加
    </h3>
    <form
        class="mb-4 grid gap-2 sm:grid-cols-2"
        onsubmit={submitCreate}
        data-testid="calorie-bulk-create-form"
    >
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            開始日
            <input
                bind:value={createStart}
                type="date"
                required
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            終了日
            <input
                bind:value={createEnd}
                type="date"
                required
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            時刻
            <input
                bind:value={createTime}
                type="time"
                required
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            品目
            <input
                bind:value={createItemName}
                list="calorie-bulk-item-options"
                required
                autocomplete="off"
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            数量
            <input
                bind:value={createQuantity}
                type="number"
                min="0"
                step="1"
                required
                class={inputClass}
            />
        </label>
        <div class="flex items-end">
            <button
                type="submit"
                class="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >一括追加</button
            >
        </div>
    </form>

    <h3 class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
        期間内の品目の記録を削除
    </h3>
    <form
        class="grid gap-2 sm:grid-cols-2"
        onsubmit={submitDelete}
        data-testid="calorie-bulk-delete-form"
    >
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            開始日
            <input
                bind:value={deleteStart}
                type="date"
                required
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            終了日
            <input
                bind:value={deleteEnd}
                type="date"
                required
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            品目
            <input
                bind:value={deleteItemName}
                list="calorie-bulk-item-options"
                required
                autocomplete="off"
                class={inputClass}
            />
        </label>
        <div class="flex items-end">
            <button
                type="submit"
                class="cursor-pointer rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
                >一括削除</button
            >
        </div>
    </form>

    {#if statusMessage}
        <p
            class="mt-3 text-sm text-gray-600 dark:text-gray-300"
            role="status"
            data-testid="calorie-bulk-status"
        >
            {statusMessage}
        </p>
    {/if}
</section>

<ConfirmDialog
    open={pendingDelete !== undefined}
    title="記録の一括削除"
    message={pendingDelete
        ? `${pendingDelete.start_date}から${pendingDelete.end_date}までの「${deleteItemName}」の記録を削除しますか？`
        : ""}
    confirmLabel="削除"
    variant="danger"
    onConfirm={confirmDelete}
    onCancel={() => (pendingDelete = undefined)}
/>
