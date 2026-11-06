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
    let importState = $state<ImportState>({ kind: "idle" });
    let exportState = $state<
        { kind: "idle" | "sending" } | { kind: "failure"; message: string }
    >({ kind: "idle" });
    const busy = $derived(
        importState.kind === "sendingItems" ||
            importState.kind === "sendingRecords",
    );
    const resultMessage = $derived(
        importState.kind === "success" || importState.kind === "failure"
            ? importState.message
            : "",
    );

    function showError(error: unknown, sent = false) {
        importState = {
            kind: "failure",
            message: `${error instanceof Error ? error.message : typeof error === "string" ? error : "CSVの処理に失敗しました"}。${
                sent
                    ? "反映されたか記録・品目の一覧を確認してから、再操作してください"
                    : "CSVファイルを確認し、選び直してください"
            }`,
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
        importState = { kind: "reading", id };
        let rows: RouterInputs["calories"]["importItems"]["rows"];
        try {
            rows = parseCalorieItemsCsv(await file.text());
        } catch (error) {
            if (importState.kind === "reading" && importState.id === id)
                showError(error);
            return;
        } finally {
            input.value = "";
        }
        if (importState.kind !== "reading" || importState.id !== id) return;
        importState = { kind: "sendingItems", id };
        try {
            const result = await onImportItems(rows);
            importState = {
                kind: "success",
                message: `品目を${result.added}件追加し、${result.updated}件更新しました。`,
            };
        } catch (error) {
            showError(error, true);
        }
    }

    async function chooseRecords(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file || busy) return;
        const id = Symbol();
        importState = { kind: "reading", id };
        try {
            const rows = parseCalorieRecordsCsv(await file.text());
            if (importState.kind === "reading" && importState.id === id)
                importState = { kind: "confirm", id, rows };
        } catch (error) {
            if (importState.kind === "reading" && importState.id === id)
                showError(error);
        } finally {
            input.value = "";
        }
    }

    async function confirmRecords() {
        if (importState.kind !== "confirm") return;
        const request = { ...importState, kind: "sendingRecords" as const };
        importState = request;
        try {
            const result = await onImportRecords(request.rows);
            importState = {
                kind: "success",
                message: `記録を${result.added}件追加しました。`,
            };
        } catch (error) {
            showError(error, true);
        }
    }
    async function exportRecords() {
        if (exportState.kind === "sending") return;
        exportState = { kind: "sending" };
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
            exportState = { kind: "idle" };
        } catch (error) {
            exportState = {
                kind: "failure",
                message: `${error instanceof Error ? error.message : typeof error === "string" ? error : "CSVの取得に失敗しました"}。時間をおいて再取得するには、記録をエクスポートしてください`,
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
        <button
            type="button"
            onclick={exportRecords}
            disabled={exportState.kind === "sending"}
            class="{grayButtonClass} disabled:cursor-not-allowed disabled:opacity-50"
            >{exportState.kind === "sending"
                ? "記録を取得中…"
                : "記録をエクスポート"}</button
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
    {#if exportState.kind === "failure"}<p
            class="mt-3 text-sm text-gray-700 dark:text-gray-200"
            role="status"
        >
            {exportState.message}
        </p>{/if}
    {#if resultMessage}<p
            class="mt-3 text-sm text-gray-700 dark:text-gray-200"
            role="status"
        >
            {resultMessage}
        </p>{/if}
</section>

<ConfirmDialog
    open={importState.kind === "confirm"}
    confirmDisabled={busy}
    title="記録CSVのインポート"
    message="記録CSVは既存の記録へ追記されます。同じCSVを再度取り込むと記録が重複します。取り込みますか？"
    confirmLabel="取り込む"
    onConfirm={confirmRecords}
    onCancel={() => {
        if (importState.kind === "confirm") importState = { kind: "idle" };
    }}
/>
