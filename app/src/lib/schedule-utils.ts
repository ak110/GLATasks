/**
 * @fileoverview 定期TODOの繰り返しルール（RRULE文字列）から日本語の要約文を生成する
 *
 * `rrule@2.8.1` の `toText()` は英語専用のため使用しない。
 * `ScheduleList.svelte` から呼び出す共有ロジックとして `$lib` 直下に配置し、
 * サーバー・クライアント双方から参照できるようにする。
 */

import { RRule, rrulestr } from "rrule";

/** rrule の byweekday 数値表現（0=月曜〜6=日曜）に対応する日本語曜日名 */
const WEEKDAY_JA = ["月", "火", "水", "木", "金", "土", "日"] as const;

/** 数値配列を「・」区切りの文字列に変換する */
function joinNumbers(values: number[]): string {
  return values.join("・");
}

/**
 * RRULE文字列から日本語の繰り返し要約文を生成する。
 *
 * `rrule` はBYDAY・BYMONTHDAY・BYMONTHを明示指定しない場合でも、`options`（解決後の値）
 * へDTSTART由来の値を自動補完する。この自動補完値と利用者の明示指定を区別するため、
 * 利用者が実際に入力した値の有無は `origOptions` で判定し、表示する数値自体は
 * 解決後の `options` から取り出す。
 */
export function describeSchedule(rrule: string): string {
  const rule = rrulestr(rrule, { tzid: "Asia/Tokyo" });
  if (!(rule instanceof RRule)) {
    // RDATE/EXDATE等を含む RRuleSet は本アプリのスケジュールでは生成しないため、
    // 想定外の入力に対するフォールバック表示とする
    return "不明な繰り返し";
  }
  const { freq, interval } = rule.options;
  const orig = rule.origOptions;

  switch (freq) {
    case RRule.DAILY:
      return interval > 1 ? `${interval}日ごと` : "毎日";

    case RRule.WEEKLY: {
      if (orig.byweekday !== undefined) {
        const days = rule.options.byweekday
          .map((d) => `${WEEKDAY_JA[d]}曜日`)
          .join("・");
        return interval > 1 ? `${interval}週間ごとの${days}` : `毎週${days}`;
      }
      return interval > 1 ? `${interval}週間ごと` : "毎週";
    }

    case RRule.MONTHLY: {
      const bynweekday = rule.options.bynweekday ?? [];
      if (bynweekday.length > 0) {
        const desc = bynweekday
          .map(([weekday, n]) => `第${n}${WEEKDAY_JA[weekday]}曜日`)
          .join("・");
        return interval > 1 ? `${interval}か月ごとの${desc}` : `毎月${desc}`;
      }
      if (orig.bymonthday !== undefined) {
        const days = joinNumbers(rule.options.bymonthday);
        return interval > 1
          ? `${interval}か月ごとの${days}日`
          : `毎月${days}日`;
      }
      return interval > 1 ? `${interval}か月ごと` : "毎月";
    }

    case RRule.YEARLY: {
      if (orig.bymonth !== undefined && orig.bymonthday !== undefined) {
        const label = `${joinNumbers(rule.options.bymonth)}月${joinNumbers(rule.options.bymonthday)}日`;
        return interval > 1 ? `${interval}年ごとの${label}` : `毎年${label}`;
      }
      return interval > 1 ? `${interval}年ごと` : "毎年";
    }

    default:
      return "不明な繰り返し";
  }
}
