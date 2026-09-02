<script lang="ts">
    type Item = { id: number; name: string };
    type RecordRow = {
        id: number;
        item_id: number;
        item_name: string;
        item_kcal: number;
        consumed_at: string;
        quantity: number;
        total_kcal: number;
    };
    type RecordInput = {
        consumed_at: string;
        item_id: number;
        quantity: number;
        tz_offset_minutes: number;
    };
    type Props = {
        items: Item[];
        records: RecordRow[];
        windowOffset: number;
        onWindowChange: (offset: number) => void;
        onCreate: (input: RecordInput) => unknown;
        onUpdate: (input: RecordInput & { recordId: number }) => unknown;
        onDelete: (record: RecordRow) => void;
    };

    let {
        items,
        records,
        windowOffset,
        onWindowChange,
        onCreate,
        onUpdate,
        onDelete,
    }: Props = $props();
    let editingId = $state<number | undefined>();
    let consumedAt = $state(formatLocalMinute(new Date()));
    let itemName = $state("");
    let quantity = $state("1");

    function pad(value: number): string {
        return String(value).padStart(2, "0");
    }

    function formatLocalMinute(date: Date): string {
        return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function resetForm() {
        editingId = undefined;
        consumedAt = formatLocalMinute(new Date());
        itemName = "";
        quantity = "1";
    }

    function edit(record: RecordRow) {
        editingId = record.id;
        consumedAt = formatLocalMinute(new Date(record.consumed_at));
        itemName = record.item_name;
        quantity = String(record.quantity);
    }

    function copy(record: RecordRow) {
        editingId = undefined;
        consumedAt = formatLocalMinute(new Date());
        itemName = record.item_name;
        quantity = String(record.quantity);
    }

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        const item = items.find((candidate) => candidate.name === itemName);
        const numericQuantity = Number(quantity);
        if (!item || !Number.isInteger(numericQuantity) || numericQuantity <= 0)
            return;
        const input = {
            consumed_at: consumedAt,
            item_id: item.id,
            quantity: numericQuantity,
            tz_offset_minutes: -new Date().getTimezoneOffset(),
        };
        if (editingId === undefined) await onCreate(input);
        else await onUpdate({ recordId: editingId, ...input });
        resetForm();
    }
</script>

<section
    class="rounded border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
    aria-labelledby="calorie-records-title"
>
    <div class="mb-3 flex items-center justify-between gap-2">
        <h2
            id="calorie-records-title"
            class="text-lg font-bold text-gray-800 dark:text-gray-100"
        >
            記録
        </h2>
        <div class="flex gap-1">
            <button
                type="button"
                onclick={() => onWindowChange(windowOffset + 1)}
                class="cursor-pointer rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                >前の30日</button
            >
            <button
                type="button"
                disabled={windowOffset === 0}
                onclick={() => onWindowChange(windowOffset - 1)}
                class="cursor-pointer rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 disabled:cursor-default disabled:opacity-40 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                >次の30日</button
            >
        </div>
    </div>

    <form
        class="mb-4 grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_3rem_auto]"
        onsubmit={submit}
    >
        <label class="sr-only" for="calorie-record-datetime">日時</label>
        <input
            id="calorie-record-datetime"
            bind:value={consumedAt}
            required
            pattern={"[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}"}
            placeholder="yyyy/MM/dd HH:mm"
            class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        <label class="sr-only" for="calorie-record-item">品目</label>
        <input
            id="calorie-record-item"
            bind:value={itemName}
            list="calorie-item-options"
            required
            placeholder="品目"
            autocomplete="off"
            class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        <datalist id="calorie-item-options">
            {#each items as item (item.id)}<option value={item.name}
                ></option>{/each}
        </datalist>
        <label class="sr-only" for="calorie-record-quantity">数量</label>
        <input
            id="calorie-record-quantity"
            bind:value={quantity}
            required
            type="number"
            min="1"
            step="1"
            placeholder="数量"
            class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        <div class="flex gap-1">
            <button
                type="submit"
                class="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >{editingId === undefined ? "追加" : "変更"}</button
            >
            <button
                type="button"
                onclick={resetForm}
                class="cursor-pointer rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                >取消</button
            >
        </div>
    </form>

    <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
            <thead
                class="border-b border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
                ><tr
                    ><th class="p-2">日時</th><th class="p-2">品目</th><th
                        class="p-2 text-right">数量</th
                    ><th class="p-2 text-right">kcal</th><th class="p-2"
                    ></th></tr
                ></thead
            >
            <tbody>
                {#each records as record (record.id)}
                    <tr
                        class="border-b border-gray-200 text-gray-800 last:border-0 dark:border-gray-700 dark:text-gray-100"
                        data-testid="calorie-record-row"
                    >
                        <td class="p-2 whitespace-nowrap"
                            >{formatLocalMinute(
                                new Date(record.consumed_at),
                            )}</td
                        >
                        <td class="p-2">{record.item_name}</td>
                        <td class="p-2 text-right">{record.quantity}</td>
                        <td class="p-2 text-right">{record.total_kcal}</td>
                        <td class="p-2 text-right whitespace-nowrap">
                            <button
                                type="button"
                                onclick={() => copy(record)}
                                class="cursor-pointer rounded p-1 text-blue-600 hover:bg-gray-100 dark:text-blue-400 dark:hover:bg-gray-700"
                                data-testid="calorie-record-copy">コピー</button
                            >
                            <button
                                type="button"
                                onclick={() => edit(record)}
                                class="cursor-pointer rounded p-1 text-blue-600 hover:bg-gray-100 dark:text-blue-400 dark:hover:bg-gray-700"
                                >編集</button
                            >
                            <button
                                type="button"
                                onclick={() => onDelete(record)}
                                class="cursor-pointer rounded p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                                >削除</button
                            >
                        </td>
                    </tr>
                {:else}
                    <tr
                        ><td
                            colspan="5"
                            class="p-4 text-center text-gray-400 dark:text-gray-500"
                            >この期間の記録はありません</td
                        ></tr
                    >
                {/each}
            </tbody>
        </table>
    </div>
</section>
