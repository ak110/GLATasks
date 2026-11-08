<script lang="ts">
    import type { RouterInputs, RouterOutputs } from "#lib/client/trpc.ts";
    import { inputClass } from "#lib/components/ui/styles.ts";
    import { getUtcOffsetMinutes } from "#lib/date-time.ts";
    /**
     * @fileoverview 期間を指定したカロリー記録の一括追加と一括削除
     */

    import ConfirmDialog from "#lib/components/dialogs/ConfirmDialog.svelte";

    type Item = Pick<RouterOutputs["calories"]["items"][number], "id" | "name">;
    type BulkCreateInput = RouterInputs["calories"]["bulkCreateRecords"];
    type BulkDeleteInput = RouterInputs["calories"]["bulkDeleteRecords"];
    interface Props {
        items: Item[];
        onBulkCreate: (
            input: BulkCreateInput,
        ) => Promise<
            Pick<RouterOutputs["calories"]["bulkCreateRecords"], "added">
        >;
        onBulkDelete: (
            input: BulkDeleteInput,
        ) => Promise<
            Pick<RouterOutputs["calories"]["bulkDeleteRecords"], "deleted">
        >;
    }

    let { items, onBulkCreate, onBulkDelete }: Props = $props();
    let createStart = $state("");
    let createEnd = $state("");
    let createTime = $state("");
    let createItemName = $state("");
    let createQuantity = $state("1");
    let deleteStart = $state("");
    let deleteEnd = $state("");
    let deleteItemName = $state("");
    // 送信後も条件を欄に残すため、最後に処理した条件を欄の保存済みの値として示す。
    // 処理に成功した条件が残るだけでは未保存の入力とみなさず、自動の再読み込みを妨げない（user-busy.ts）
    let savedCreate = $state({
        start: "",
        end: "",
        time: "",
        itemName: "",
        quantity: "1",
    });
    let savedDelete = $state({ start: "", end: "", itemName: "" });
    type ResultState =
        { kind: "idle" } | { kind: "success" | "failure"; message: string };
    type DeleteRequest = {
        input: BulkDeleteInput;
        itemName: string;
        fields: { start: string; end: string; itemName: string };
    };
    let createState = $state<
        ResultState | { kind: "sending"; id: symbol; input: BulkCreateInput }
    >({ kind: "idle" });
    let deleteState = $state<
        ResultState | ({ kind: "confirm" | "sending" } & DeleteRequest)
    >({ kind: "idle" });
    const pendingDelete = $derived(
        deleteState.kind === "confirm" || deleteState.kind === "sending"
            ? deleteState
            : undefined,
    );
    const statusMessage = $derived(
        [createState, deleteState]
            .flatMap((state) =>
                state.kind === "success" || state.kind === "failure"
                    ? [state.message]
                    : [],
            )
            .join("。"),
    );

    /** `<input type="date">`の値（yyyy-MM-dd）をAPIの日付形式（yyyy/MM/dd）へ変換する */
    function toApiDate(value: string): string {
        return value.replaceAll("-", "/");
    }

    function findItem(name: string): Item | undefined {
        return items.find((candidate) => candidate.name === name);
    }

    async function submitCreate(event: SubmitEvent) {
        event.preventDefault();
        if (createState.kind === "sending") return;
        const item = findItem(createItemName);
        const quantity = Number(createQuantity);
        if (!item || !Number.isInteger(quantity) || quantity < 0) return;
        const input = {
            startDate: toApiDate(createStart),
            endDate: toApiDate(createEnd),
            timeOfDay: createTime,
            itemId: item.id,
            quantity,
            tzOffsetMinutes: getUtcOffsetMinutes(),
        };
        const fields = {
            start: createStart,
            end: createEnd,
            time: createTime,
            itemName: createItemName,
            quantity: createQuantity,
        };
        createState = { kind: "sending", id: Symbol(), input };
        try {
            const result = await onBulkCreate(input);
            savedCreate = fields;
            createState = {
                kind: "success",
                message: `${result.added}件の記録を追加しました`,
            };
        } catch (error) {
            createState = {
                kind: "failure",
                message: `${error instanceof Error ? error.message : typeof error === "string" ? error : "一括追加に失敗しました"}。反映されたか記録の一覧を確認してから、再操作してください`,
            };
        } finally {
            if (
                deleteState.kind === "success" ||
                deleteState.kind === "failure"
            ) {
                deleteState = { kind: "idle" };
            }
        }
    }

    function submitDelete(event: SubmitEvent) {
        event.preventDefault();
        if (deleteState.kind === "sending") return;
        const item = findItem(deleteItemName);
        if (!item) return;
        deleteState = {
            kind: "confirm",
            itemName: deleteItemName,
            fields: {
                start: deleteStart,
                end: deleteEnd,
                itemName: deleteItemName,
            },
            input: {
                startDate: toApiDate(deleteStart),
                endDate: toApiDate(deleteEnd),
                itemId: item.id,
                tzOffsetMinutes: getUtcOffsetMinutes(),
            },
        };
    }

    async function confirmDelete() {
        if (deleteState.kind !== "confirm") return;
        const request = deleteState;
        deleteState = { ...request, kind: "sending" };
        try {
            const result = await onBulkDelete(request.input);
            savedDelete = request.fields;
            deleteState = {
                kind: "success",
                message: `${result.deleted}件の記録を削除しました`,
            };
        } catch (error) {
            deleteState = {
                kind: "failure",
                message: `${error instanceof Error ? error.message : typeof error === "string" ? error : "一括削除に失敗しました"}。反映されたか記録の一覧を確認してから、再操作してください`,
            };
        } finally {
            if (
                createState.kind === "success" ||
                createState.kind === "failure"
            ) {
                createState = { kind: "idle" };
            }
        }
    }
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
                data-saved-value={savedCreate.start}
                type="date"
                required
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            終了日
            <input
                bind:value={createEnd}
                data-saved-value={savedCreate.end}
                type="date"
                required
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            時刻
            <input
                bind:value={createTime}
                data-saved-value={savedCreate.time}
                type="time"
                required
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            品目
            <input
                bind:value={createItemName}
                data-saved-value={savedCreate.itemName}
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
                data-saved-value={savedCreate.quantity}
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
                disabled={createState.kind === "sending"}
                >{createState.kind === "sending"
                    ? "追加中…"
                    : "一括追加"}</button
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
                data-saved-value={savedDelete.start}
                type="date"
                required
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            終了日
            <input
                bind:value={deleteEnd}
                data-saved-value={savedDelete.end}
                type="date"
                required
                class={inputClass}
            />
        </label>
        <label class="grid gap-1 text-sm text-gray-700 dark:text-gray-200">
            品目
            <input
                bind:value={deleteItemName}
                data-saved-value={savedDelete.itemName}
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
                disabled={deleteState.kind === "sending"}>一括削除</button
            >
        </div>
    </form>

    {#if deleteState.kind === "sending"}<p role="status">削除中…</p>{/if}
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
    open={deleteState.kind === "confirm"}
    title="記録の一括削除"
    message={pendingDelete
        ? `${pendingDelete.input.startDate}から${pendingDelete.input.endDate}までの「${pendingDelete.itemName}」の記録を削除しますか？`
        : ""}
    confirmLabel="削除"
    variant="danger"
    confirmDisabled={deleteState.kind === "sending"}
    onConfirm={confirmDelete}
    onCancel={() => {
        if (deleteState.kind === "confirm") deleteState = { kind: "idle" };
    }}
/>
