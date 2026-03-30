<script lang="ts">
    /**
     * @fileoverview タイマーページ
     */

    import {
        createQuery,
        createMutation,
        useQueryClient,
    } from "@tanstack/svelte-query";
    import { onMount } from "svelte";
    import { trpc } from "$lib/trpc";
    import {
        TIMER_DEFAULT_BASE_MINUTES,
        TIMER_DEFAULT_ADJUST_MINUTES,
    } from "$lib/schemas";
    import type { TimerMode } from "$lib/schemas";
    import { playStartBeep } from "$lib/beep";
    import { subscribe, setServerOffset } from "$lib/sse-client";
    import type { TimerInfo, TimersResult } from "$lib/types";
    import Header from "$lib/components/layout/Header.svelte";
    import TimerCard from "$lib/components/timers/TimerCard.svelte";
    import TimerCreateDialog from "$lib/components/timers/TimerCreateDialog.svelte";

    const queryClient = useQueryClient();

    // ダイアログ状態
    type DialogState = {
        open: boolean;
        mode: "create" | "edit";
        timerId: number;
        name: string;
        timerMode: TimerMode;
        baseSeconds: number;
        targetMinutes: number | null;
        adjustMinutes: number;
    };
    let dialog = $state<DialogState>({
        open: false,
        mode: "create",
        timerId: 0,
        name: "",
        timerMode: "countdown",
        baseSeconds: TIMER_DEFAULT_BASE_MINUTES * 60,
        targetMinutes: null,
        adjustMinutes: TIMER_DEFAULT_ADJUST_MINUTES,
    });

    // タイマー一覧取得（SSE でリアルタイム同期）
    const timersQuery = createQuery<TimersResult>(() => ({
        queryKey: ["timers"] as const,
        queryFn: async (): Promise<TimersResult> => {
            // RTT/2 補正付きオフセット計算
            const t0 = Date.now();
            const result = (await trpc.timers.list.query()) as TimersResult;
            const t1 = Date.now();
            const serverMs = new Date(result.server_time).getTime();
            setServerOffset(serverMs - (t0 + t1) / 2);
            return result;
        },
    }));

    // SSE: サーバーからの通知でクエリを再取得
    onMount(() => {
        const unsub = subscribe("timers:updated", () => {
            queryClient.invalidateQueries({ queryKey: ["timers"] });
        });
        return unsub;
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

    // D&D 状態管理
    let draggedId = $state<number | null>(null);
    let dropTargetId = $state<number | null>(null);
    let dropPosition = $state<"before" | "after" | null>(null);

    function handleDragStart(timerId: number) {
        draggedId = timerId;
    }

    function handleDragOver(timerId: number, e: DragEvent) {
        if (draggedId === null || timerId === draggedId) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        dropTargetId = timerId;
        dropPosition = e.clientY < midY ? "before" : "after";
    }

    function handleDrop() {
        if (draggedId === null || dropTargetId === null) return;
        // 新しい順序を構成
        const ids = timersList
            .map((t) => t.id)
            .filter((id) => id !== draggedId);
        const targetIndex = ids.indexOf(dropTargetId);
        if (targetIndex === -1) return;
        const insertIndex =
            dropPosition === "after" ? targetIndex + 1 : targetIndex;
        ids.splice(insertIndex, 0, draggedId);
        handleReorderTimers(ids);
        resetDragState();
    }

    function resetDragState() {
        draggedId = null;
        dropTargetId = null;
        dropPosition = null;
    }

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
    const timersList = $derived(
        (timersQuery.data as TimersResult | undefined)?.timers ?? [],
    );
    const isLoading = $derived(timersQuery.isLoading);

    // ダイアログ操作
    function openCreateDialog() {
        dialog = {
            open: true,
            mode: "create",
            timerId: 0,
            name: "",
            timerMode: "countdown",
            baseSeconds: TIMER_DEFAULT_BASE_MINUTES * 60,
            targetMinutes: null,
            adjustMinutes: TIMER_DEFAULT_ADJUST_MINUTES,
        };
    }

    function openEditDialog(timer: TimerInfo) {
        dialog = {
            open: true,
            mode: "edit",
            timerId: timer.id,
            name: timer.name,
            timerMode: timer.mode,
            baseSeconds: timer.base_seconds,
            targetMinutes: timer.target_minutes,
            adjustMinutes: timer.adjust_minutes,
        };
    }

    async function handleDialogSubmit(data: {
        name: string;
        mode: TimerMode;
        base_seconds: number;
        target_minutes: number | null;
        tz_offset_minutes: number | null;
        adjust_minutes: number;
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
                });
            }
            dialog.open = false;
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    async function handleDelete(timerId: number) {
        if (!globalThis.confirm("このタイマーを削除しますか？")) return;
        try {
            await deleteTimerMutation.mutateAsync(timerId);
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
        <button
            onclick={openCreateDialog}
            class="cursor-pointer rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            data-testid="timer-add-btn"
        >
            + 追加
        </button>
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
                    isDragging={draggedId === timer.id}
                    dropIndicator={dropTargetId === timer.id
                        ? dropPosition
                        : null}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={resetDragState}
                />
            {/each}
        </div>
    {/if}
</div>

<TimerCreateDialog
    open={dialog.open}
    mode={dialog.mode}
    name={dialog.name}
    timerMode={dialog.timerMode}
    baseSeconds={dialog.baseSeconds}
    targetMinutes={dialog.targetMinutes}
    adjustMinutes={dialog.adjustMinutes}
    onSubmit={handleDialogSubmit}
    onClose={() => (dialog.open = false)}
/>
