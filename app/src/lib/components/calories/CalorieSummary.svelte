<script lang="ts">
    type Period = {
        days: 1 | 7 | 28;
        daily_kcal: number;
        percentage: number;
    };

    type Props = {
        periods: Period[];
        goalKcal: number;
        onSaveGoal: (goalKcal: number) => unknown;
    };

    let { periods, goalKcal, onSaveGoal }: Props = $props();

    const periodLabels = {
        1: "1日当たりペース",
        7: "直近7日間平均",
        28: "直近28日間平均",
    } as const;

    const dailyPeriod = $derived(periods.find((period) => period.days === 1));
    const averagePeriods = $derived(
        periods.filter((period) => period.days !== 1),
    );
    // 数値だけを強調するため、前後の文言と数値を分けて持つ
    const remaining = $derived.by(() => {
        if (!dailyPeriod) return undefined;
        const value = goalKcal - dailyPeriod.daily_kcal;
        return {
            prefix: value >= 0 ? "あと " : "",
            value: Math.abs(value).toLocaleString("ja-JP"),
            suffix: value >= 0 ? " kcal" : " kcal 超過",
        };
    });

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
        if (Number.isInteger(value) && value > 0) void onSaveGoal(value);
    }
</script>

<section aria-labelledby="calorie-summary-title">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2
            id="calorie-summary-title"
            class="text-lg font-bold text-gray-800 dark:text-gray-100"
        >
            カロリー
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
                min="1"
                step="1"
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

    <!-- 2列表示では左右の高さを揃え、低い側の内容を上下中央へ置いて余白を上下へ均等に分ける -->
    <div class="grid gap-3 md:grid-cols-2">
        {#if dailyPeriod && remaining}
            <article
                class={`flex flex-col justify-center gap-2 rounded border p-4 ${colorClass(dailyPeriod.percentage)}`}
                data-testid="calorie-summary-1"
            >
                <div
                    class="flex flex-wrap items-baseline justify-between gap-2"
                >
                    <h3 class="text-sm font-semibold">{periodLabels[1]}</h3>
                    <p
                        class="text-xl font-bold"
                        data-testid="calorie-summary-pace"
                    >
                        {dailyPeriod.daily_kcal.toLocaleString("ja-JP")}
                        <span class="text-base font-normal"
                            >kcal ({dailyPeriod.percentage.toFixed(1)}%)</span
                        >
                    </p>
                </div>
                <p class="text-base" data-testid="calorie-summary-remaining">
                    {remaining.prefix}<span
                        class="text-3xl font-bold"
                        data-testid="calorie-summary-remaining-value"
                        >{remaining.value}</span
                    >{remaining.suffix}
                </p>
            </article>
        {/if}
        <div class="grid content-center gap-3">
            {#each averagePeriods as period (period.days)}
                <article
                    class={`flex flex-wrap items-baseline justify-between gap-2 rounded border p-4 ${colorClass(period.percentage)}`}
                    data-testid={`calorie-summary-${period.days}`}
                >
                    <h3 class="text-sm font-semibold">
                        {periodLabels[period.days]}
                    </h3>
                    <p class="text-xl font-bold">
                        {period.daily_kcal.toLocaleString("ja-JP")}
                        <span class="text-base font-normal"
                            >kcal ({period.percentage.toFixed(1)}%)</span
                        >
                    </p>
                </article>
            {/each}
        </div>
    </div>
</section>
