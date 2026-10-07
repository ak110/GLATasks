/** 摂取ペース・期間平均・朝4時を区切りとする達成状況の純粋な集計。 */

import {
  DAY_MS,
  dayStartOf,
  formatLocalDate,
  toLocalDate,
} from "#lib/calorie-date.ts";

export type SummaryRow = { consumedAt: Date; totalKcal: number };

/**
 * 1件の記録の合計kcalを返す
 *
 * 一時項目は数量欄の値をkcalとして持ち、品目のkcalと掛け算しない。
 */
export function recordTotalKcal(row: {
  temporaryName: string | null;
  itemKcal: number | null;
  quantity: number;
}): number {
  if (row.temporaryName !== null) return row.quantity;
  if (row.itemKcal === null) {
    throw new Error("calorie_record_invalid_target");
  }
  return row.itemKcal * row.quantity;
}

/**
 * 直近の摂取ペースを1日当たりのkcalとして返す
 *
 * 摂取からの経過時間に対する重みを時定数24時間の指数減衰とし、重み付き合計を返す。
 * 重みを時間で積分すると24時間になるため、一定の速さで摂取し続けた場合の値は
 * 1日当たりの摂取量と一致する。
 * 窓の境界を持たないため、摂取から一定時間が過ぎた時点で値が不連続に減らない。
 * 摂取直後の重みが1であり、摂取したkcalがそのまま値へ加わる。
 */
function dailyPaceKcal(rows: SummaryRow[], now: Date): number {
  return rows.reduce(
    (sum, row) =>
      sum +
      row.totalKcal *
        Math.exp(-(now.getTime() - row.consumedAt.getTime()) / DAY_MS),
    0,
  );
}

/** 指定した日数の窓に入る記録から1日当たりの平均kcalを返す */
function averageDailyKcal(rows: SummaryRow[], now: Date, days: number): number {
  const start = now.getTime() - days * DAY_MS;
  const total = rows.reduce(
    (sum, row) =>
      row.consumedAt.getTime() >= start ? sum + row.totalKcal : sum,
    0,
  );
  return total / days;
}

/** 達成状況を表示する確定日の数 */
const ACHIEVEMENT_DAYS = 28;
/** 達成を判定する平均の日数 */
const ACHIEVEMENT_AVERAGE_DAYS = 7;

export type CalorieAchievementStatus = "achieved" | "missed" | "unrated";

export type CalorieAchievement = {
  /** 直近の確定日（古い順）。日付は区切り時刻で始まる日の現地の年月日 */
  days: Array<{
    date: string;
    averageKcal: number | null;
    status: CalorieAchievementStatus;
  }>;
  /** 昨日から遡って続く達成日の数（最大で`days`の件数） */
  streakDays: number;
  /** 昨日の7日平均。判定対象外ならnull */
  latestAverageKcal: number | null;
  /** 昨日の7日平均から7日前の7日平均を引いた値。いずれかが判定対象外ならnull */
  weeklyChangeKcal: number | null;
  /** 1日目標から今日（現地の朝4時以降）の摂取量を引いた残量 */
  todayRemainingKcal: number | null;
};

/**
 * 確定日ごとの7日平均から達成状況を求める
 *
 * 当日は摂取が続くため判定しない。7日の窓が最初の記録の日より前へかかる日は、
 * 記録を始める前の期間を0kcalとして達成扱いにしないよう判定対象外とする。
 * 記録の無い日は0kcalとして平均へ含める。
 */
function calculateAchievement(
  rows: SummaryRow[],
  firstRecordAt: Date | undefined,
  goal: number,
  now: Date,
  offsetMinutes: number,
): CalorieAchievement {
  const todayStart = dayStartOf(now, offsetMinutes).getTime();
  const firstDayStart =
    firstRecordAt === undefined
      ? undefined
      : dayStartOf(firstRecordAt, offsetMinutes).getTime();
  // totals[n]は当日からn日前の合計（n=0は当日の摂取済み量）
  const totals = Array.from(
    { length: ACHIEVEMENT_DAYS + ACHIEVEMENT_AVERAGE_DAYS },
    () => 0,
  );
  for (const row of rows) {
    const daysAgo = Math.ceil((todayStart - row.consumedAt.getTime()) / DAY_MS);
    if (daysAgo >= 0 && daysAgo < totals.length) {
      totals[daysAgo] += row.totalKcal;
    }
  }
  const averageOf = (daysAgo: number): number | undefined => {
    const windowStart =
      todayStart - (daysAgo + ACHIEVEMENT_AVERAGE_DAYS - 1) * DAY_MS;
    if (firstDayStart === undefined || windowStart < firstDayStart) {
      return undefined;
    }
    const sum = totals
      .slice(daysAgo, daysAgo + ACHIEVEMENT_AVERAGE_DAYS)
      .reduce((acc, value) => acc + value, 0);
    return sum / ACHIEVEMENT_AVERAGE_DAYS;
  };

  // 新しい順に求めてから古い順へ並べ替える
  const newestFirst = Array.from({ length: ACHIEVEMENT_DAYS }, (_, index) => {
    const daysAgo = index + 1;
    const average = averageOf(daysAgo);
    const averageKcal = average === undefined ? null : Math.round(average);
    const status: CalorieAchievementStatus =
      averageKcal === null
        ? "unrated"
        : averageKcal <= goal
          ? "achieved"
          : "missed";
    return {
      date: formatLocalDate(
        toLocalDate(new Date(todayStart - daysAgo * DAY_MS), offsetMinutes),
      ),
      averageKcal: averageKcal,
      status,
    };
  });
  const missedIndex = newestFirst.findIndex((day) => day.status !== "achieved");
  const latest = averageOf(1);
  const previous = averageOf(1 + ACHIEVEMENT_AVERAGE_DAYS);
  return {
    days: [...newestFirst].reverse(),
    streakDays: missedIndex === -1 ? ACHIEVEMENT_DAYS : missedIndex,
    latestAverageKcal: latest === undefined ? null : Math.round(latest),
    weeklyChangeKcal:
      latest === undefined || previous === undefined
        ? null
        : Math.round(latest - previous),
    todayRemainingKcal: goal - totals[0],
  };
}

export function calculateCalorieSummary(
  rows: SummaryRow[],
  firstRecordAt: Date | undefined,
  goal: number,
  now: Date,
  offsetMinutes: number,
) {
  const periods = ([1, 7, 28] as const).map((days) => {
    const value =
      days === 1 ? dailyPaceKcal(rows, now) : averageDailyKcal(rows, now, days);
    return {
      days,
      dailyKcal: Math.round(value),
      percentage: Math.round((value / goal) * 1000) / 10,
    };
  });
  return {
    goalKcal: goal,
    periods,
    achievement: calculateAchievement(
      rows,
      firstRecordAt,
      goal,
      now,
      offsetMinutes,
    ),
  };
}

/** 集計に必要な最も古い時刻を返す。 */
export function calorieSummaryStart(now: Date, offsetMinutes: number): Date {
  return new Date(
    Math.min(
      now.getTime() - 28 * DAY_MS,
      dayStartOf(now, offsetMinutes).getTime() -
        (ACHIEVEMENT_DAYS + ACHIEVEMENT_AVERAGE_DAYS - 1) * DAY_MS,
    ),
  );
}
