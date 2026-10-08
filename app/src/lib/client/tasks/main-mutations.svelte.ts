import { SvelteMap, SvelteDate } from "svelte/reactivity";
import { queryKeys } from "#lib/client/query-options.ts";
import { createMutation, type QueryClient } from "@tanstack/svelte-query";
import { trpc, type RouterInputs } from "#lib/client/trpc.ts";
import {
  createTempTaskId,
  type ActiveTasksCache,
} from "#lib/client/tasks/task-cache.ts";
import { getHeadSortOrder } from "#lib/task-order.ts";
import { splitTitle, splitNotes } from "#lib/text-split.ts";
import type { TaskListItem } from "#lib/types.ts";
import type { MainState } from "./main-state.svelte.ts";

export function createMainMutations(
  queryClient: QueryClient,
  state: MainState,
  resetActiveTasks: () => Promise<void>,
) {
  // リスト作成
  const createListMutation = createMutation(() => ({
    mutationFn: (title: RouterInputs["lists"]["create"]["title"]) =>
      trpc.lists.create.mutate({ title }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      state.addListTitle = "";
    },
  }));

  // タスク作成
  const createTaskMutation = createMutation(() => ({
    mutationFn: ({
      listId,
      text,
      tags,
      kind,
    }: RouterInputs["tasks"]["create"]) =>
      trpc.tasks.create.mutate({ listId, text, tags, kind }),
    onMutate: async ({
      listId,
      text,
      tags,
      kind,
    }: RouterInputs["tasks"]["create"]) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activeTasks });
      const tempId = createTempTaskId();
      queryClient.setQueryData<ActiveTasksCache>(
        queryKeys.activeTasks,
        (old) => {
          // キャッシュ未初期化の場合は楽観タスクを追加せず、
          // サーバー応答後の差分 sync に委ねる
          if (!old) return undefined;
          const optimisticTask: TaskListItem = {
            _key: tempId,
            id: tempId,
            listId,
            title: splitTitle(text),
            notes: splitNotes(text),
            status: "active",
            kind: kind ?? "normal",
            tags: tags ?? [],
            sortOrder: getHeadSortOrder(
              old.tasks
                .filter((task) => task.listId === listId)
                .map((task) => task.sortOrder),
            ),
            updated: new SvelteDate().toISOString(),
            attachments: [],
          };
          return { ...old, tasks: [...old.tasks, optimisticTask] };
        },
      );
      return { tempId };
    },
    onError: (_err, _vars, context) => {
      const tempId = context?.tempId;
      if (tempId === undefined) return;
      // 失敗時は作成操作が追加した仮IDのタスクだけを取り消し、並行操作の結果を保持する。
      queryClient.setQueryData<ActiveTasksCache>(
        queryKeys.activeTasks,
        (old) =>
          old
            ? {
                ...old,
                tasks: old.tasks.filter((t) => t.id !== tempId),
              }
            : old,
      );
    },
    onSuccess: (data, _vars, context) => {
      // 仮IDタスクを実IDで置き換える。DOMの連続性を保ちつつ正しいIDになる。
      const tempId = context?.tempId;
      if (tempId !== undefined) {
        queryClient.setQueryData<ActiveTasksCache>(
          queryKeys.activeTasks,
          (old) =>
            old
              ? {
                  ...old,
                  tasks: old.tasks.map((t) =>
                    t.id === tempId ? { ...t, id: data.taskId } : t,
                  ),
                }
              : old,
        );
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.activeTasks });
      // TODO区分で作成された場合の通知バッジ反映のため、リスト一覧も再取得する
      queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      state.addTaskText = "";
    },
  }));

  // タスク更新
  const updateTaskMutation = createMutation(() => ({
    mutationFn: (input: RouterInputs["tasks"]["update"]) =>
      trpc.tasks.update.mutate(input),
    onMutate: async (variables: RouterInputs["tasks"]["update"]) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activeTasks });
      const previousUpdated = queryClient
        .getQueryData<ActiveTasksCache>(queryKeys.activeTasks)
        ?.tasks.find((t) => t.id === variables.taskId)?.updated;
      // text変更かつkeepOrder=falseなら先頭移動（サーバーロジック踏襲）
      let optimisticSortOrder: number | undefined;
      if (variables.text !== undefined && variables.keepOrder !== true) {
        const prev2 = queryClient.getQueryData<ActiveTasksCache>(
          queryKeys.activeTasks,
        );
        const targetListId = variables.moveTo ?? variables.listId;
        const sameListTasks = (prev2?.tasks ?? []).filter(
          (t) => t.listId === targetListId,
        );
        optimisticSortOrder = getHeadSortOrder(
          sameListTasks.map((task) => task.sortOrder),
        );
      } else if (variables.moveTo !== undefined) {
        // moveTo のみの場合も移動先リストの先頭に楽観配置
        const prev2 = queryClient.getQueryData<ActiveTasksCache>(
          queryKeys.activeTasks,
        );
        const sameListTasks = (prev2?.tasks ?? []).filter(
          (t) => t.listId === variables.moveTo,
        );
        optimisticSortOrder = getHeadSortOrder(
          sameListTasks.map((task) => task.sortOrder),
        );
      }
      queryClient.setQueryData<ActiveTasksCache>(
        queryKeys.activeTasks,
        (old) => {
          if (!old) return old;
          return {
            ...old,
            tasks: old.tasks.map((t) => {
              if (t.id !== variables.taskId) return t;
              return {
                ...t,
                ...(variables.text !== undefined
                  ? {
                      title: splitTitle(variables.text),
                      notes: splitNotes(variables.text),
                    }
                  : {}),
                ...(variables.status !== undefined
                  ? { status: variables.status }
                  : {}),
                ...(variables.tags !== undefined
                  ? { tags: variables.tags }
                  : {}),
                ...(variables.kind !== undefined
                  ? { kind: variables.kind }
                  : {}),
                ...(variables.moveTo !== undefined
                  ? { listId: variables.moveTo }
                  : {}),
                ...(optimisticSortOrder !== undefined
                  ? { sortOrder: optimisticSortOrder }
                  : {}),
                updated: new SvelteDate().toISOString(),
              };
            }),
          };
        },
      );
      return { previousUpdated };
    },
    onError: (_error, _variables, context) => {
      // 差分取得はサーバー側で updated が変わっていないタスクを応答へ含めない。
      // 変更前の updated を起点に取り直し、失敗した楽観値を確定値で上書きする。
      const previousUpdated = context?.previousUpdated;
      if (previousUpdated !== undefined) {
        queryClient.setQueryData<ActiveTasksCache>(
          queryKeys.activeTasks,
          (old) => (old ? { ...old, serverTime: previousUpdated } : old),
        );
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.activeTasks });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activeTasks });
      // タスクが別リストへ移動された場合、または TODO 件数バッジに影響する
      // kind・status の変更を伴う場合はリスト一覧も更新する
      if (
        (variables.moveTo !== undefined &&
          variables.moveTo !== variables.listId) ||
        variables.kind !== undefined ||
        variables.status !== undefined
      ) {
        queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      }
    },
  }));

  // リスト削除
  const deleteListMutation = createMutation(() => ({
    mutationFn: (listId: RouterInputs["lists"]["delete"]["listId"]) =>
      trpc.lists.delete.mutate({ listId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    },
  }));

  // リスト名変更
  const renameListMutation = createMutation(() => ({
    mutationFn: ({ listId, title }: RouterInputs["lists"]["rename"]) =>
      trpc.lists.rename.mutate({ listId, title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    },
  }));

  // リストをアーカイブ
  const archiveListMutation = createMutation(() => ({
    mutationFn: (listId: RouterInputs["lists"]["archive"]["listId"]) =>
      trpc.lists.archive.mutate({ listId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    },
  }));

  // リストをアーカイブ解除
  const unarchiveListMutation = createMutation(() => ({
    mutationFn: (listId: RouterInputs["lists"]["unarchive"]["listId"]) =>
      trpc.lists.unarchive.mutate({ listId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    },
  }));

  // 完了済みタスククリア
  const clearListMutation = createMutation(() => ({
    mutationFn: (listId: RouterInputs["lists"]["clear"]["listId"]) =>
      trpc.lists.clear.mutate({ listId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activeTasks });
    },
  }));

  // リスト統合
  const mergeListMutation = createMutation(() => ({
    mutationFn: (input: RouterInputs["lists"]["merge"]) =>
      trpc.lists.merge.mutate(input),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules });
      await resetActiveTasks();
    },
  }));

  // タスク並び替え
  const reorderTasksMutation = createMutation(() => ({
    mutationFn: (input: RouterInputs["tasks"]["reorder"]) =>
      trpc.tasks.reorder.mutate(input),
    onMutate: async (input: RouterInputs["tasks"]["reorder"]) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activeTasks });
      const previousUpdated: string[] = [];
      const now = new SvelteDate().toISOString();
      const idxMap = new SvelteMap(input.taskIds.map((id, i) => [id, i]));
      queryClient.setQueryData<ActiveTasksCache>(
        queryKeys.activeTasks,
        (old) => {
          if (!old) return old;
          return {
            ...old,
            tasks: old.tasks.map((task) => {
              const newOrder = idxMap.get(task.id);
              if (newOrder === undefined) return task;
              previousUpdated.push(task.updated);
              return {
                ...task,
                sortOrder: newOrder,
                updated: now,
              };
            }),
          };
        },
      );
      return { previousUpdated };
    },
    onError: (_error, _input, context) => {
      const oldestUpdated = context?.previousUpdated.reduce<string | undefined>(
        (oldest, updated) =>
          oldest === undefined || updated < oldest ? updated : oldest,
        undefined,
      );
      if (oldestUpdated === undefined) return;
      queryClient.setQueryData<ActiveTasksCache>(
        queryKeys.activeTasks,
        (old) => (old ? { ...old, serverTime: oldestUpdated } : old),
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.activeTasks });
    },
  }));

  return {
    createListMutation,
    createTaskMutation,
    updateTaskMutation,
    deleteListMutation,
    renameListMutation,
    archiveListMutation,
    unarchiveListMutation,
    clearListMutation,
    mergeListMutation,
    reorderTasksMutation,
  };
}
