<script lang="ts">
    type Period = {
        days: 1 | 7 | 28;
        total_kcal: number;
        percentage: number;
    };

    type Props = {
        periods: Period[];
        goalKcal: number;
        onSaveGoal: (goalKcal: number) => unknown;
    };

    let { periods, goalKcal, onSaveGoal }: Props = $props();

    const periodLabels = {
        1: "直近24時間",
        7: "直近7日間",
        28: "直近28日間",
    } as const;

    function colorClass(percentage: number): string {
        if (percentage <= 95) {
            return "border-sky-200 bg-sky-100 text-sky-950 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-100";
        }
        if (percentage <= 105) {
            return "border-gray-200 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-100 dark:text-gray-900";
        }
        if (percentage <= 110) {
            return "border-yellow-300 bg-yellow-100 text-yellow-950 dark:border-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-100";
        }
        return "border-red-300 bg-red-100 text-red-950 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100";
    }

    function handleGoalSubmit(event: SubmitEvent) {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const value = Number(new FormData(form).get("goalKcal"));
        if (Number.isFinite(value) && value > 0) void onSaveGoal(value);
    }
</script>

<section aria-labelledby="calorie-summary-title">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2
            id="calorie-summary-title"
            class="text-lg font-bold text-gray-800 dark:text-gray-100"
        >
            カロリー合計
        </h2>
        <form class="flex items-center gap-2" onsubmit={handleGoalSubmit}>
            <label
                for="calorie-goal"
                class="text-sm text-gray-700 dark:text-gray-200"
            >
                1日目標
            </label>
            <input
                id="calorie-goal"
                name="goalKcal"
                type="number"
                min="0.0001"
                step="0.1"
                value={goalKcal}
                class="w-28 rounded border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <span class="text-sm text-gray-600 dark:text-gray-300">kcal</span>
            <button
                type="submit"
                class="cursor-pointer rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                >保存</button
            >
        </form>
    </div>

    <div class="grid gap-3 md:grid-cols-3">
        {#each periods as period (period.days)}
            <article
                class={`rounded border p-4 ${colorClass(period.percentage)}`}
                data-testid={`calorie-summary-${period.days}`}
            >
                <h3 class="text-sm font-semibold">
                    {periodLabels[period.days]}
                </h3>
                <p class="mt-2 text-3xl font-bold">
                    {period.total_kcal.toLocaleString("ja-JP", {
                        maximumFractionDigits: 1,
                    })}
                    <span class="text-base font-normal">kcal</span>
                </p>
                <p class="mt-1 text-2xl font-semibold">
                    {period.percentage.toFixed(1)}%
                </p>
            </article>
        {/each}
    </div>
</section>
