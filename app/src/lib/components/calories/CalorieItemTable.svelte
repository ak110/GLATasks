<script lang="ts">
    import CalorieEditDialog from "./CalorieEditDialog.svelte";

    type Item = { id: number; name: string; kcal: number; note: string };
    type ItemInput = { name: string; kcal: number; note: string };
    type Props = {
        items: Item[];
        onCreate: (input: ItemInput) => unknown;
        onUpdate: (input: ItemInput & { itemId: number }) => unknown;
    };

    let { items, onCreate, onUpdate }: Props = $props();
    let editingId = $state<number | undefined>();
    let name = $state("");
    let kcal = $state("");
    let note = $state("");
    let itemFilter = $state("");
    let visibleItems = $derived.by(() => {
        const keyword = itemFilter.trim().toLowerCase();
        return keyword === ""
            ? items
            : items.filter(
                  (item) =>
                      item.name.toLowerCase().includes(keyword) ||
                      item.note.toLowerCase().includes(keyword),
              );
    });

    function clearForm() {
        editingId = undefined;
        name = "";
        kcal = "";
        note = "";
    }

    function edit(item: Item) {
        editingId = item.id;
        name = item.name;
        kcal = String(item.kcal);
        note = item.note;
    }

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        const input = { name, kcal: Number(kcal), note };
        if (
            !input.name.trim() ||
            !Number.isInteger(input.kcal) ||
            input.kcal <= 0
        )
            return;
        if (editingId === undefined) await onCreate(input);
        else await onUpdate({ itemId: editingId, ...input });
        clearForm();
    }
</script>

<section
    class="rounded border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
    aria-labelledby="calorie-items-title"
>
    <h2
        id="calorie-items-title"
        class="mb-3 text-lg font-bold text-gray-800 dark:text-gray-100"
    >
        品目
    </h2>
    {#snippet nameInput()}
        <input
            id="calorie-item-name"
            bind:value={name}
            required
            maxlength="255"
            placeholder="品目名"
            class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
    {/snippet}
    {#snippet kcalInput()}
        <input
            id="calorie-item-kcal"
            bind:value={kcal}
            required
            type="number"
            min="1"
            step="1"
            placeholder="kcal"
            class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
    {/snippet}
    {#snippet noteInput()}
        <input
            id="calorie-item-note"
            bind:value={note}
            maxlength="10000"
            placeholder="備考"
            class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
    {/snippet}

    {#if editingId === undefined}
        <form
            class="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_4rem_5rem_auto]"
            onsubmit={submit}
        >
            <label class="sr-only" for="calorie-item-name">品目名</label>
            {@render nameInput()}
            <label class="sr-only" for="calorie-item-kcal">kcal</label>
            {@render kcalInput()}
            <label class="sr-only" for="calorie-item-note">備考</label>
            {@render noteInput()}
            <div class="flex gap-1">
                <button
                    type="submit"
                    class="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >
                    追加
                </button>
            </div>
        </form>
    {:else}
        <CalorieEditDialog title="品目の編集" onClose={clearForm}>
            <!-- ダイアログの幅が足りればラベルを左・入力欄を右に並べ、狭ければラベルの下に入力欄を置く -->
            <form class="@container" onsubmit={submit}>
                <div
                    class="grid gap-3 @sm:grid-cols-[4rem_minmax(0,1fr)] @sm:items-center"
                >
                    <div class="grid gap-1 @sm:contents">
                        <label
                            for="calorie-item-name"
                            class="text-sm font-medium text-gray-700 dark:text-gray-200"
                            >品目名</label
                        >
                        {@render nameInput()}
                    </div>
                    <div class="grid gap-1 @sm:contents">
                        <label
                            for="calorie-item-kcal"
                            class="text-sm font-medium text-gray-700 dark:text-gray-200"
                            >kcal</label
                        >
                        {@render kcalInput()}
                    </div>
                    <div class="grid gap-1 @sm:contents">
                        <label
                            for="calorie-item-note"
                            class="text-sm font-medium text-gray-700 dark:text-gray-200"
                            >備考</label
                        >
                        {@render noteInput()}
                    </div>
                </div>
                <div class="mt-5 flex justify-end">
                    <button
                        type="submit"
                        class="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                        >変更</button
                    >
                </div>
            </form>
        </CalorieEditDialog>
    {/if}

    <div class="overflow-x-auto">
        <table class="w-full table-fixed text-left text-sm">
            <colgroup
                ><col /><col class="w-16" /><col class="w-20" /><col
                    class="w-14"
                /></colgroup
            >
            <thead
                class="border-b border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
            >
                <tr
                    ><th class="p-2">品目</th><th class="p-2 text-right"
                        >kcal</th
                    ><th class="p-2">備考</th><th class="p-2"></th></tr
                ><tr
                    ><th class="p-1"
                        ><input
                            type="search"
                            bind:value={itemFilter}
                            autocomplete="off"
                            data-testid="calorie-item-filter"
                            placeholder="品目名と備考で検索"
                            aria-label="品目名と備考で品目を検索"
                            class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-normal text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        /></th
                    ><th class="p-1"></th><th class="p-1"></th><th
                        class="p-1 text-right"
                        ><button
                            type="button"
                            onclick={() => (itemFilter = "")}
                            data-testid="calorie-item-filter-clear"
                            aria-label="品目の検索条件を消去"
                            title="検索条件を消去"
                            class="cursor-pointer rounded p-1 font-normal text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                            >×</button
                        ></th
                    ></tr
                >
            </thead>
            <tbody>
                {#each visibleItems as item (item.id)}
                    <tr
                        class="border-b border-gray-200 text-gray-800 last:border-0 dark:border-gray-700 dark:text-gray-100"
                        data-testid="calorie-item-row"
                    >
                        <td class="truncate p-2" title={item.name}
                            >{item.name}</td
                        >
                        <td class="p-2 text-right">{item.kcal}</td>
                        <td
                            class="truncate p-2 text-gray-600 dark:text-gray-300"
                            title={item.note}>{item.note}</td
                        >
                        <td class="p-2 text-right whitespace-nowrap">
                            <button
                                type="button"
                                onclick={() => edit(item)}
                                class="cursor-pointer rounded p-1 text-blue-600 hover:bg-gray-100 dark:text-blue-400 dark:hover:bg-gray-700"
                                >編集</button
                            >
                        </td>
                    </tr>
                {:else}
                    <tr
                        ><td
                            colspan="4"
                            class="p-4 text-center text-gray-400 dark:text-gray-500"
                            >{items.length === 0
                                ? "品目がありません"
                                : "該当する品目はありません"}</td
                        ></tr
                    >
                {/each}
            </tbody>
        </table>
    </div>
</section>
