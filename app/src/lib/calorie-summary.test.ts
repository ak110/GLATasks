/** カロリーの集計を日時・数量・品目の組合せで検証する。 */

import { describe, expect, it } from "vitest";
import {
  calculateCalorieSummary,
  recordTotalKcal,
} from "#lib/calorie-summary.ts";

const BASE_TIME_MS = new Date("2026-09-01T12:00:00.000Z").getTime();
const HOUR_MS = 60 * 60 * 1000;

/** 品目のkcalと数量、または一時項目のkcalを持つ記録1件。 */
type SummaryRow = {
  consumedAt: Date;
  quantity: number;
  itemKcal: number | null;
  temporaryName: string | null;
};

/** 最も古い記録を開始日として、指定時刻の摂取量を集計する。 */
function summarizeRows(
  rows: SummaryRow[],
  goalKcal = 1615,
  options: { tzOffsetMinutes?: number; firstRecordAt?: Date } = {},
) {
  const firstRecordAt =
    options.firstRecordAt ??
    rows
      .map((row) => row.consumedAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];
  return calculateCalorieSummary(
    rows.map((row) => ({
      consumedAt: row.consumedAt,
      totalKcal: recordTotalKcal(row),
    })),
    firstRecordAt,
    goalKcal,
    new Date(BASE_TIME_MS),
    options.tzOffsetMinutes ?? 0,
  );
}

/** 経過時間とkcalで指定した記録1件を返す */
function makeRow(elapsedHours: number, kcal = 100): SummaryRow {
  return {
    consumedAt: new Date(BASE_TIME_MS - elapsedHours * HOUR_MS),
    quantity: 1,
    itemKcal: kcal,
    temporaryName: null,
  };
}

/** 1日1500kcalを8時間間隔で3等分し、28日間続けた状態の記録 */
function steadyRows(): SummaryRow[] {
  return Array.from({ length: 84 }, (_, index) => makeRow(4 + index * 8, 500));
}

it("ペースは経過時間に応じた重みで数え、平均は期間の合計を日数で割る", () => {
  const summary = summarizeRows([0, 24, 48].map((h) => makeRow(h)));

  // ペースは重み1・e^-1・e^-2の合計150kcal、平均は3件の合計300kcalを日数で割った値
  expect(summary.periods).toEqual([
    { days: 1, dailyKcal: 150, percentage: 9.3 },
    { days: 7, dailyKcal: 43, percentage: 2.7 },
    { days: 28, dailyKcal: 11, percentage: 0.7 },
  ]);
});

it("7日間平均と28日間平均は期間の内側の記録だけを数える", () => {
  const summary = summarizeRows(
    [7 * 24 - 1, 7 * 24 + 1].map((h) => makeRow(h)),
  );

  // 7日間平均は7日以内の1件だけ、28日間平均は2件とも数える
  expect(summary.periods.map((period) => period.dailyKcal)).toEqual([0, 14, 7]);
});

it("目標どおりに食べ続けるとペースも平均も目標値と一致する", () => {
  const summary = summarizeRows(steadyRows(), 1500);

  // ペースは等比級数の和500×e^(-1/6)÷(1-e^(-1/3))=1493kcal
  expect(summary.periods).toEqual([
    { days: 1, dailyKcal: 1493, percentage: 99.5 },
    { days: 7, dailyKcal: 1500, percentage: 100 },
    { days: 28, dailyKcal: 1500, percentage: 100 },
  ]);
});

it("摂取した分だけペースが増える", () => {
  const rows = steadyRows();

  const before = summarizeRows(rows, 1500);
  const after = summarizeRows([makeRow(0, 500), ...rows], 1500);

  expect(after.periods[0].dailyKcal - before.periods[0].dailyKcal).toBe(500);
});

