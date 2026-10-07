<script lang="ts">
    import { timerInputClass } from "#lib/components/ui/styles.ts";
    import { grayButtonClass } from "#lib/components/ui/styles.ts";
    import { getTimezoneOffsetMinutes } from "#lib/date-time.ts";
    import Dialog from "#lib/components/dialogs/Dialog.svelte";
    /**
     * @fileoverview タイマー追加/編集ダイアログ
     */

    import {
        TIMER_DEFAULT_ADJUST_MINUTES,
        TIMER_DEFAULT_RING_SECONDS,
    } from "#lib/schemas.ts";
    import type { TimerMode, UserPreferences } from "#lib/schemas.ts";
    import {
        formatTime,
        parseTimeInput,
        formatTargetTime,
        parseTargetTime,
    } from "#lib/timer-utils.ts";

    type Props = {
        open: boolean;
        mode: "create" | "edit";
        ephemeral: boolean;
        name: string;
        timerMode: TimerMode;
        baseSeconds: number;
        targetMinutes: number | null;
        adjustMinutes: number;
        ringSeconds: number;
        onSubmit: (data: {
            name: string;
            mode: TimerMode;
            base_seconds: number;
            target_minutes: number | null;
            tz_offset_minutes: number | null;
            adjust_minutes: number;
            ring_seconds: number;
        }) => void;
        onClose: () => void;
        onSaveAsDefault?: (preferences: UserPreferences) => void;
    };

    let {
        open,
        mode,
        ephemeral,
        name: initialName,
        timerMode: initialTimerMode,
        baseSeconds: initialBaseSeconds,
        targetMinutes: initialTargetMinutes,
        adjustMinutes: initialAdjustMinutes,
        ringSeconds: initialRingSeconds,
        onSubmit,
        onClose,
        onSaveAsDefault,
    }: Props = $props();

    // ダイアログタイトル: 一時タイマー作成時のみ専用文言に差し替える
    const dialogTitle = $derived(
        mode === "edit"
            ? "タイマー編集"
            : ephemeral
              ? "一時タイマー追加"
              : "タイマー追加",
    );

    let localName = $state("");
    let localTimerMode = $state<TimerMode>("countdown");
    let localBaseTime = $state("");
    let localTargetTime = $state("");
    let localAdjustMinutes = $state(TIMER_DEFAULT_ADJUST_MINUTES);
    let localRingSeconds = $state(TIMER_DEFAULT_RING_SECONDS);
    let nameInputEl = $state<HTMLInputElement | null>(null);
    let formEl = $state<HTMLFormElement | null>(null);

    // ダイアログ開閉時にローカル状態をリセット
    $effect(() => {
        if (open) {
            localName = initialName;
            localTimerMode = initialTimerMode;
            localBaseTime = formatTime(initialBaseSeconds);
            localTargetTime =
                initialTargetMinutes !== null
                    ? formatTargetTime(initialTargetMinutes)
                    : "";
            localAdjustMinutes = initialAdjustMinutes;
            localRingSeconds = initialRingSeconds;
            queueMicrotask(() => nameInputEl?.focus());
        }
    });

    function handleSubmit() {
        if (localTimerMode === "alarm") {
            const target = parseTargetTime(localTargetTime);
            if (target === null) return;
            onSubmit({
                name: localName.trim(),
                mode: "alarm",
                base_seconds: 0,
                target_minutes: target,
                tz_offset_minutes: getTimezoneOffsetMinutes(),
                adjust_minutes: localAdjustMinutes,
                ring_seconds: localRingSeconds,
            });
        } else {
            const baseSeconds = parseTimeInput(localBaseTime);
            if (baseSeconds === null || baseSeconds <= 0) return;
            onSubmit({
                name: localName.trim(),
                mode: "countdown",
                base_seconds: baseSeconds,
                target_minutes: null,
                tz_offset_minutes: null,
                adjust_minutes: localAdjustMinutes,
                ring_seconds: localRingSeconds,
            });
        }
    }

    /** 現在のフォーム値を利用者既定値として保存する */
    function handleSaveAsDefault() {
        if (!onSaveAsDefault) return;
        // 送信ボタンと異なりブラウザ標準の制約検証を経由しないため明示的に呼び出す
        if (formEl && !formEl.reportValidity()) return;
        const baseSeconds =
            localTimerMode === "countdown"
                ? (parseTimeInput(localBaseTime) ?? undefined)
                : undefined;
        onSaveAsDefault({
            ring_seconds: localRingSeconds,
            base_seconds: baseSeconds,
            adjust_minutes: localAdjustMinutes,
            mode: localTimerMode,
        });
    }
