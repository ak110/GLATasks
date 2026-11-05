<script lang="ts">
    import type { RouterInputs, RouterOutputs } from "#lib/client/trpc.ts";
    import { grayButtonClass } from "#lib/components/ui/styles.ts";
    import { formatLocalMinute } from "#lib/date-time.ts";
    import {
        exportCalorieItemsCsv,
        exportCalorieRecordsCsv,
        parseCalorieItemsCsv,
        parseCalorieRecordsCsv,
    } from "#lib/calorie-csv.ts";
    import ConfirmDialog from "#lib/components/dialogs/ConfirmDialog.svelte";

    type Item = RouterOutputs["calories"]["items"][number];
    type RecordRow = RouterOutputs["calories"]["allRecords"][number];
    interface Props {
        items: Item[];
        onExportRecords: () => Promise<RecordRow[]>;
        onImportItems: (
            rows: RouterInputs["calories"]["importItems"]["rows"],
        ) => Promise<
            Pick<RouterOutputs["calories"]["importItems"], "added" | "updated">
        >;
        onImportRecords: (
            rows: RouterInputs["calories"]["importRecords"]["rows"],
        ) => Promise<Pick<RouterOutputs["calories"]["importRecords"], "added">>;
    }

    let { items, onExportRecords, onImportItems, onImportRecords }: Props =
        $props();
    type Rows = RouterInputs["calories"]["importRecords"]["rows"];
    type ImportState =
        | { kind: "idle" }
        | { kind: "reading"; id: symbol }
        | { kind: "confirm"; id: symbol; rows: Rows }
        | { kind: "sendingItems"; id: symbol }
        | { kind: "sendingRecords"; id: symbol; rows: Rows }
        | { kind: "success" | "failure"; message: string };
    let state = $state<ImportState>({ kind: "idle" });
    const busy = $derived(
        state.kind === "sendingItems" || state.kind === "sendingRecords",
    );
    const resultMessage = $derived(
        state.kind === "success" || state.kind === "failure"
            ? state.message
            : "",
    );

    function showError(error: unknown) {
        state = {
            kind: "failure",
            message:
                error instanceof Error
                    ? error.message
                    : "CSVを解析できません。CSVファイルを選び直して取り込み直してください",
        };
    }

    function download(csv: string, filename: string) {
        const url = URL.createObjectURL(
            new Blob([csv], { type: "text/csv;charset=utf-8" }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    async function importItems(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file || busy) return;
        const id = Symbol();
        state = { kind: "sendingItems", id };
        try {
            const result = await onImportItems(
                parseCalorieItemsCsv(await file.text()),
            );
            state = {
                kind: "success",
                message: `品目を${result.added}件追加し、${result.updated}件更新しました。`,
            };
        } catch (error) {
            showError(error);
        } finally {
            input.value = "";
        }
    }

    async function chooseRecords(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file || busy) return;
        const id = Symbol();
        state = { kind: "reading", id };
        try {
            const rows = parseCalorieRecordsCsv(await file.text());
            if (state.kind === "reading" && state.id === id)
                state = { kind: "confirm", id, rows };
        } catch (error) {
            if (state.kind === "reading" && state.id === id) showError(error);
        } finally {
            input.value = "";
        }
    }

    async function confirmRecords() {
        if (state.kind !== "confirm") return;
        const request = { ...state, kind: "sendingRecords" as const };
        state = request;
        try {
            const result = await onImportRecords(request.rows);
            state = {
                kind: "success",
                message: `記録を${result.added}件追加しました。`,
            };
        } catch (error) {
            showError(error);
        }
    }
    async function exportRecords() {
        const startedState = state;
        try {
            const records = await onExportRecords();
            download(
                exportCalorieRecordsCsv(
                    records.map((record) => ({
                        consumed_at: formatLocalMinute(record.consumedAt),
                        item_name: record.itemName,
                        quantity: record.quantity,
                        temporary: record.temporary,
                    })),
                ),
                "カロリー記録.csv",
            );
        } catch (error) {
            if (state === startedState)
                state = {
                    kind: "failure",
                    message:
                        error instanceof Error
                            ? error.message
                            : "CSVの取得に失敗しました。時間をおいてからエクスポートをやり直してください",
                };
        }
    }
</script>

<section
    class="rounded border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
    aria-labelledby="calorie-csv-title"
>
    <h2
        id="calorie-csv-title"
        class="mb-2 text-lg font-bold text-gray-800 dark:text-gray-100"
    >
        CSV
    </h2>
    <p class="mb-3 text-sm text-gray-600 dark:text-gray-300">
        移行時は品目CSVを先に取り込み、その後に記録CSVを取り込んでください。
    </p>
    <div class="flex flex-wrap gap-2">
        <button
            type="button"
            onclick={() =>
                download(exportCalorieItemsCsv(items), "カロリー品目.csv")}
            class={grayButtonClass}>品目をエクスポート</button
        >
        <button type="button" onclick={exportRecords} class={grayButtonClass}
            >記録をエクスポート</button
        >
        <label class={grayButtonClass}>
            品目をインポート
            <input
                type="file"
                disabled={busy}
                accept=".csv,text/csv"
                onchange={importItems}
                class="sr-only"
                data-testid="calorie-items-import"
            />
        </label>
        <label class={grayButtonClass}>
            記録をインポート
            <input
                type="file"
                disabled={busy}
                accept=".csv,text/csv"
                onchange={chooseRecords}
                class="sr-only"
                data-testid="calorie-records-import"
            />
        </label>
    </div>
    {#if busy}<p role="status">取り込み中…</p>{/if}
    {#if resultMessage}<p
            class="mt-3 text-sm text-gray-700 dark:text-gray-200"
            role="status"
        >
            {resultMessage}
        </p>{/if}
</section>

<ConfirmDialog
    open={state.kind === "confirm"}
    confirmDisabled={busy}
    title="記録CSVのインポート"
    message="記録CSVは既存の記録へ追記されます。同じCSVを再度取り込むと記録が重複します。取り込みますか？"
    confirmLabel="取り込む"
    onConfirm={confirmRecords}
    onCancel={() => {
        if (state.kind === "confirm") state = { kind: "idle" };
    }}
/>
