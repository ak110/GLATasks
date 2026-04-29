<script lang="ts">
    /**
     * @fileoverview タイマーページ
     */

    import {
        createQuery,
        createMutation,
        useQueryClient,
    } from "@tanstack/svelte-query";
    import { trpc, type RouterOutputs } from "$lib/trpc";
    import { createDragReorder } from "$lib/dnd-reorder.svelte";
    import {
        TIMER_DEFAULT_BASE_MINUTES,
        TIMER_DEFAULT_ADJUST_MINUTES,
        TIMER_DEFAULT_KEEP_RINGING,
    } from "$lib/schemas";
    import type { TimerMode, UserPreferences } from "$lib/schemas";
    import { playStartBeep } from "$lib/beep";
    import { setServerOffset } from "$lib/sse-client";
    import { SSE_EVENTS } from "$lib/sse-events";
    import { subscribeOnMount } from "$lib/sse-subscribe";
    import type { TimerInfo, TimersResult } from "$lib/types";
    import Header from "$lib/components/layout/Header.svelte";
    import TimerCard from "$lib/components/timers/TimerCard.svelte";
    import TimerCreateDialog from "$lib/components/timers/TimerCreateDialog.svelte";

    const queryClient = useQueryClient();

    // ダイアログ状態
    type DialogState = {
        open: boolean;
        mode: "create" | "edit";
        ephemeral: boolean;
        timerId: number;
        name: string;
        timerMode: TimerMode;
        baseSeconds: number;
        targetMinutes: number | null;
        adjustMinutes: number;
        keepRinging: boolean;
    };
    let dialog = $state<DialogState>({
        open: false,
        mode: "create",
        ephemeral: false,
        timerId: 0,
        name: "",
        timerMode: "countdown",
        baseSeconds: TIMER_DEFAULT_BASE_MINUTES * 60,
        targetMinutes: null,
        adjustMinutes: TIMER_DEFAULT_ADJUST_MINUTES,
        keepRinging: TIMER_DEFAULT_KEEP_RINGING,
    });

    // 利用者既定値（新規タイマー作成時の初期値ソース）
    const preferencesQuery = createQuery<
        RouterOutputs["users"]["getPreferences"]
    >(() => ({
        queryKey: ["user-preferences"] as const,
        queryFn: () => trpc.users.getPreferences.query(),
    }));

    const updatePreferencesMutation = createMutation(() => ({
        mutationFn: (input: UserPreferences) =>
            trpc.users.updatePreferences.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ["user-preferences"] }),
    }));

    // タイマー一覧取得（SSE でリアルタイム同期）
    const timersQuery = createQuery<RouterOutputs["timers"]["list"]>(() => ({
        queryKey: ["timers"] as const,
        queryFn: async (): Promise<RouterOutputs["timers"]["list"]> => {
            // RTT/2 補正付きオフセット計算
            const t0 = Date.now();
            const result = await trpc.timers.list.query();
            const t1 = Date.now();
            const serverMs = new Date(result.server_time).getTime();
            setServerOffset(serverMs - (t0 + t1) / 2);
            return result;
        },
    }));

    // SSE: サーバーからの通知でクエリを再取得
    subscribeOnMount({
        [SSE_EVENTS.timersUpdated]: () => {
            queryClient.invalidateQueries({ queryKey: ["timers"] });
        },
        [SSE_EVENTS.usersPreferencesUpdated]: () => {
            queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
        },
    });

    /** アラームモードのタイマーかどうかで tz_offset_minutes を付加するヘルパー */
    function getTzOffset(timerId: number): number | undefined {
        const timer = timersList.find((t) => t.id === timerId);
        return timer?.mode === "alarm"
            ? -new Date().getTimezoneOffset()
            : undefined;
    }

    // ミューテーション群
    const createTimerMutation = createMutation(() => ({
        mutationFn: (input: {
            name: string;
            mode: TimerMode;
            base_seconds: number;
            target_minutes?: number;
            tz_offset_minutes?: number;
            adjust_minutes: number;
            ephemeral: boolean;
            keep_ringing: boolean;
        }) => trpc.timers.create.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ["timers"] }),
    }));

    const updateTimerMutation = createMutation(() => ({
        mutationFn: (input: {
            timerId: number;
            name?: string;
            mode?: TimerMode;
            base_seconds?: number;
            target_minutes?: number;
            tz_offset_minutes?: number;
            adjust_minutes?: number;
            keep_ringing?: boolean;
        }) => trpc.timers.update.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ["timers"] }),
    }));

    const deleteTimerMutation = createMutation(() => ({
        mutationFn: (timerId: number) => trpc.timers.delete.mutate({ timerId }),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ["timers"] }),
    }));

    const startTimerMutation = createMutation(() => ({
        mutationFn: (input: { timerId: number; tz_offset_minutes?: number }) =>
            trpc.timers.start.mutate(input),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["timers"] });
            // タブミュート対策: スタート時にビープ音で気付かせる
            playStartBeep();
            // タイマー完了通知のためにブラウザ通知の許可をリクエスト
            if (
                typeof Notification !== "undefined" &&
                Notification.permission === "default"
            ) {
                Notification.requestPermission();
            }
        },
    }));

    const pauseTimerMutation = createMutation(() => ({
        mutationFn: (timerId: number) => trpc.timers.pause.mutate({ timerId }),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ["timers"] }),
    }));

    const resetTimerMutation = createMutation(() => ({
        mutationFn: (input: { timerId: number; tz_offset_minutes?: number }) =>
            trpc.timers.reset.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ["timers"] }),
    }));

    const adjustTimerMutation = createMutation(() => ({
        mutationFn: (input: { timerId: number; minutes: number }) =>
            trpc.timers.adjust.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ["timers"] }),
    }));

    const setTimerTimeMutation = createMutation(() => ({
        mutationFn: (input: {
            timerId: number;
            seconds: number;
            target_minutes?: number;
            tz_offset_minutes?: number;
        }) => trpc.timers.setTime.mutate(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ["timers"] }),
    }));

    const reorderTimersMutation = createMutation(() => ({
        mutationFn: (input: { timerIds: number[] }) =>
            trpc.timers.reorder.mutate(input),
        onSettled: () =>
            queryClient.invalidateQueries({ queryKey: ["timers"] }),
    }));

    // D&D 状態管理（createDragReorder は派生状態 timersList を参照するためゲッター関数で渡す）
    const dnd = createDragReorder(() => timersList, handleReorderTimers);

    /** タイマーの並び替え（楽観的更新 + API呼出） */
    function handleReorderTimers(timerIds: number[]) {
        // 楽観的更新: キャッシュ内のタイマー配列を即座に並び替え
        queryClient.setQueryData(
            ["timers"],
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

    // 派生状態
    const timersList = $derived(timersQuery.data?.timers ?? []);
    const isLoading = $derived(timersQuery.isLoading);

    // ダイアログ操作
    function openCreateDialog(ephemeral: boolean = false) {
        const prefs = preferencesQuery.data ?? {};
        dialog = {
            open: true,
            mode: "create",
            ephemeral,
            timerId: 0,
            name: "",
            timerMode: prefs.mode ?? "countdown",
            baseSeconds: prefs.base_seconds ?? TIMER_DEFAULT_BASE_MINUTES * 60,
            targetMinutes: null,
            adjustMinutes: prefs.adjust_minutes ?? TIMER_DEFAULT_ADJUST_MINUTES,
            keepRinging: prefs.keep_ringing ?? TIMER_DEFAULT_KEEP_RINGING,
        };
    }

    function openEditDialog(timer: TimerInfo) {
        dialog = {
            open: true,
            mode: "edit",
            ephemeral: timer.ephemeral,
            timerId: timer.id,
            name: timer.name,
            timerMode: timer.mode,
            baseSeconds: timer.base_seconds,
            targetMinutes: timer.target_minutes,
            adjustMinutes: timer.adjust_minutes,
            keepRinging: timer.keep_ringing,
        };
    }

    function handleSaveAsDefault(preferences: UserPreferences) {
        updatePreferencesMutation.mutate(preferences);
    }

    async function handleDialogSubmit(data: {
        name: string;
        mode: TimerMode;
        base_seconds: number;
        target_minutes: number | null;
        tz_offset_minutes: number | null;
        adjust_minutes: number;
        keep_ringing: boolean;
    }) {
        try {
            if (dialog.mode === "create") {
                await createTimerMutation.mutateAsync({
                    name: data.name,
                    mode: data.mode,
                    base_seconds: data.base_seconds,
                    target_minutes: data.target_minutes ?? undefined,
                    tz_offset_minutes: data.tz_offset_minutes ?? undefined,
                    adjust_minutes: data.adjust_minutes,
                    ephemeral: dialog.ephemeral,
                    keep_ringing: data.keep_ringing,
                });
            } else {
                await updateTimerMutation.mutateAsync({
                    timerId: dialog.timerId,
                    name: data.name,
                    mode: data.mode,
                    base_seconds: data.base_seconds,
                    target_minutes: data.target_minutes ?? undefined,
                    tz_offset_minutes: data.tz_offset_minutes ?? undefined,
                    adjust_minutes: data.adjust_minutes,
                    keep_ringing: data.keep_ringing,
                });
            }
            dialog.open = false;
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    async function handleDelete(timer: TimerInfo, skipConfirm: boolean) {
        if (!skipConfirm && !globalThis.confirm("このタイマーを削除しますか？"))
            return;
        try {
            await deleteTimerMutation.mutateAsync(timer.id);
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }
</script>

<Header page="timers" {isLoading} />

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

    {#if timersList.length === 0 && !isLoading}
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
                            tz_offset_minutes: getTzOffset(id),
                        })}
                    onPause={(id) => pauseTimerMutation.mutate(id)}
                    onReset={(id) =>
                        resetTimerMutation.mutate({
                            timerId: id,
                            tz_offset_minutes: getTzOffset(id),
                        })}
                    onAdjust={(id, minutes) =>
                        adjustTimerMutation.mutate({ timerId: id, minutes })}
                    onSetTime={(id, seconds, targetMinutes, tzOffsetMinutes) =>
                        setTimerTimeMutation.mutate({
                            timerId: id,
                            seconds,
                            target_minutes: targetMinutes,
                            tz_offset_minutes: tzOffsetMinutes,
                        })}
                    onEdit={openEditDialog}
                    onDelete={handleDelete}
                    isDragging={dnd.draggedId === timer.id}
                    dropIndicator={dnd.dropTargetId === timer.id
                        ? dnd.dropPosition
                        : null}
                    onDragStart={dnd.handleDragStart}
                    onDragOver={dnd.handleDragOver}
                    onDrop={dnd.handleDrop}
                    onDragEnd={dnd.resetDragState}
                />
            {/each}
        </div>
    {/if}
</div>

<TimerCreateDialog
    open={dialog.open}
    mode={dialog.mode}
    ephemeral={dialog.ephemeral}
    name={dialog.name}
    timerMode={dialog.timerMode}
    baseSeconds={dialog.baseSeconds}
    targetMinutes={dialog.targetMinutes}
    adjustMinutes={dialog.adjustMinutes}
    keepRinging={dialog.keepRinging}
    onSubmit={handleDialogSubmit}
    onClose={() => (dialog.open = false)}
    onSaveAsDefault={dialog.mode === "create" ? handleSaveAsDefault : undefined}
/>
