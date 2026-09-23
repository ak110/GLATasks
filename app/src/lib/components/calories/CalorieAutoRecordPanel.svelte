<script lang="ts">
    /**
     * @fileoverview カロリーの自動記録設定（毎日指定時刻に記録を追加する）の一覧と編集
     */

    import CalorieEditDialog from "./CalorieEditDialog.svelte";
    import ConfirmDialog from "$lib/components/dialogs/ConfirmDialog.svelte";

    type Item = { id: number; name: string };
    type AutoRecord = {
        id: number;
        item_id: number;
        item_name: string;
        time_of_day: string;
        quantity: number;
        enabled: boolean;
    };
    type AutoRecordInput = {
        time_of_day: string;
        item_id: number;
        quantity: number;
        enabled: boolean;
        tz_offset_minutes: number;
    };
    type Props = {
        items: Item[];
        autoRecords: AutoRecord[];
        onCreate: (input: AutoRecordInput) => unknown;
        onUpdate: (
            input: AutoRecordInput & { autoRecordId: number },
        ) => unknown;
        onDelete: (autoRecordId: number) => unknown;
    };

    let { items, autoRecords, onCreate, onUpdate, onDelete }: Props = $props();
    let editing = $state<AutoRecord | undefined>();
    let deleteTarget = $state<AutoRecord | undefined>();
    let timeOfDay = $state("");
    let itemName = $state("");
    let quantity = $state("1");

    function tzOffsetMinutes(): number {
        return -new Date().getTimezoneOffset();
    }

    function resetForm() {
        editing = undefined;
        timeOfDay = "";
        itemName = "";
        quantity = "1";
    }

    function edit(autoRecord: AutoRecord) {
        editing = autoRecord;
        timeOfDay = autoRecord.time_of_day;
        itemName = autoRecord.item_name;
        quantity = String(autoRecord.quantity);
    }

    async function toggle(autoRecord: AutoRecord) {
        await onUpdate({
            autoRecordId: autoRecord.id,
            time_of_day: autoRecord.time_of_day,
            item_id: autoRecord.item_id,
            quantity: autoRecord.quantity,
            enabled: !autoRecord.enabled,
            tz_offset_minutes: tzOffsetMinutes(),
        });
    }

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        const item = items.find((candidate) => candidate.name === itemName);
        const numericQuantity = Number(quantity);
        if (!item || !Number.isInteger(numericQuantity) || numericQuantity < 0)
            return;
        const input = {
            time_of_day: timeOfDay,
            item_id: item.id,
            quantity: numericQuantity,
            enabled: editing?.enabled ?? true,
            tz_offset_minutes: tzOffsetMinutes(),
        };
        if (editing === undefined) await onCreate(input);
        else await onUpdate({ autoRecordId: editing.id, ...input });
        resetForm();
    }

    async function confirmDelete() {
        if (!deleteTarget) return;
        await onDelete(deleteTarget.id);
        deleteTarget = undefined;
    }
</script>

<section
    class="rounded border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
    aria-labelledby="calorie-auto-records-title"
>
    <h2
        id="calorie-auto-records-title"
        class="mb-1 text-lg font-bold text-gray-800 dark:text-gray-100"
    >
        自動記録
    </h2>
    <p class="mb-3 text-sm text-gray-600 dark:text-gray-300">
        ONの設定は、毎日指定した時刻に記録を追加します。
    </p>

    {#snippet autoRecordForm()}
        <form
            class={editing === undefined
                ? "mb-4 grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_4rem_auto]"
                : "grid gap-2"}
            onsubmit={submit}
        >
            <label class="sr-only" for="calorie-auto-time">時刻</label>
            <input
                id="calorie-auto-time"
                bind:value={timeOfDay}
                type="time"
                required
                class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <label class="sr-only" for="calorie-auto-item">品目</label>
            <input
                id="calorie-auto-item"
                bind:value={itemName}
                list="calorie-auto-item-options"
                required
                placeholder="品目"
                autocomplete="off"
                class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <datalist id="calorie-auto-item-options">
                {#each items as item (item.id)}<option value={item.name}
                    ></option>{/each}
            </datalist>
            <label class="sr-only" for="calorie-auto-quantity">数量</label>
            <input
                id="calorie-auto-quantity"
                bind:value={quantity}
                required
                type="number"
                min="0"
                step="1"
                placeholder="数量"
                class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <button
                type="submit"
                class="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >{editing === undefined ? "追加" : "変更"}</button
            >
        </form>
    {/snippet}
    {#if editing !== undefined}
        <CalorieEditDialog title="自動記録の編集" onClose={resetForm}>
            {@render autoRecordForm()}
        </CalorieEditDialog>
    {:else}
        {@render autoRecordForm()}
    {/if}

    <table class="w-full table-fixed text-left text-sm">
        <colgroup
            ><col class="w-16" /><col /><col class="w-14" /><col
                class="w-14"
            /><col class="w-28" /></colgroup
        >
        <thead
            class="border-b border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
            ><tr
                ><th class="p-2 whitespace-nowrap">時刻</th><th
                    class="p-2 whitespace-nowrap">品目</th
                ><th class="p-2 text-right whitespace-nowrap">数量</th><th
                    class="p-2 text-center whitespace-nowrap">ON</th
                ><th class="p-2"></th></tr
            ></thead
        >
        <tbody>
            {#each autoRecords as autoRecord (autoRecord.id)}
                <tr
                    class="border-b border-gray-200 text-gray-800 last:border-0 dark:border-gray-700 dark:text-gray-100"
                    data-testid="calorie-auto-record-row"
                >
                    <td class="p-2">{autoRecord.time_of_day}</td>
                    <td class="truncate p-2" title={autoRecord.item_name}
                        >{autoRecord.item_name}</td
                    >
                    <td class="p-2 text-right">{autoRecord.quantity}</td>
                    <td class="p-2 text-center"
                        ><input
                            type="checkbox"
                            checked={autoRecord.enabled}
                            onchange={() => toggle(autoRecord)}
                            aria-label={`${autoRecord.time_of_day} ${autoRecord.item_name}の自動記録`}
                            data-testid="calorie-auto-record-enabled"
                            class="cursor-pointer"
                        /></td
                    >
                    <td class="p-2 text-right whitespace-nowrap">
                        <button
                            type="button"
                            onclick={() => edit(autoRecord)}
                            class="cursor-pointer rounded px-1.5 py-0.5 text-blue-600 hover:bg-gray-100 dark:text-blue-400 dark:hover:bg-gray-700"
                            >編集</button
                        >
                        <button
                            type="button"
                            onclick={() => (deleteTarget = autoRecord)}
                            class="cursor-pointer rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                            >削除</button
                        >
                    </td>
                </tr>
            {:else}
                <tr
                    ><td
                        colspan="5"
                        class="p-4 text-center text-gray-400 dark:text-gray-500"
                        >自動記録の設定はありません</td
                    ></tr
                >
            {/each}
        </tbody>
    </table>
</section>

<ConfirmDialog
    open={deleteTarget !== undefined}
    title="自動記録の削除"
    message={deleteTarget
        ? `${deleteTarget.time_of_day}の「${deleteTarget.item_name}」の自動記録を削除しますか？追加済みの記録は残ります。`
        : ""}
    confirmLabel="削除"
    variant="danger"
    onConfirm={confirmDelete}
    onCancel={() => (deleteTarget = undefined)}
/>
