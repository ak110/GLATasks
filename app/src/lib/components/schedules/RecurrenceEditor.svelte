<script lang="ts">
    /**
     * @fileoverview 繰り返しルール編集フォーム（頻度・間隔・曜日/日/月・時刻・終了条件）
     *
     * タイトル・タグの入力は `ScheduleDialog.svelte` が担当し、本コンポーネントは
     * 繰り返しルールの入力とRFC5545形式のRRULE文字列生成に専念する。
     */

    import { RRule, rrulestr, datetime } from "rrule";
    import type { Weekday } from "rrule";
    import type { ScheduleInfo } from "$lib/types";

    type Props = {
        value: ScheduleInfo | null;
        onSubmit: (input: { rrule: string }) => void;
        onCancel: () => void;
    };

    let { value, onSubmit, onCancel }: Props = $props();

    type FreqOption = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
    type EndCondition = "never" | "count" | "until";

    const FREQ_TO_RRULE = {
        DAILY: RRule.DAILY,
        WEEKLY: RRule.WEEKLY,
        MONTHLY: RRule.MONTHLY,
        YEARLY: RRule.YEARLY,
    } as const;
    const RRULE_TO_FREQ: Record<number, FreqOption> = {
        [RRule.DAILY]: "DAILY",
        [RRule.WEEKLY]: "WEEKLY",
        [RRule.MONTHLY]: "MONTHLY",
        [RRule.YEARLY]: "YEARLY",
    };

    const WEEKDAY_OPTIONS: { code: string; label: string }[] = [
        { code: "MO", label: "月" },
        { code: "TU", label: "火" },
        { code: "WE", label: "水" },
        { code: "TH", label: "木" },
        { code: "FR", label: "金" },
        { code: "SA", label: "土" },
        { code: "SU", label: "日" },
    ];

    /**
     * 曜日コード文字列からrruleの `Weekday` インスタンスへの変換テーブル。
     *
     * `RRule` コンストラクタの `byweekday` オプションは `Weekday` インスタンスまたは
     * 数値インデックスのみを受け付ける。曜日コード文字列（`"MO"` 等）をそのまま渡すと
     * `toString()` でのRRULE文字列組み立て時に `BYDAY=undefined` となり、
     * サーバー側のRFC5545バリデーションで拒否される
     */
    const WEEKDAY_CODE_TO_RRULE: Record<string, Weekday> = {
        MO: RRule.MO,
        TU: RRule.TU,
        WE: RRule.WE,
        TH: RRule.TH,
        FR: RRule.FR,
        SA: RRule.SA,
        SU: RRule.SU,
    };

    let freq = $state<FreqOption>("WEEKLY");
    let interval = $state(1);
    let selectedWeekdays = $state<string[]>([]);
    let monthDay = $state(1);
    let yearMonth = $state(1);
    let timeStr = $state("09:00");
    let endCondition = $state<EndCondition>("never");
    let count = $state(10);
    let untilDateStr = $state("");

    /** DTSTART組み立て用の年月日。既存value有無に関わらずAsia/Tokyoの暦日で保持する */
    let dtstartDate = $state(getTokyoTodayParts());

    /**
     * ブラウザのタイムゾーンに依存せず、Asia/Tokyoの暦日（年・月・日）を取得する。
     * `new Date().getFullYear()`等はブラウザTZ依存でAsia/Tokyoとずれ得るため使用しない。
     */
    function getTokyoTodayParts(): {
        year: number;
        month: number;
        day: number;
    } {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Tokyo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(new Date());
        const get = (type: string) =>
            Number(parts.find((p) => p.type === type)!.value);
        return { year: get("year"), month: get("month"), day: get("day") };
    }

    function pad(n: number): string {
        return String(n).padStart(2, "0");
    }

    function formatDateInput(d: Date): string {
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }

    /**
     * UTC形式（末尾Z付き）のUNTIL文字列を組み立てる（RFC5545規定に従う）。
     *
     * `d` は `datetime()` で組み立てたAsia/Tokyo市民時刻23:59:59であり、UTCとして
     * マークされたDateオブジェクトである。そのまま`toISOString()`すると9時間分
     * 早いUTC時刻になってしまうため、9時間分を減算してからUTC形式へ変換する。
     */
    function formatUntilUtc(d: Date): string {
        const utcMs = d.getTime() - 9 * 3600 * 1000;
        return new Date(utcMs)
            .toISOString()
            .replace(/[-:]/g, "")
            .replace(/\.\d{3}Z$/, "Z");
    }

    function loadFromValue(v: ScheduleInfo) {
        const rule = rrulestr(v.rrule, { tzid: "Asia/Tokyo" });
        if (!(rule instanceof RRule)) return;
        const o = rule.options;
        freq = RRULE_TO_FREQ[o.freq] ?? "WEEKLY";
        interval = o.interval;
        // rrule は頻度に応じて byweekday/bymonthday/bymonth が `null` になる
        // （配列ではなく）ため、非該当頻度でのアクセスに備えてnull安全にする
        selectedWeekdays = (o.byweekday ?? []).map(
            (w) => WEEKDAY_OPTIONS[w]!.code,
        );
        const bymonthday = o.bymonthday ?? [];
        if (bymonthday.length > 0) monthDay = bymonthday[0]!;
        const bymonth = o.bymonth ?? [];
        if (bymonth.length > 0) yearMonth = bymonth[0]!;
        timeStr = `${pad(o.dtstart.getUTCHours())}:${pad(o.dtstart.getUTCMinutes())}`;
        // DTSTARTの暦日を復元する。元のrrule文字列が保持するAsia/Tokyoの年月日を
        // そのまま引き継ぎ、編集のたびにDTSTARTが今日へずれてしまうことを防ぐ
        dtstartDate = {
            year: o.dtstart.getUTCFullYear(),
            month: o.dtstart.getUTCMonth() + 1,
            day: o.dtstart.getUTCDate(),
        };
        if (o.count) {
            endCondition = "count";
            count = o.count;
        } else if (o.until) {
            endCondition = "until";
            untilDateStr = formatDateInput(o.until);
        } else {
            endCondition = "never";
        }
    }

    $effect(() => {
        if (value) loadFromValue(value);
    });

    function toggleWeekday(code: string) {
        selectedWeekdays = selectedWeekdays.includes(code)
            ? selectedWeekdays.filter((c) => c !== code)
            : [...selectedWeekdays, code];
    }

    function buildRruleString(): string {
        const [hourStr, minuteStr] = timeStr.split(":");
        const hour = Number(hourStr);
        const minute = Number(minuteStr);
        const dtstart = datetime(
            dtstartDate.year,
            dtstartDate.month,
            dtstartDate.day,
            hour,
            minute,
            0,
        );

        const options: ConstructorParameters<typeof RRule>[0] = {
            freq: FREQ_TO_RRULE[freq],
            interval,
            dtstart,
            tzid: "Asia/Tokyo",
        };
        if (freq === "WEEKLY" && selectedWeekdays.length > 0) {
            options.byweekday = selectedWeekdays.map(
                (code) => WEEKDAY_CODE_TO_RRULE[code]!,
            );
        }
        if (freq === "MONTHLY") {
            options.bymonthday = [monthDay];
        }
        if (freq === "YEARLY") {
            options.bymonth = [yearMonth];
            options.bymonthday = [monthDay];
        }
        if (endCondition === "count") {
            options.count = count;
        }

        const rule = new RRule(options);
        let rruleStr = rule.toString();

        if (endCondition === "until" && untilDateStr) {
            const [y, m, d] = untilDateStr.split("-").map(Number);
            const untilLocal = datetime(y!, m!, d!, 23, 59, 59);
            const untilUtc = formatUntilUtc(untilLocal);
            rruleStr = rruleStr.replace(
                /^(RRULE:.*)$/m,
                (line) => `${line};UNTIL=${untilUtc}`,
            );
        }
        return rruleStr;
    }

    function handleSubmit(e: Event) {
        e.preventDefault();
        onSubmit({ rrule: buildRruleString() });
    }
