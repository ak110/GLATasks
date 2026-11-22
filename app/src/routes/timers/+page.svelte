<script lang="ts">
    import { subscribeQueryEvents } from "#lib/client/query-sync.ts";
    import { onMount } from "svelte";
    import {
        timersOptions,
        preferencesOptions,
        queryKeys,
    } from "#lib/client/query-options.ts";
    import { getUtcOffsetMinutes } from "#lib/date-time.ts";

    import {
        createQuery,
        createMutation,
        useQueryClient,
        hashKey,
    } from "@tanstack/svelte-query";
    import { trpc, type RouterInputs } from "#lib/client/trpc.ts";
    import { createDragReorder } from "#lib/actions/dnd-reorder.svelte.ts";
    import {
        TIMER_DEFAULT_BASE_MINUTES,
        TIMER_DEFAULT_ADJUST_MINUTES,
        TIMER_DEFAULT_RING_SECONDS,
    } from "#lib/schemas.ts";
    import type { TimerFormSubmission } from "#lib/client/timers/timer-form-types.ts";
    import { playStartBeep } from "#lib/client/timers/beep.ts";
    import { SSE_EVENTS } from "#lib/sse-events.ts";
    import type { TimerInfo, TimersResult } from "#lib/types.ts";
    import Header from "#lib/components/layout/Header.svelte";
    import { grayButtonClass } from "#lib/components/ui/styles.ts";
    import PageScrollArea from "#lib/components/layout/PageScrollArea.svelte";
    import TimerCard from "#lib/components/timers/TimerCard.svelte";
    import TimerEditDialog from "#lib/components/timers/TimerEditDialog.svelte";
    import ConfirmDialog from "#lib/components/dialogs/ConfirmDialog.svelte";

    const queryClient = useQueryClient();

    type DialogState = {
        session: number;
        open: boolean;
        mode: "create" | "edit";
        ephemeral: boolean;
        timerId: number;
        name: string;
        timerMode: TimerFormSubmission["mode"];
        baseSeconds: number;
        targetMinutes: number | null;
        adjustMinutes: number;
        ringSeconds: number;
    };
    let dialog = $state<DialogState>({
        session: 0,
        open: false,
        mode: "create",
        ephemeral: false,
        timerId: 0,
        name: "",
        timerMode: "countdown",
        baseSeconds: TIMER_DEFAULT_BASE_MINUTES * 60,
        targetMinutes: null,
        adjustMinutes: TIMER_DEFAULT_ADJUST_MINUTES,
        ringSeconds: TIMER_DEFAULT_RING_SECONDS,
    });
    let nextSession = 0;
    let inputSnapshot = "";
    let saving = $state.raw<{ session: number; snapshot: string }>();

    type ConfirmDeleteTimerDialog =
        { open: false; timer?: TimerInfo } | { open: true; timer: TimerInfo };
    let confirmDeleteTimerDialog = $state<ConfirmDeleteTimerDialog>({
        open: false,
    });

    const preferencesQuery = createQuery(() => preferencesOptions());

    const updatePreferencesMutation = createMutation(() => ({
        mutationFn: (input: RouterInputs["users"]["updatePreferences"]) =>
            trpc.users.updatePreferences.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.preferences }),
    }));

    const timersQuery = createQuery(() => ({
        ...timersOptions(),
    }));

    subscribeQueryEvents(queryClient, [
        SSE_EVENTS.timersUpdated,
        SSE_EVENTS.usersPreferencesUpdated,
    ]);

    function getTzOffset(timerId: number): number | undefined {
        const timer = timersList.find((t) => t.id === timerId);
        return timer?.mode === "alarm" ? getUtcOffsetMinutes() : undefined;
    }

    const createTimerMutation = createMutation(() => ({
        mutationFn: (input: RouterInputs["timers"]["create"]) =>
            trpc.timers.create.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.timers }),
    }));

    const updateTimerMutation = createMutation(() => ({
        mutationFn: (input: RouterInputs["timers"]["update"]) =>
            trpc.timers.update.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.timers }),
    }));

    const deleteTimerMutation = createMutation(() => ({
        mutationFn: (timerId: RouterInputs["timers"]["delete"]["timerId"]) =>
            trpc.timers.delete.mutate({ timerId }),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.timers }),
    }));

    const startTimerMutation = createMutation(() => ({
        mutationFn: (input: RouterInputs["timers"]["start"]) =>
            trpc.timers.start.mutate(input),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.timers });
            playStartBeep();
            if (
                typeof Notification !== "undefined" &&
                Notification.permission === "default"
            ) {
                Notification.requestPermission();
            }
        },
    }));

    const pauseTimerMutation = createMutation(() => ({
        mutationFn: (timerId: RouterInputs["timers"]["pause"]["timerId"]) =>
            trpc.timers.pause.mutate({ timerId }),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.timers }),
    }));

    const resetTimerMutation = createMutation(() => ({
        mutationFn: (input: RouterInputs["timers"]["reset"]) =>
            trpc.timers.reset.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.timers }),
    }));

    const adjustTimerMutation = createMutation(() => ({
        mutationFn: (input: RouterInputs["timers"]["adjust"]) =>
            trpc.timers.adjust.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.timers }),
    }));

    const setTimerTimeMutation = createMutation(() => ({
        mutationFn: (input: RouterInputs["timers"]["setTime"]) =>
            trpc.timers.setTime.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.timers }),
    }));

    const reorderTimersMutation = createMutation(() => ({
        mutationFn: (input: RouterInputs["timers"]["reorder"]) =>
            trpc.timers.reorder.mutate(input),
        onSettled: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.timers }),
    }));

    const dnd = createDragReorder(() => timersList, handleReorderTimers);
    onMount(() => () => dnd.dispose());

    function handleReorderTimers(timerIds: number[]) {
        queryClient.setQueryData(
            queryKeys.timers,
            (old: TimersResult | undefined) => {
                if (!old) return old;
                const timerMap = new Map(old.timers.map((t) => [t.id, t]));
                const reordered = timerIds
                    .map((id) => timerMap.get(id))
                    .filter((t): t is TimerInfo => t !== undefined);
                return { ...old, timers: reordered };
            },
        );
        reorderTimersMutation.mutate({ timerIds });
    }

    const timersList = $derived(timersQuery.data?.timers ?? []);
    const isLoading = $derived(timersQuery.isLoading);

    function openCreateDialog(ephemeral: boolean = false) {
        const prefs = preferencesQuery.data ?? {};
        dialog = {
            session: ++nextSession,
            open: true,
            mode: "create",
            ephemeral,
            timerId: 0,
            name: "",
            timerMode: prefs.mode ?? "countdown",
            baseSeconds: prefs.baseSeconds ?? TIMER_DEFAULT_BASE_MINUTES * 60,
            targetMinutes: null,
            adjustMinutes: prefs.adjustMinutes ?? TIMER_DEFAULT_ADJUST_MINUTES,
            ringSeconds: prefs.ringSeconds ?? TIMER_DEFAULT_RING_SECONDS,
        };
    }

    function openEditDialog(timer: TimerInfo) {
        dialog = {
            session: ++nextSession,
            open: true,
            mode: "edit",
            ephemeral: timer.ephemeral,
            timerId: timer.id,
            name: timer.name,
            timerMode: timer.mode,
            baseSeconds: timer.baseSeconds,
            targetMinutes: timer.targetMinutes,
            adjustMinutes: timer.adjustMinutes,
            ringSeconds: timer.ringSeconds,
        };
    }

    function handleSaveAsDefault(
        preferences: RouterInputs["users"]["updatePreferences"],
    ) {
        updatePreferencesMutation.mutate(preferences);
    }

    async function handleDialogSubmit(data: TimerFormSubmission) {
        if (saving?.session === dialog.session) return;
        const request = {
            session: dialog.session,
            snapshot: JSON.stringify(data),
        };
        const target = { ...dialog };
        saving = request;
        inputSnapshot = request.snapshot;
        try {
            if (target.mode === "create") {
                await createTimerMutation.mutateAsync({
                    name: data.name,
                    mode: data.mode,
                    baseSeconds: data.baseSeconds,
                    targetMinutes: data.targetMinutes ?? undefined,
                    tzOffsetMinutes: data.tzOffsetMinutes ?? undefined,
                    adjustMinutes: data.adjustMinutes,
                    ephemeral: target.ephemeral,
                    ringSeconds: data.ringSeconds,
                });
            } else {
                await updateTimerMutation.mutateAsync({
                    timerId: target.timerId,
                    name: data.name,
                    mode: data.mode,
                    baseSeconds: data.baseSeconds,
                    targetMinutes: data.targetMinutes ?? undefined,
                    tzOffsetMinutes: data.tzOffsetMinutes ?? undefined,
                    adjustMinutes: data.adjustMinutes,
                    ringSeconds: data.ringSeconds,
                });
            }
            if (
                dialog.session === request.session &&
                inputSnapshot === request.snapshot
            )
                dialog.open = false;
        } catch {
        } finally {
            if (saving === request) saving = undefined;
        }
    }

    function handleDelete(timer: TimerInfo, skipConfirm: boolean) {
        if (skipConfirm) {
            submitDeleteTimer(timer.id);
            return;
        }
        confirmDeleteTimerDialog = { open: true, timer };
    }

    async function submitDeleteTimer(timerId: number) {
        confirmDeleteTimerDialog.open = false;
        try {
            await deleteTimerMutation.mutateAsync(timerId);
        } catch {}
    }
