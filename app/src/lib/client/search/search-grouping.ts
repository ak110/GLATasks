import type { SearchTaskResult } from "#lib/types.ts";

export type SearchResultGroup = {
  title: SearchTaskResult["listTitle"];
  tasks: SearchTaskResult[];
};

export function groupSearchResultsByList(
  results: SearchTaskResult[],
  selectedListId: number | null,
): Map<number, SearchResultGroup> {
  const groups = new Map<number, SearchResultGroup>();
  for (const task of results) {
    let group = groups.get(task.listId);
    if (!group) {
      group = { title: task.listTitle, tasks: [] };
      groups.set(task.listId, group);
    }
    group.tasks.push(task);
  }

  if (selectedListId === null || !groups.has(selectedListId)) return groups;

  const selected = groups.get(selectedListId)!;
  const reordered = new Map<number, SearchResultGroup>();
  reordered.set(selectedListId, selected);
  for (const [listId, group] of groups) {
    if (listId !== selectedListId) reordered.set(listId, group);
  }
  return reordered;
}
