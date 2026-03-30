<script lang="ts">
    /**
     * @fileoverview タイマーカードコンポーネント
     */

    import type { TimerInfo } from "$lib/types";
    import { getServerOffset } from "$lib/sse-client";
    import {
        calcTimerRemainingMs,
        formatTime,
        parseTimeInput,
        formatTargetTime,
        parseTargetTime,
        calcSecondsUntilTarget,
    } from "$lib/timer-utils";

    type Props = {
        timer: TimerInfo;
        onStart: (timerId: number) => void;
        onPause: (timerId: number) => void;
        onReset: (timerId: number) => void;
        onAdjust: (timerId: number, minutes: number) => void;
        onSetTime: (
            timerId: number,
            seconds: number,
            targetMinutes?: number,
            tzOffsetMinutes?: number,
        ) => void;
        onEdit: (timer: TimerInfo) => void;
        onDelete: (timerId: number) => void;
        isDragging?: boolean;
        dropIndicator?: "before" | "after" | null;
        onDragStart?: (timerId: number) => void;
        onDragOver?: (timerId: number, e: DragEvent) => void;
        onDrop?: () => void;
        onDragEnd?: () => void;
    };

    let {
        timer,
        onStart,
        onPause,
        onReset,
        onAdjust,
        onSetTime,
        onEdit,
        onDelete,
        isDragging = false,
        dropIndicator = null,
        onDragStart,
        onDragOver,
        onDrop,
        onDragEnd,
    }: Props = $props();

    let displaySeconds = $state(0);
    let intervalId = $state<ReturnType<typeof setInterval> | null>(null);

    // 時刻編集状態
    let editing = $state(false);
    let editValue = $state("");

    /** 残り秒数を計算する */
    function calcRemaining(): number {
        // 停止中のアラームは wall clock からライブ計算
        if (
            timer.mode === "alarm" &&
            !timer.running &&
            timer.target_minutes !== null
        ) {
            return calcSecondsUntilTarget(timer.target_minutes);
        }
        return Math.floor(
            calcTimerRemainingMs(timer, getServerOffset()) / 1000,
        );
    }

    // 停止中アラームかどうか（カウントダウン非表示・インターバル不要）
    const isStoppedAlarm = $derived(
        timer.mode === "alarm" &&
            !timer.running &&
            timer.target_minutes !== null,
    );

    // 1秒ごとに表示更新
    $effect(() => {
        displaySeconds = calcRemaining();

        if (timer.running) {
            const id = setInterval(() => {
                displaySeconds = calcRemaining();
            }, 1000);
            intervalId = id;
            return () => clearInterval(id);
        } else {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        }
    });

    const isExpired = $derived(timer.expired && !timer.running);

    /** 時刻表示クリック → 編集モードに切り替え */
    function startEditing() {
        if (timer.running) return;
        editing = true;
        if (timer.mode === "alarm" && timer.target_minutes !== null) {
            editValue = formatTargetTime(timer.target_minutes);
        } else {
            editValue = formatTime(displaySeconds);
        }
    }

    /** 編集確定 */
    function commitEdit() {
        editing = false;
        if (timer.mode === "alarm") {
            const target = parseTargetTime(editValue);
            if (target !== null && target !== timer.target_minutes) {
                const tzOffset = -new Date().getTimezoneOffset();
                onSetTime(timer.id, 0, target, tzOffset);
            }
        } else {
            const seconds = parseTimeInput(editValue);
            if (seconds !== null && seconds !== displaySeconds) {
                onSetTime(timer.id, seconds);
            }
        }
    }

    /** 編集キャンセル */
    function cancelEdit() {
        editing = false;
    }

    /** 編集中のキー入力処理 */
    function handleEditKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            commitEdit();
        } else if (e.key === "Escape") {
            e.preventDefault();
            cancelEdit();
        }
    }
</script>

<div
    class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
    class:opacity-50={isDragging}
    class:border-t-2={dropIndicator === "before"}
    class:border-t-blue-500={dropIndicator === "before"}
    class:border-b-2={dropIndicator === "after"}
    class:border-b-blue-500={dropIndicator === "after"}
    data-testid="timer-card"
    role="listitem"
    ondragover={(e) => {
        if (onDragOver) {
            e.preventDefault();
            onDragOver(timer.id, e);
        }
    }}
    ondrop={(e) => {
        if (onDrop) {
            e.preventDefault();
            onDrop();
        }
    }}
    ondragend={() => onDragEnd?.()}