it("一定の速さで摂取し続けるとペースが1日当たり摂取量へ収束する", () => {
  const intervalMinutes = 6;
  const kcalPerRecord = 100;
  const rows = Array.from(
    { length: (14 * 24 * 60) / intervalMinutes },
    (_, index) => makeRow((index * intervalMinutes) / 60, kcalPerRecord),
  );

  const summary = summarizeRows(rows);

  const hourlyKcal = (kcalPerRecord * 60) / intervalMinutes;
  const expected = hourlyKcal * 24;
  const actual = summary.periods[0].dailyKcal;
  expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(0.005);
});

describe("達成状況", () => {
  // 時差0では2026-09-01T04:00Zが当日の開始で、それより前が確定日となる
  const TODAY_START_MS = new Date("2026-09-01T04:00:00.000Z").getTime();
  const LONG_AGO = new Date(TODAY_START_MS - 60 * 24 * HOUR_MS);

  /** 指定した日数前の確定日の正午（UTC）に摂取した記録を返す */
  function dayRow(daysAgo: number, kcal: number): SummaryRow {
    return {
      consumedAt: new Date(
        TODAY_START_MS - daysAgo * 24 * HOUR_MS + 8 * HOUR_MS,
      ),
      quantity: 1,
      itemKcal: kcal,
      temporaryName: null,
    };
  }

  function daysRows(from: number, to: number, kcal: number): SummaryRow[] {
    return Array.from({ length: to - from + 1 }, (_, index) =>
      dayRow(from + index, kcal),
    );
  }

  it("直近28確定日を古い順に並べ、当日を含めない", () => {
    const { achievement } = summarizeRows([], 1615, {
      firstRecordAt: LONG_AGO,
    });

    expect(achievement.days).toHaveLength(28);
    expect(achievement.days[0].date).toBe("2026/08/04");
    expect(achievement.days[27].date).toBe("2026/08/31");
  });

  it("早朝4時の区切りと端末の時差で記録の日を分ける", () => {
    const rows: SummaryRow[] = [
      // 時差0では前日の3:59、時差+9時間では当日の12:59
      {
        consumedAt: new Date("2026-09-01T03:59:00.000Z"),
        quantity: 1,
        itemKcal: 700,
        temporaryName: null,
      },
      // 時差0では当日の4:00
      {
        consumedAt: new Date("2026-09-01T04:00:00.000Z"),
        quantity: 1,
        itemKcal: 7000,
        temporaryName: null,
      },
    ];

    const utc = summarizeRows(rows, 1615, { firstRecordAt: LONG_AGO });
    const jst = summarizeRows(rows, 1615, {
      firstRecordAt: LONG_AGO,
      tzOffsetMinutes: 540,
    });

    expect(utc.achievement.latestAverageKcal).toBe(100);
    expect(jst.achievement.latestAverageKcal).toBe(0);
    expect(jst.achievement.days[27].date).toBe("2026/08/31");
  });

  it("今日の残量は朝4時以降の摂取量だけを1日目標から引き、過去の余裕や超過を含めない", () => {
    const rows = [
      ...daysRows(1, 6, 1000),
      dayRow(7, 9000),
      {
        consumedAt: new Date("2026-08-25T20:00:00.000Z"),
        quantity: 1,
        itemKcal: 100,
        temporaryName: null,
      },
      {
        consumedAt: new Date("2026-09-01T03:59:00.000Z"),
        quantity: 1,
        itemKcal: 200,
        temporaryName: null,
      },
      {
        consumedAt: new Date("2026-09-01T04:00:00.000Z"),
        quantity: 300,
        itemKcal: null,
        temporaryName: "朝食",
      },
    ];
    const utc = summarizeRows(rows, 1000, { firstRecordAt: LONG_AGO });
    const jst = summarizeRows(rows, 1000, {
      firstRecordAt: LONG_AGO,
      tzOffsetMinutes: 540,
    });
    // 時差0では3:59の200kcalは前日、4:00の300kcalだけが今日に入る
    expect(utc.achievement.todayRemainingKcal).toBe(700);
    // 日本時間では2件とも今日の4時以降なので、合計500kcalを引く
    expect(jst.achievement.todayRemainingKcal).toBe(500);

    const insufficient = summarizeRows(daysRows(1, 5, 1000), 1000);
    expect(insufficient.achievement.todayRemainingKcal).toBe(1000);
    const seventhDay = summarizeRows(daysRows(1, 6, 1000), 1000);
    expect(seventhDay.achievement.todayRemainingKcal).toBe(1000);
    const noRecords = summarizeRows([], 1750);
    expect(noRecords.achievement.todayRemainingKcal).toBe(1750);
    const firstDay = summarizeRows([dayRow(0, 300)], 1750);
    expect(firstDay.achievement.todayRemainingKcal).toBe(1450);
  });

  it("7日平均が目標と等しい日を達成とし、超えた日で連続日数が止まる", () => {
    // 昨日の窓（1〜7日前）は平均1000、一昨日の窓（2〜8日前）は平均1001
    const rows = [...daysRows(1, 7, 1000), dayRow(8, 1007)];

    const { achievement } = summarizeRows(rows, 1000, {
      firstRecordAt: LONG_AGO,
    });

    expect(achievement.days[27]).toEqual({
      date: "2026/08/31",
      averageKcal: 1000,
      status: "achieved",
    });
    expect(achievement.days[26].status).toBe("missed");
    expect(achievement.streakDays).toBe(1);
  });

  it("最初の記録の日より前へかかる窓は判定対象外とする", () => {
    const rows = daysRows(1, 8, 100);

    const { achievement } = summarizeRows(rows);

    // 8日前が最初の記録の日なので、1日前と2日前の窓だけが判定できる
    expect(achievement.days.slice(-2).map((day) => day.status)).toEqual([
      "achieved",
      "achieved",
    ]);
    expect(achievement.days[25]).toEqual({
      date: "2026/08/29",
      averageKcal: null,
      status: "unrated",
    });
    expect(achievement.streakDays).toBe(2);
  });

  it("記録が無い利用者はすべて判定対象外とする", () => {
    const { achievement } = summarizeRows([]);

    expect(achievement.days.every((day) => day.status === "unrated")).toBe(
      true,
    );
    expect(achievement.streakDays).toBe(0);
    expect(achievement.latestAverageKcal).toBeNull();
    expect(achievement.weeklyChangeKcal).toBeNull();
  });

  it("記録の無い日を0kcalとして平均へ含める", () => {
    // 30日前の記録だけがあり、以降の日は記録が無い
    const { achievement } = summarizeRows([dayRow(30, 700)]);

    // 24日前の窓（24〜30日前）は平均100、それより新しい窓は平均0で、いずれも達成
    expect(achievement.days[4]).toEqual({
      date: "2026/08/08",
      averageKcal: 100,
      status: "achieved",
    });
    expect(achievement.days[3].status).toBe("unrated");
    expect(achievement.latestAverageKcal).toBe(0);
    expect(achievement.streakDays).toBe(24);
  });

  it("28確定日すべてが達成なら連続日数は28となる", () => {
    const { achievement } = summarizeRows([], 1615, {
      firstRecordAt: LONG_AGO,
    });

    expect(achievement.streakDays).toBe(28);
  });

  it("先週比は昨日の7日平均から7日前の7日平均を引いた値とする", () => {
    const rows = [...daysRows(1, 7, 1000), ...daysRows(8, 14, 1500)];

    const decreased = summarizeRows(rows);
    const increased = summarizeRows([
      ...daysRows(1, 7, 1500),
      ...daysRows(8, 14, 1000),
    ]);

    expect(decreased.achievement.latestAverageKcal).toBe(1000);
    expect(decreased.achievement.weeklyChangeKcal).toBe(-500);
    expect(increased.achievement.weeklyChangeKcal).toBe(500);
  });

  it("7日前の窓が判定対象外なら先週比を算出しない", () => {
    const { achievement } = summarizeRows(daysRows(1, 10, 1000));

    expect(achievement.latestAverageKcal).toBe(1000);
    expect(achievement.weeklyChangeKcal).toBeNull();
  });
});
