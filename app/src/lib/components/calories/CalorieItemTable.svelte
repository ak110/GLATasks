<script lang="ts">
    import type { RouterInputs, RouterOutputs } from "#lib/client/trpc.ts";
    import { inputClass } from "#lib/components/ui/styles.ts";
    import { menuBehavior } from "#lib/actions/menu.ts";
    import {
        menuFrameClass,
        menuBlueItemClass,
        menuDangerItemClass,
    } from "#lib/components/ui/styles.ts";
    import ConfirmDialog from "#lib/components/dialogs/ConfirmDialog.svelte";
    import Dialog from "#lib/components/dialogs/Dialog.svelte";
    import CalorieFilterStatus from "./CalorieFilterStatus.svelte";

    type Item = RouterOutputs["calories"]["items"][number];
    type ItemInput = RouterInputs["calories"]["createItem"];
    interface Props {
        items: Item[];
        onCreate: (input: ItemInput) => unknown;
        onUpdate: (input: RouterInputs["calories"]["updateItem"]) => unknown;
        onDelete: (
            itemId: RouterInputs["calories"]["deleteItem"]["itemId"],
        ) => unknown;
        /** 追加フォームの品目名欄の値。ページが両表の検索語として使う */
        addName?: string;
        /** 前後の空白を除いた検索語。大文字小文字を区別せず、全ての語がそれぞれ品目名か備考に含まれる品目だけを表示する */
        filterKeywords: string[];
        onClearFilter: () => void;
    }

    let {
        items,
        onCreate,
        onUpdate,
        onDelete,
        addName = $bindable(""),
        filterKeywords,
        onClearFilter,
    }: Props = $props();
    let editingId = $state<number | undefined>();
    let openMenuId = $state<number | undefined>();
    let deleteTarget = $state<Item | undefined>();
    // 編集ダイアログの品目名欄は追加フォームと別に持ち、編集中の名前を検索語にしない
    let editName = $state("");
    const name = $derived(editingId === undefined ? addName : editName);
    let kcal = $state("");
    let note = $state("");
    const visibleItems = $derived(
        items.filter((item) => {
            const itemName = item.name.toLowerCase();
            const itemNote = item.note.toLowerCase();
            return filterKeywords.every((keyword) => {
                const lowered = keyword.toLowerCase();
                return itemName.includes(lowered) || itemNote.includes(lowered);
            });
        }),
    );

    /** 使用中の品目は削除できないため、削除の代わりに使用件数を示す文言を返す */
    function usageText(item: Item): string | undefined {
        const counts = {
            records: item.recordCount,
            autoRecords: item.autoRecordCount,
        };
        if (!counts || (counts.records === 0 && counts.autoRecords === 0))
            return undefined;
        const parts = [
            counts.records > 0 ? `記録${counts.records}件` : "",
            counts.autoRecords > 0 ? `自動記録${counts.autoRecords}件` : "",
        ].filter(Boolean);
        return `${parts.join("・")}で使用中`;
    }

    async function confirmDelete() {
        if (!deleteTarget) return;
        await onDelete(deleteTarget.id);
        deleteTarget = undefined;
    }

    function clearForm() {
        editingId = undefined;
        addName = "";
        editName = "";
        kcal = "";
        note = "";
    }

    function setName(value: string) {
        if (editingId === undefined) addName = value;
        else editName = value;
    }

    function edit(item: Item) {
        openMenuId = undefined;
        editingId = item.id;
        // 編集の開始で追加フォームの入力を破棄するため、検索も解除される
        addName = "";
        editName = item.name;
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
            bind:value={() => name, setName}
            required
            maxlength="255"
            placeholder="品目名"
            class={inputClass}
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
            class={inputClass}
        />
    {/snippet}
    {#snippet noteInput()}
        <input
            id="calorie-item-note"
            bind:value={note}
            maxlength="10000"
            placeholder="備考"
            class={inputClass}
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
        <Dialog contentClass="p-6 pt-0" title="品目の編集" onClose={clearForm}>
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
        </Dialog>
    {/if}

    <!-- 横スクロールの要素で囲むと、最後の行の「⋯」メニューが表の下端で切り取られるため囲まない -->
    <CalorieFilterStatus keywords={filterKeywords} onClear={onClearFilter} />
    <table class="w-full table-fixed text-left text-sm">
        <colgroup
            ><col /><col class="w-16" /><col class="w-20" /><col
                class="w-10"
            /></colgroup
        >
        <thead
            class="border-b border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
        >
            <tr
                ><th class="p-2">品目</th><th class="p-2 text-right">kcal</th
                ><th class="p-2">備考</th><th class="p-2"></th></tr
            >
        </thead>
        <tbody>
            {#each visibleItems as item (item.id)}
                <tr
                    class="border-b border-gray-200 text-gray-800 last:border-0 dark:border-gray-700 dark:text-gray-100"
                    data-testid="calorie-item-row"
                >
                    <td class="truncate p-2" title={item.name}>{item.name}</td>
                    <td class="p-2 text-right">{item.kcal}</td>
                    <td
                        class="truncate p-2 text-gray-600 dark:text-gray-300"
                        title={item.note}>{item.note}</td
                    >
                    <td class="p-2 text-right">
                        <div
                            class="relative"
                            data-item-menu
                            use:menuBehavior={{
                                open: openMenuId === item.id,
                                onClose: () => (openMenuId = undefined),
                            }}
                        >
                            <button
                                type="button"
                                onclick={() =>
                                    (openMenuId =
                                        openMenuId === item.id
                                            ? undefined
                                            : item.id)}
                                class="cursor-pointer rounded px-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                                data-testid="calorie-item-menu-btn"
                                aria-label="品目の操作"
                                title="操作">⋯</button
                            >
                            {#if openMenuId === item.id}
                                {@const inUse = usageText(item)}
                                <div
                                    class={menuFrameClass}
                                    data-menu-frame
                                    role="menu"
                                    data-testid="calorie-item-menu"
                                >
                                    <button
                                        type="button"
                                        onclick={() => edit(item)}
                                        class={menuBlueItemClass}
                                        role="menuitem">編集</button
                                    >
                                    <!-- 使用中の品目を削除すると記録の品目名とkcalが失われるため、削除を無効にして理由を示す -->
                                    <button
                                        type="button"
                                        disabled={inUse !== undefined}
                                        onclick={() => {
                                            openMenuId = undefined;
                                            deleteTarget = item;
                                        }}
                                        class={menuDangerItemClass}
                                        role="menuitem"
                                        >削除{#if inUse}<span
                                                class="block text-xs"
                                                >{inUse}</span
                                            >{/if}</button
                                    >
                                </div>
                            {/if}
                        </div>
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
</section>

<ConfirmDialog
    open={deleteTarget !== undefined}
    title="品目の削除"
    message={deleteTarget ? `「${deleteTarget.name}」を削除しますか？` : ""}
    confirmLabel="削除"
    variant="danger"
    onConfirm={confirmDelete}
    onCancel={() => (deleteTarget = undefined)}
/>
