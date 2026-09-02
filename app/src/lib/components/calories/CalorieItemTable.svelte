<script lang="ts">
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
    <form
        class="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)_auto]"
        onsubmit={submit}
    >
        <label class="sr-only" for="calorie-item-name">品目名</label>
        <input
            id="calorie-item-name"
            bind:value={name}
            required
            maxlength="255"
            placeholder="品目名"
            class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        <label class="sr-only" for="calorie-item-kcal">kcal</label>
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
        <label class="sr-only" for="calorie-item-note">備考</label>
        <input
            id="calorie-item-note"
            bind:value={note}
            maxlength="10000"
            placeholder="備考"
            class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        <div class="flex gap-1">
            <button
                type="submit"
                class="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
                {editingId === undefined ? "追加" : "変更"}
            </button>
            {#if editingId !== undefined}
                <button
                    type="button"
                    onclick={clearForm}
                    class="cursor-pointer rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                >
                    取消
                </button>
            {/if}
        </div>
    </form>

    <div class="overflow-x-auto">
        <table class="w-full table-fixed text-left text-sm">
            <colgroup
                ><col /><col class="w-20" /><col class="w-1/2" /><col
                    class="w-16"
                /></colgroup
            >
            <thead
                class="border-b border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
            >
                <tr
                    ><th class="p-2">品目</th><th class="p-2 text-right"
                        >kcal</th
                    ><th class="p-2">備考</th><th class="p-2"></th></tr
                >
            </thead>
            <tbody>
                {#each items as item (item.id)}
                    <tr
                        class="border-b border-gray-200 text-gray-800 last:border-0 dark:border-gray-700 dark:text-gray-100"
                        data-testid="calorie-item-row"
                    >
                        <td class="p-2">{item.name}</td>
                        <td class="p-2 text-right">{item.kcal}</td>
                        <td class="p-2 text-gray-600 dark:text-gray-300"
                            >{item.note}</td
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
                            >品目がありません</td
                        ></tr
                    >
                {/each}
            </tbody>
        </table>
    </div>
</section>
