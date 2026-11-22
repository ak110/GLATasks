export type HasUpdated = { updated: Date };

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
    const start = i - 1;
    let j = i + 1;
    while (j < n && adjusted[j] > adjusted[start]) {
      j++;
    }
    const slice = adjusted.slice(start, j);
    slice.sort((a, b) => b - a);
    for (let k = 0; k < slice.length; k++) {
      adjusted[start + k] = slice[k];
    }
    i = j;
  }

  return adjusted;
}

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
