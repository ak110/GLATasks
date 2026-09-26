<script lang="ts">
    import type { RouterOutputs } from "$lib/trpc";

    type Achievement = RouterOutputs["calories"]["summary"]["achievement"];
    type Status = Achievement["days"][number]["status"];

    type Props = {
        achievement: Achievement;
    };

    let { achievement }: Props = $props();

    const statusLabels: Record<Status, string> = {
        achieved: "目標内",
        missed: "目標超過",
        unrated: "判定対象外",
    };

    const dotClasses: Record<Status, string> = {
        achieved: "bg-emerald-500 dark:bg-emerald-400",
        missed: "border border-gray-400 dark:border-gray-500",
        unrated: "border border-dashed border-gray-300 dark:border-gray-600",
    };

    // 昨日が達成日なら、ブロック全体を淡い緑系の配色へ変える
    const achieved = $derived(achievement.streak_days > 0);
    const streakText = $derived(
        achievement.streak_days >= achievement.days.length
            ? `${achievement.days.length}日以上`
            : `${achievement.streak_days}日`,
    );

    function formatKcal(value: number): string {
        return value.toLocaleString("ja-JP");
    }

    function dotLabel(day: Achievement["days"][number]): string {
        const average =
            day.average_kcal === null
                ? ""
                : ` 7日平均 ${formatKcal(day.average_kcal)} kcal`;
        return `${day.date}${average} ${statusLabels[day.status]}`;
    }
</script>

<!-- 横幅が足りる場合は見出し・連続日数・先週比・点を1行へ並べ、足りない場合は折り返す -->
<section
    aria-labelledby="calorie-achievement-title"
    class={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border p-4 ${
        achieved
            ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100"
            : "border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
    }`}
    data-testid="calorie-achievement"
    data-achieved={achieved}
>
    <h3 id="calorie-achievement-title" class="text-sm font-semibold">
        達成状況
    </h3>
    {#if achieved}
        <p class="text-base" data-testid="calorie-achievement-streak">
            <span class="text-2xl font-bold">{streakText}</span>連続で目標内
        </p>
    {/if}
    {#if achievement.latest_average_kcal === null}
        <p class="text-sm" data-testid="calorie-achievement-guide">
            記録が7日分たまると判定を始めます
        </p>
    {/if}
    {#if achievement.weekly_change_kcal !== null && achievement.weekly_change_kcal < 0}
        <p class="text-sm" data-testid="calorie-achievement-weekly-change">
            先週より −{formatKcal(Math.abs(achievement.weekly_change_kcal))} kcal/日
        </p>
    {/if}
    <!-- 左が最も古い確定日、右が昨日 -->
    <ol class="ml-auto flex flex-wrap gap-1.5" aria-label="直近28日の達成状況">
        {#each achievement.days as day (day.date)}
            <li
                class={`size-3 rounded-full ${dotClasses[day.status]}`}
                title={dotLabel(day)}
                aria-label={dotLabel(day)}
                data-testid="calorie-achievement-day"
                data-status={day.status}
            ></li>
        {/each}
    </ol>
</section>