</script>

<form
    onsubmit={handleSubmit}
    class="flex flex-col gap-3"
    data-testid="recurrence-editor"
>
    <div class="flex items-center gap-2">
        <label
            class="font-medium text-gray-700 dark:text-gray-200"
            for="recur-freq">頻度</label
        >
        <select
            id="recur-freq"
            bind:value={freq}
            class="cursor-pointer rounded border border-gray-200 px-2 py-1 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            data-testid="recur-freq-select"
        >
            <option value="DAILY">毎日</option>
            <option value="WEEKLY">毎週</option>
            <option value="MONTHLY">毎月</option>
            <option value="YEARLY">毎年</option>
        </select>
        <label class="text-gray-700 dark:text-gray-200" for="recur-interval"
            >間隔</label
        >
        <input
            id="recur-interval"
            type="number"
            min="1"
            bind:value={interval}
            class="w-16 rounded border border-gray-200 px-2 py-1 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        <span class="text-sm text-gray-500 dark:text-gray-400">回ごと</span>
    </div>

    {#if freq === "WEEKLY"}
        <div class="flex flex-wrap gap-1" data-testid="recur-weekday-group">
            {#each WEEKDAY_OPTIONS as opt (opt.code)}
                <button
                    type="button"
                    onclick={() => toggleWeekday(opt.code)}
                    class="cursor-pointer rounded px-2 py-1 text-sm {selectedWeekdays.includes(
                        opt.code,
                    )
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}"
                >
                    {opt.label}
                </button>
            {/each}
        </div>
    {/if}

    {#if freq === "MONTHLY" || freq === "YEARLY"}
        <div class="flex items-center gap-2">
            {#if freq === "YEARLY"}
                <label
                    class="text-gray-700 dark:text-gray-200"
                    for="recur-month">月</label
                >
                <input
                    id="recur-month"
                    type="number"
                    min="1"
                    max="12"
                    bind:value={yearMonth}
                    class="w-16 rounded border border-gray-200 px-2 py-1 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
            {/if}
            <label class="text-gray-700 dark:text-gray-200" for="recur-day"
                >日</label
            >
            <input
                id="recur-day"
                type="number"
                min="1"
                max="31"
                bind:value={monthDay}
                class="w-16 rounded border border-gray-200 px-2 py-1 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
        </div>
    {/if}

    <div class="flex items-center gap-2">
        <label class="text-gray-700 dark:text-gray-200" for="recur-time"
            >時刻</label
        >
        <input
            id="recur-time"
            type="time"
            bind:value={timeStr}
            class="rounded border border-gray-200 px-2 py-1 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
    </div>

    <div class="flex flex-col gap-1.5">
        <span class="font-medium text-gray-700 dark:text-gray-200"
            >終了条件</span
        >
        <label class="flex cursor-pointer items-center gap-1.5">
            <input type="radio" bind:group={endCondition} value="never" />
            無期限
        </label>
        <label class="flex cursor-pointer items-center gap-1.5">
            <input type="radio" bind:group={endCondition} value="count" />
            回数指定
            <input
                type="number"
                min="1"
                bind:value={count}
                disabled={endCondition !== "count"}
                class="w-16 rounded border border-gray-200 px-2 py-1 focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            回
        </label>
        <label class="flex cursor-pointer items-center gap-1.5">
            <input type="radio" bind:group={endCondition} value="until" />
            日付指定
            <input
                type="date"
                bind:value={untilDateStr}
                disabled={endCondition !== "until"}
                class="rounded border border-gray-200 px-2 py-1 focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
        </label>
    </div>

    <div class="flex justify-end gap-2">
        <button
            type="button"
            onclick={onCancel}
            class="cursor-pointer rounded bg-gray-100 px-4 py-1.5 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
            キャンセル
        </button>
        <button
            type="submit"
            class="cursor-pointer rounded bg-blue-600 px-4 py-1.5 text-white hover:bg-blue-700"
            data-testid="recur-submit-btn"
        >
            確定
        </button>
    </div>
</form>
