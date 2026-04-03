/**
 * @fileoverview リスト統合用のマージアルゴリズム（純粋関数、DB非依存）
 */

/** updated タイムスタンプを持つ要素 */
export type HasUpdated = { updated: Date };

/**
 * タスクの updated を sort_order と整合するよう補正する。
 *
 * sort_order 昇順で並んだタスクの updated が単調非増加でない箇所を検出し、
 * 矛盾区間内の updated を降順ソート（swap）して辻褄を合わせる。
 * 既存の updated 値を再利用するため、捏造値が発生しない。
 * @returns 補正後のタイムスタンプ配列（ミリ秒）
 */
export function adjustUpdatedTimestamps(tasksSorted: HasUpdated[]): number[] {
  const n = tasksSorted.length;
  if (n === 0) return [];
  const adjusted = tasksSorted.map((t) => t.updated.getTime());

  let i = 1;
  while (i < n) {
    if (adjusted[i] <= adjusted[i - 1]) {
      i++;
      continue;
    }
    // 矛盾発見: anchorStart から連続する矛盾区間を特定
    const start = i - 1;
    let j = i + 1;
    // 区間を広げる: adjusted[j] > adjusted[start] なら矛盾が続いている
    while (j < n && adjusted[j] > adjusted[start]) {
      j++;
    }
    // start から j-1 の区間を降順ソートで辻褄合わせ
    const slice = adjusted.slice(start, j);
    slice.sort((a, b) => b - a);
    for (let k = 0; k < slice.length; k++) {
      adjusted[start + k] = slice[k];
    }
    i = j;
  }

  return adjusted;
}

/**
 * マージソートのマージステップで2つのリストを統合する。
 *
 * 各リストは adjusted 降順（単調非増加）であることが前提。
 * adjusted が大きい（新しい）方を先にピックする。
 */
export function mergeByTimestamp<T extends { adjusted: number }>(
  listA: T[],
  listB: T[],
): T[] {
  const result: T[] = [];
  let a = 0;
  let b = 0;
  while (a < listA.length && b < listB.length) {
    if (listA[a].adjusted >= listB[b].adjusted) {
      result.push(listA[a++]);
    } else {
      result.push(listB[b++]);
    }
  }
  while (a < listA.length) result.push(listA[a++]);
  while (b < listB.length) result.push(listB[b++]);
  return result;
}
