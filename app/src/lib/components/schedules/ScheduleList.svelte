<script lang="ts">
    /**
     * @fileoverview 定期TODOスケジュール一覧の表示専用コンポーネント
     *
     * 有効/無効切替・編集・削除はいずれもコールバック経由で親（ScheduleDialog.svelte）へ
     * 委譲する。tRPC呼び出しは持たない。
     */

    import type { ScheduleInfo } from "$lib/types";
    import { describeSchedule } from "$lib/schedule-utils";

    type Props = {
        schedules: ScheduleInfo[];
        onEdit: (s: ScheduleInfo) => void;
        onToggle: (s: ScheduleInfo) => void;
        onDelete: (s: ScheduleInfo) => void;
    };

    let { schedules, onEdit, onToggle, onDelete }: Props = $props();
</script>

<ul class="flex flex-col gap-1" data-testid="schedule-list">
    {#each schedules as schedule (schedule.id)}
        <li
            class="flex items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2 dark:border-gray-600"
            data-testid="schedule-item"
            class:opacity-50={!schedule.enabled}
        >
            <div class="min-w-0 flex-1">
                <p
                    class="truncate font-medium text-gray-800 dark:text-gray-100"
                    data-testid="schedule-title"
                >
                    {schedule.title}
                </p>
                <p
                    class="text-sm text-gray-500 dark:text-gray-400"
                    data-testid="schedule-summary"
                >
                    {describeSchedule(schedule.rrule)}
                </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
                <label class="flex cursor-pointer items-center gap-1 text-sm">
                    <input
                        type="checkbox"
                        checked={schedule.enabled}
                        onchange={() => onToggle(schedule)}
                        data-testid="schedule-enabled-toggle"
                    />
                    有効
                </label>
                <button
                    onclick={() => onEdit(schedule)}
                    class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    aria-label="編集"
                    title="編集"
                    data-testid="schedule-edit-btn">✏️</button
                >
                <button
                    onclick={() => onDelete(schedule)}
                    class="cursor-pointer rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                    aria-label="削除"
                    title="削除"
                    data-testid="schedule-delete-btn">🗑️</button
                >
            </div>
        </li>
    {/each}
    {#if schedules.length === 0}
        <p class="text-gray-400 dark:text-gray-500">定期TODOはありません</p>
    {/if}
</ul>