>
    <!-- ヘッダー: ドラッグハンドル + タイマー名 + 操作ボタン -->
    <div class="mb-3 flex items-center justify-between">
        {#if onDragStart}
            <span
                class="mr-2 hidden cursor-grab text-gray-400 select-none sm:inline dark:text-gray-500"
                draggable="true"
                role="button"
                tabindex="-1"
                aria-label="ドラッグして並び替え"
                title="ドラッグして並び替え"
                ondragstart={(e) => {
                    e.dataTransfer!.effectAllowed = "move";
                    onDragStart(timer.id);
                }}>⠿</span
            >
        {/if}
        {#if timer.name}
            <h3
                class="font-medium text-gray-800 dark:text-gray-100"
                data-testid="timer-name"
            >
                {timer.name}
            </h3>
        {/if}
        <div class="flex gap-1">
            <button
                onclick={() => onEdit(timer)}
                class="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                title="編集"
                aria-label="タイマーを編集"
                data-testid="timer-edit-btn">✏️</button
            >
            <button
                onclick={() => onDelete(timer.id)}
                class="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700"
                title="削除"
                aria-label="タイマーを削除"
                data-testid="timer-delete-btn">🗑</button
            >
        </div>
    </div>

    <!-- アラームモード: 目標時刻表示 -->
    {#if timer.mode === "alarm" && timer.target_minutes !== null}
        {#if editing}
            <div
                class="mb-1 text-center text-sm"
                data-testid="timer-target-display"
            >
                🔔 <input
                    type="time"
                    bind:value={editValue}
                    onblur={commitEdit}
                    onkeydown={handleEditKeydown}
                    class="cursor-pointer rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-sm focus:border-blue-400 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    data-testid="timer-time-input"
                />
            </div>
        {:else if !timer.running}
            <button
                class="mb-1 w-full cursor-pointer bg-transparent text-center text-sm text-gray-500 dark:text-gray-400"
                onclick={startEditing}
                data-testid="timer-target-display"
            >
                🔔 {formatTargetTime(timer.target_minutes)}
            </button>
        {:else}
            <div
                class="mb-1 text-center text-sm text-gray-500 dark:text-gray-400"
                data-testid="timer-target-display"
            >
                🔔 {formatTargetTime(timer.target_minutes)}
            </div>
        {/if}
    {/if}

    <!-- 残り時間表示（停止中アラームでは非表示） -->
    {#if !isStoppedAlarm}
        <div
            class="mb-4 text-center font-mono text-3xl font-bold sm:text-4xl"
            data-testid="timer-display"
        >
            {#if editing}
                <input
                    type={timer.mode === "alarm" ? "time" : "text"}
                    bind:value={editValue}
                    onblur={commitEdit}
                    onkeydown={handleEditKeydown}
                    class="w-full rounded border border-gray-300 bg-white px-2 py-1 text-center font-mono text-3xl font-bold text-gray-800 focus:border-blue-400 focus:outline-none sm:text-4xl dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    data-testid="timer-time-input"
                />
            {:else if timer.running}
                <span class="text-blue-600">{formatTime(displaySeconds)}</span>
            {:else}
                <button
                    class="cursor-pointer bg-transparent {isExpired
                        ? 'text-red-500'
                        : 'text-gray-800 dark:text-gray-100'}"
                    onclick={startEditing}>{formatTime(displaySeconds)}</button
                >
            {/if}
        </div>
    {/if}

    <!-- 操作ボタン -->
    <div class="flex flex-wrap items-center justify-center gap-2">
        <div class="flex flex-nowrap items-center gap-2">
            {#if timer.running}
                {#if timer.mode !== "alarm"}
                    <button
                        onclick={() => onPause(timer.id)}
                        class="cursor-pointer rounded bg-yellow-100 px-3 py-1.5 text-sm text-yellow-700 hover:bg-yellow-200"
                        data-testid="timer-pause-btn">⏸ 一時停止</button
                    >
                {/if}
            {:else}
                <button
                    onclick={() => onStart(timer.id)}
                    disabled={displaySeconds <= 0}
                    class="cursor-pointer rounded bg-green-100 px-3 py-1.5 text-sm text-green-700 hover:bg-green-200 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="timer-start-btn">▶ 開始</button
                >
            {/if}
            <button
                onclick={() => onReset(timer.id)}
                class="cursor-pointer rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                data-testid="timer-reset-btn">🔄 リセット</button
            >
        </div>
        <div class="flex flex-nowrap items-center gap-2">
            <button
                onclick={() => onAdjust(timer.id, timer.adjust_minutes)}
                class="cursor-pointer rounded bg-blue-50 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                data-testid="timer-plus-btn">+{timer.adjust_minutes}分</button
            >
            <button
                onclick={() => onAdjust(timer.id, -timer.adjust_minutes)}
                class="cursor-pointer rounded bg-blue-50 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                data-testid="timer-minus-btn">-{timer.adjust_minutes}分</button
            >
        </div>
    </div>
</div>