</script>

<Dialog
    {open}
    title={dialogTitle}
    widthClass="max-w-md"
    {onClose}
    initialFocus={() => nameInputEl}
    titleTestId="timer-dialog-title"
>
    <form
        bind:this={formEl}
        onsubmit={(e) => {
            e.preventDefault();
            handleSubmit();
        }}
        class="flex flex-col gap-4 p-6"
    >
        <div>
            <label
                for="timer-name"
                class="mb-1 block text-sm text-gray-600 dark:text-gray-300"
                >名前</label
            >
            <input
                id="timer-name"
                type="text"
                bind:value={localName}
                bind:this={nameInputEl}
                class="w-full {timerInputClass}"
                placeholder="例: 作業タイマー"
                maxlength="255"
                data-testid="timer-name-input"
            />
        </div>

        <!-- モード切替 -->
        <div class="flex gap-0" data-testid="timer-mode-selector">
            <button
                type="button"
                onclick={() => (localTimerMode = "countdown")}
                class="cursor-pointer rounded-l px-4 py-1.5 text-sm {localTimerMode ===
                'countdown'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}"
                data-testid="timer-mode-countdown"
            >
                カウントダウン
            </button>
            <button
                type="button"
                onclick={() => (localTimerMode = "alarm")}
                class="cursor-pointer rounded-r px-4 py-1.5 text-sm {localTimerMode ===
                'alarm'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}"
                data-testid="timer-mode-alarm"
            >
                アラーム
            </button>
        </div>

        {#if localTimerMode === "countdown"}
            <div>
                <label
                    for="timer-base-time"
                    class="mb-1 block text-sm text-gray-600 dark:text-gray-300"
                    >ベース時間</label
                >
                <input
                    id="timer-base-time"
                    type="text"
                    bind:value={localBaseTime}
                    class="w-full font-mono {timerInputClass}"
                    placeholder="HH:MM:SS"
                    data-testid="timer-base-time-input"
                />
            </div>
        {:else}
            <div>
                <label
                    for="timer-target-time"
                    class="mb-1 block text-sm text-gray-600 dark:text-gray-300"
                    >目標時刻</label
                >
                <input
                    id="timer-target-time"
                    type="time"
                    bind:value={localTargetTime}
                    class="w-full font-mono {timerInputClass}"
                    data-testid="timer-target-time-input"
                />
            </div>
        {/if}

        <div>
            <label
                for="timer-adjust"
                class="mb-1 block text-sm text-gray-600 dark:text-gray-300"
                >延長/削減の単位（分）</label
            >
            <input
                id="timer-adjust"
                type="number"
                bind:value={localAdjustMinutes}
                min="1"
                max="999"
                required
                class="w-24 text-center {timerInputClass}"
                data-testid="timer-adjust-input"
            />
        </div>

        <div>
            <label
                for="timer-ring-seconds"
                class="mb-1 block text-sm text-gray-600 dark:text-gray-300"
                >鳴らす時間（秒）</label
            >
            <input
                id="timer-ring-seconds"
                type="number"
                bind:value={localRingSeconds}
                min="1"
                max="3600"
                required
                class="w-24 text-center {timerInputClass}"
                data-testid="timer-ring-seconds-input"
            />
        </div>

        <div class="flex items-center justify-between">
            {#if onSaveAsDefault}
                <button
                    type="button"
                    onclick={handleSaveAsDefault}
                    class={grayButtonClass}
                    title="現在のフォーム値を新規作成時の既定値として保存する"
                    data-testid="timer-save-default-btn"
                >
                    現在の値を既定として保存
                </button>
            {:else}
                <span></span>
            {/if}
            <button
                type="submit"
                class="cursor-pointer rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
                data-testid="timer-submit-btn"
                >{mode === "create" ? "追加" : "保存"}</button
            >
        </div>
    </form>
</Dialog>