</script>

<Header page="timers" {isLoading} />

<PageScrollArea>
    <div class="mx-auto max-w-4xl px-3 py-4 sm:px-4 sm:py-6">
        <div class="mb-6 flex items-center justify-between">
            <h1 class="text-xl font-bold text-gray-800 dark:text-gray-100">
                タイマー
            </h1>
            <div class="flex gap-2">
                <button
                    onclick={() => openCreateDialog(false)}
                    class="cursor-pointer rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                    data-testid="timer-add-btn"
                >
                    + 追加
                </button>
                <button
                    onclick={() => openCreateDialog(true)}
                    class="cursor-pointer rounded border border-blue-600 bg-white px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:bg-gray-800 dark:text-blue-400 dark:hover:bg-blue-900/30"
                    title="満了後に確認なしで削除できる使い切りタイマー"
                    data-testid="timer-add-ephemeral-btn"
                >
                    + 一時追加
                </button>
            </div>
        </div>

        {#if timersQuery.isError}
            <div
                role="alert"
                data-query-error-key={hashKey(queryKeys.timers)}
                class="py-8 text-center"
            >
                <p class="mb-4 text-red-600 dark:text-red-400">
                    タイマーを取得できませんでした
                </p>
                <button
                    class="{grayButtonClass} disabled:cursor-not-allowed disabled:opacity-50"
                    onclick={() => timersQuery.refetch()}
                    disabled={timersQuery.isFetching}>再試行</button
                >
            </div>
        {:else if timersList.length === 0 && !isLoading}
            <div class="flex flex-col items-center justify-center py-16">
                <p class="mb-4 text-gray-400 dark:text-gray-500">
                    タイマーがありません
                </p>
            </div>
        {:else}
            <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {#each timersList as timer (timer.id)}
                    <TimerCard
                        {timer}
                        onStart={(id) =>
                            startTimerMutation.mutate({
                                timerId: id,
                                tzOffsetMinutes: getTzOffset(id),
                            })}
                        onPause={(id) => pauseTimerMutation.mutate(id)}
                        onReset={(id) =>
                            resetTimerMutation.mutate({
                                timerId: id,
                                tzOffsetMinutes: getTzOffset(id),
                            })}
                        onAdjust={(id, minutes) =>
                            adjustTimerMutation.mutate({
                                timerId: id,
                                minutes,
                            })}
                        onSetTime={(
                            id,
                            seconds,
                            targetMinutes,
                            tzOffsetMinutes,
                        ) =>
                            setTimerTimeMutation.mutate({
                                timerId: id,
                                seconds,
                                targetMinutes: targetMinutes,
                                tzOffsetMinutes: tzOffsetMinutes,
                            })}
                        onEdit={openEditDialog}
                        onDelete={handleDelete}
                        isDragging={dnd.isActive && dnd.draggedId === timer.id}
                        dropIndicator={dnd.isActive &&
                        dnd.dropTargetId === timer.id
                            ? dnd.dropPosition
                            : null}
                        onDragStart={dnd.handleDragStart}
                    />
                {/each}
            </div>
        {/if}
    </div>
</PageScrollArea>

<TimerEditDialog
    session={dialog.session}
    open={dialog.open}
    mode={dialog.mode}
    ephemeral={dialog.ephemeral}
    name={dialog.name}
    timerMode={dialog.timerMode}
    baseSeconds={dialog.baseSeconds}
    targetMinutes={dialog.targetMinutes}
    adjustMinutes={dialog.adjustMinutes}
    ringSeconds={dialog.ringSeconds}
    onSubmit={handleDialogSubmit}
    submitting={saving?.session === dialog.session}
    onInputChange={(data) => {
        inputSnapshot = JSON.stringify(data) ?? "";
    }}
    onClose={() => (dialog.open = false)}
    onSaveAsDefault={dialog.mode === "create" ? handleSaveAsDefault : undefined}
/>

<ConfirmDialog
    open={confirmDeleteTimerDialog.open}
    title="タイマーの削除"
    message="このタイマーを削除しますか？"
    confirmLabel="削除"
    variant="danger"
    onConfirm={() => {
        if (!confirmDeleteTimerDialog.open || !confirmDeleteTimerDialog.timer)
            return;
        submitDeleteTimer(confirmDeleteTimerDialog.timer.id);
    }}
    onCancel={() => (confirmDeleteTimerDialog.open = false)}
/>
