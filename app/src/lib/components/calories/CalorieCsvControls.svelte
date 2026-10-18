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
    let pendingRecords = $state<
        RouterInputs["calories"]["importRecords"]["rows"] | undefined
    >();
    let resultMessage = $state("");

    function showError(error: unknown) {
        resultMessage =
            error instanceof Error
                ? error.message
                : "CSVを解析できません。CSVファイルを選び直して取り込み直してください";
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
        if (!file) return;
        resultMessage = "";
        try {
            const result = await onImportItems(
                parseCalorieItemsCsv(await file.text()),
            );
            resultMessage = `品目を${result.added}件追加し、${result.updated}件更新しました。`;
        } catch (error) {
            showError(error);
        } finally {
            input.value = "";
        }
    }

    async function chooseRecords(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        pendingRecords = undefined;
        resultMessage = "";
        try {
            pendingRecords = parseCalorieRecordsCsv(await file.text());
        } catch (error) {
            showError(error);
        } finally {
            input.value = "";
        }
    }

    async function confirmRecords() {
        if (!pendingRecords) return;
        const result = await onImportRecords(pendingRecords);
        pendingRecords = undefined;
        resultMessage = `記録を${result.added}件追加しました。`;
    }
    async function exportRecords() {
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
            resultMessage =
                error instanceof Error
                    ? error.message
                    : "CSVの取得に失敗しました。時間をおいてからエクスポートをやり直してください";
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
                accept=".csv,text/csv"
                onchange={chooseRecords}
                class="sr-only"
                data-testid="calorie-records-import"
            />
        </label>
    </div>
    {#if resultMessage}<p
            class="mt-3 text-sm text-gray-700 dark:text-gray-200"
            role="status"
        >
            {resultMessage}
        </p>{/if}
</section>

<ConfirmDialog
    open={pendingRecords !== undefined}
    title="記録CSVのインポート"
    message="記録CSVは既存の記録へ追記されます。同じCSVを再度取り込むと記録が重複します。取り込みますか？"
    confirmLabel="取り込む"
    onConfirm={confirmRecords}
    onCancel={() => (pendingRecords = undefined)}
/>
