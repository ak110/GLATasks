<script lang="ts">
    /**
     * @fileoverview カロリー計算ページ
     */

    import { onMount } from "svelte";
    import {
        createMutation,
        createQuery,
        useQueryClient,
    } from "@tanstack/svelte-query";

    import Header from "$lib/components/layout/Header.svelte";
    import CalorieCsvControls from "$lib/components/calories/CalorieCsvControls.svelte";
    import CalorieItemTable from "$lib/components/calories/CalorieItemTable.svelte";
    import CalorieRecordTable from "$lib/components/calories/CalorieRecordTable.svelte";
    import CalorieSummary from "$lib/components/calories/CalorieSummary.svelte";
    import ConfirmDialog from "$lib/components/dialogs/ConfirmDialog.svelte";
    import type { CalorieItemCsvRow, CalorieRecordCsvRow } from "$lib/schemas";
    import { SSE_EVENTS } from "$lib/sse-events";
    import { subscribeOnMount } from "$lib/sse-subscribe";
    import { trpc, type RouterOutputs } from "$lib/trpc";

    type RecordRow = RouterOutputs["calories"]["records"]["records"][number];

    const queryClient = useQueryClient();
    let windowOffset = $state(0);
    let deleteTarget = $state<RecordRow | undefined>();
    const tzOffsetMinutes = -new Date().getTimezoneOffset();

    const itemsQuery = createQuery<RouterOutputs["calories"]["items"]>(() => ({
        queryKey: ["calories", "items"] as const,
        queryFn: () => trpc.calories.items.query(),
    }));
    const recordsQuery = createQuery<RouterOutputs["calories"]["records"]>(
        () => ({
            queryKey: [
                "calories",
                "records",
                windowOffset,
                tzOffsetMinutes,
            ] as const,
            queryFn: () =>
                trpc.calories.records.query({
                    window_offset: windowOffset,
                    tz_offset_minutes: tzOffsetMinutes,
                }),
        }),
    );
    const allRecordsQuery = createQuery<
        RouterOutputs["calories"]["allRecords"]
    >(() => ({
        queryKey: ["calories", "all-records"] as const,
        queryFn: () => trpc.calories.allRecords.query(),
    }));
    const summaryQuery = createQuery<RouterOutputs["calories"]["summary"]>(
        () => ({
            queryKey: ["calories", "summary"] as const,
            queryFn: () => trpc.calories.summary.query(),
        }),
    );

    const invalidateCalories = () =>
        queryClient.invalidateQueries({ queryKey: ["calories"] });
    const invalidatePreferences = async (): Promise<void> => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["user-preferences"] }),
            queryClient.invalidateQueries({
                queryKey: ["calories", "summary"],
            }),
        ]);
    };

    subscribeOnMount({
        [SSE_EVENTS.caloriesUpdated]: {
            handler: invalidateCalories,
            fallback: invalidateCalories,
        },
        [SSE_EVENTS.usersPreferencesUpdated]: {
            handler: invalidatePreferences,
            fallback: invalidatePreferences,
        },
    });

    onMount(() => {
        const timer = setInterval(() => {
            void queryClient.invalidateQueries({
                queryKey: ["calories", "summary"],
            });
        }, 60_000);
        return () => clearInterval(timer);
    });

    const createItemMutation = createMutation(() => ({
        mutationFn: (input: { name: string; kcal: number; note: string }) =>
            trpc.calories.createItem.mutate(input),
        onSuccess: invalidateCalories,
    }));
    const updateItemMutation = createMutation(() => ({
        mutationFn: (input: {
            itemId: number;
            name: string;
            kcal: number;
            note: string;
        }) => trpc.calories.updateItem.mutate(input),
        onSuccess: invalidateCalories,
    }));
    const createRecordMutation = createMutation(() => ({
        mutationFn: (input: {
            consumed_at: string;
            item_id: number;
            quantity: number;
            tz_offset_minutes: number;
        }) => trpc.calories.createRecord.mutate(input),
        onSuccess: invalidateCalories,
    }));
    const updateRecordMutation = createMutation(() => ({
        mutationFn: (input: {
            recordId: number;
            consumed_at: string;
            item_id: number;
            quantity: number;
            tz_offset_minutes: number;
        }) => trpc.calories.updateRecord.mutate(input),
        onSuccess: invalidateCalories,
    }));
    const deleteRecordMutation = createMutation(() => ({
        mutationFn: (recordId: number) =>
            trpc.calories.deleteRecord.mutate({ recordId }),
        onSuccess: invalidateCalories,
    }));
    const updateGoalMutation = createMutation(() => ({
        mutationFn: (calorie_goal_kcal: number) =>
            trpc.users.updatePreferences.mutate({ calorie_goal_kcal }),
        onSuccess: invalidatePreferences,
    }));
    const importItemsMutation = createMutation(() => ({
        mutationFn: (rows: CalorieItemCsvRow[]) =>
            trpc.calories.importItems.mutate({ rows }),
        onSuccess: invalidateCalories,
    }));
    const importRecordsMutation = createMutation(() => ({
        mutationFn: (rows: CalorieRecordCsvRow[]) =>
            trpc.calories.importRecords.mutate({
                rows,
                tz_offset_minutes: tzOffsetMinutes,
            }),
        onSuccess: invalidateCalories,
    }));

    const items = $derived(itemsQuery.data ?? []);
    const records = $derived(recordsQuery.data?.records ?? []);
    const allRecords = $derived(allRecordsQuery.data ?? []);
    const isLoading = $derived(
        itemsQuery.isLoading ||
            recordsQuery.isLoading ||
            summaryQuery.isLoading,
    );

    async function confirmDelete() {
        if (!deleteTarget) return;
        await deleteRecordMutation.mutateAsync(deleteTarget.id);
        deleteTarget = undefined;
    }
</script>

<Header page="calories" {isLoading} />

<main class="mx-auto px-3 py-4 sm:px-4 sm:py-6 xl:max-w-285">
    <h1 class="mb-5 text-2xl font-bold text-gray-800 dark:text-gray-100">
        カロリー計算
    </h1>
    {#if summaryQuery.data}
        <CalorieSummary
            periods={summaryQuery.data.periods}
            goalKcal={summaryQuery.data.goal_kcal}
            onSaveGoal={(goal) => updateGoalMutation.mutateAsync(goal)}
        />
    {/if}
    <div class="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <CalorieRecordTable
            {items}
            {records}
            {windowOffset}
            onWindowChange={(offset) => (windowOffset = offset)}
            onCreate={(input) => createRecordMutation.mutateAsync(input)}
            onUpdate={(input) => updateRecordMutation.mutateAsync(input)}
            onDelete={(record) => (deleteTarget = record)}
        />
        <CalorieItemTable
            {items}
            onCreate={(input) => createItemMutation.mutateAsync(input)}
            onUpdate={(input) => updateItemMutation.mutateAsync(input)}
        />
    </div>
    <div class="mt-5">
        <CalorieCsvControls
            {items}
            {allRecords}
            onImportItems={(rows) => importItemsMutation.mutateAsync(rows)}
            onImportRecords={(rows) => importRecordsMutation.mutateAsync(rows)}
        />
    </div>
</main>

<ConfirmDialog
    open={deleteTarget !== undefined}
    title="記録の削除"
    message="この記録を削除しますか？"
    confirmLabel="削除"
    variant="danger"
    onConfirm={confirmDelete}
    onCancel={() => (deleteTarget = undefined)}
/>
