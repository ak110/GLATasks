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
    let openMenuId = $state<number | undefined>();
    let consumedAt = $state(formatLocalMinute(new Date()));
    let itemName = $state("");
    let quantity = $state("1");
    let recordFilter = $state("");
    let visibleRecords = $derived.by(() => {
        const keyword = recordFilter.trim().toLowerCase();
        return keyword === ""
            ? records
            : records.filter((record) =>
                  record.item_name.toLowerCase().includes(keyword),
              );
    });

    // 操作メニュー外クリック/Escapeで閉じる
    $effect(() => {
        if (openMenuId === undefined) return;
        const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target?.closest("[data-record-menu]")) openMenuId = undefined;
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") openMenuId = undefined;
        };
        document.addEventListener("mousedown", onClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onClick);
            document.removeEventListener("keydown", onKey);
        };
    });

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
        openMenuId = undefined;
        editingId = record.id;
        consumedAt = formatLocalMinute(new Date(record.consumed_at));
        itemName = record.item_name;
        quantity = String(record.quantity);
    }

    function copy(record: RecordRow) {
        openMenuId = undefined;
        editingId = undefined;
        consumedAt = formatLocalMinute(new Date());
        itemName = record.item_name;
        quantity = String(record.quantity);
    }

    function remove(record: RecordRow) {
        openMenuId = undefined;
        onDelete(record);
    }

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        const item = items.find((candidate) => candidate.name === itemName);
        const numericQuantity = Number(quantity);
        if (!item || !Number.isInteger(numericQuantity) || numericQuantity < 0)
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
        class="mb-4 grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_4rem_auto]"
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
            min="0"
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

    <table class="w-full table-fixed text-left text-sm">
        <colgroup
            ><col class="w-36" /><col /><col class="w-16" /><col
                class="w-16"
            /><col class="w-10" /></colgroup
        >
        <thead
            class="border-b border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
            ><tr
                ><th class="p-2 whitespace-nowrap">日時</th><th
                    class="p-2 whitespace-nowrap">品目</th
                ><th class="p-2 text-right whitespace-nowrap">数量</th><th
                    class="p-2 text-right whitespace-nowrap">kcal</th
                ><th class="p-2"></th></tr
            ><tr
                ><th class="p-1"></th><th class="p-1"
                    ><input
                        type="search"
                        bind:value={recordFilter}
                        autocomplete="off"
                        data-testid="calorie-record-filter"
                        placeholder="品目で検索"
                        aria-label="品目で記録を検索"
                        class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-normal text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    /></th
                ><th class="p-1"></th><th class="p-1"></th><th
                    class="p-1 text-right"
                    ><button
                        type="button"
                        onclick={() => (recordFilter = "")}
                        data-testid="calorie-record-filter-clear"
                        aria-label="記録の検索条件を消去"
                        title="検索条件を消去"
                        class="cursor-pointer rounded p-1 font-normal text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                        >×</button
                    ></th
                ></tr
            ></thead
        >
        <tbody>
            {#each visibleRecords as record (record.id)}
                <tr
                    class="border-b border-gray-200 text-gray-800 last:border-0 dark:border-gray-700 dark:text-gray-100"
                    data-testid="calorie-record-row"
                >
                    <td class="p-2 whitespace-nowrap"
                        >{formatLocalMinute(new Date(record.consumed_at))}</td
                    >
                    <td class="truncate p-2" title={record.item_name}
                        >{record.item_name}</td
                    >
                    <td class="p-2 text-right">{record.quantity}</td>
                    <td class="p-2 text-right">{record.total_kcal}</td>
                    <td class="p-2 text-right">
                        <div class="relative" data-record-menu>
                            <button
                                type="button"
                                onclick={() =>
                                    (openMenuId =
                                        openMenuId === record.id
                                            ? undefined
                                            : record.id)}
                                class="cursor-pointer rounded px-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                                data-testid="calorie-record-menu-btn"
                                aria-label="記録の操作"
                                aria-haspopup="menu"
                                aria-expanded={openMenuId === record.id}
                                title="操作">⋯</button
                            >
                            {#if openMenuId === record.id}
                                <div
                                    class="absolute top-full right-0 z-20 min-w-max rounded border border-gray-200 bg-white py-1 text-left shadow-lg dark:border-gray-600 dark:bg-gray-800"
                                    role="menu"
                                    data-testid="calorie-record-menu"
                                >
                                    <button
                                        type="button"
                                        onclick={() => copy(record)}
                                        class="block w-full cursor-pointer px-4 py-1.5 text-left text-blue-600 hover:bg-gray-100 dark:text-blue-400 dark:hover:bg-gray-700"
                                        data-testid="calorie-record-copy"
                                        role="menuitem">コピー</button
                                    >
                                    <button
                                        type="button"
                                        onclick={() => edit(record)}
                                        class="block w-full cursor-pointer px-4 py-1.5 text-left text-blue-600 hover:bg-gray-100 dark:text-blue-400 dark:hover:bg-gray-700"
                                        role="menuitem">編集</button
                                    >
                                    <button
                                        type="button"
                                        onclick={() => remove(record)}
                                        class="block w-full cursor-pointer px-4 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                                        role="menuitem">削除</button
                                    >
                                </div>
                            {/if}
                        </div>
                    </td>
                </tr>
            {:else}
                <tr
                    ><td
                        colspan="5"
                        class="p-4 text-center text-gray-400 dark:text-gray-500"
                        >{records.length === 0
                            ? "この期間の記録はありません"
                            : "該当する記録はありません"}</td
                    ></tr
                >
            {/each}
        </tbody>
    </table>
</section>
