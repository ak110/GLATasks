<script lang="ts">
    /**
     * @fileoverview タスクメモ管理メインページ（リスト一覧 + タスク一覧）
     */

    import {
        createQuery,
        createMutation,
        useQueryClient,
    } from "@tanstack/svelte-query";
    import { trpc, tabId, type RouterOutputs } from "$lib/trpc";
    import { subscribeOnMount } from "$lib/sse-subscribe";
    import { SSE_EVENTS } from "$lib/sse-events";
    import { debugLog } from "$lib/debug-log";
    import { showErrorToast } from "$lib/toast-store.svelte";
    import { extractErrorMessage } from "$lib/extract-error-message";
    import { uploadAttachment } from "$lib/attachment-utils";
    import { onMount } from "svelte";
    import { SvelteSet, SvelteMap } from "svelte/reactivity";
    import type { TaskStatus, TaskKind } from "$lib/schemas";
    import type {
        TagInfo,
        SearchTaskResult,
        TaskListItem,
        GetActiveTasksResult,
        GetTasksResult,
    } from "$lib/types";
    import {
        mergeActiveTasks,
        sortByListAndOrder,
        filterByList,
        type ActiveTasksCache,
    } from "$lib/task-cache";
    import { splitTitle, splitNotes } from "$lib/text-split";
    import { compareTagName } from "$lib/tag-sort";
    import Header from "$lib/components/layout/Header.svelte";
    import ListSidebar from "$lib/components/lists/ListSidebar.svelte";
    import TaskList from "$lib/components/tasks/TaskList.svelte";
    import TaskAddForm from "$lib/components/tasks/TaskAddForm.svelte";
    import TaskListHeader from "$lib/components/tasks/TaskListHeader.svelte";
    import TaskEditDialog from "$lib/components/tasks/TaskEditDialog.svelte";
    import MergeListDialog from "$lib/components/lists/MergeListDialog.svelte";
    import ScheduleDialog from "$lib/components/schedules/ScheduleDialog.svelte";
    import SearchResults from "$lib/components/search/SearchResults.svelte";
    import ConfirmDialog from "$lib/components/dialogs/ConfirmDialog.svelte";
    import PromptDialog from "$lib/components/dialogs/PromptDialog.svelte";

    let selectedListId = $state<number | null>(null);
    let showType = $state<"active" | "archived" | "all">("active");
    // 他端末で更新されたタスクのIDセット（リスト切り替えでクリア）
    let updatedTaskIds = new SvelteSet<number>();
    let addListTitle = $state("");
    let addTaskText = $state("");
    let openMenuId = $state<number | null>(null);
    let dragOverListId = $state<number | null>(null);
    let hasHash = $state(false);
    let searchQuery = $state("");
    let debouncedQuery = $state("");
    let taskList = $state<{ scrollToTop: () => void }>();
    const mobileView = $derived(
        hasHash ? ("tasks" as const) : ("lists" as const),
    );

    // タスク編集ダイアログの状態
    type EditDialog = {
        open: boolean;
        listId: number;
        taskId: number;
        text: string;
        moveTo: string;
        completed: boolean;
        tags: TagInfo[];
        kind: TaskKind;
    };
    let editDialog = $state<EditDialog>({
        open: false,
        listId: 0,
        taskId: 0,
        text: "",
        moveTo: "",
        completed: false,
        tags: [],
        kind: "normal",
    });

    // 定期TODOスケジュール管理ダイアログの対象リストID（null は非表示）
    let schedulesDialogListId = $state<number | null>(null);

    // リスト統合ダイアログの状態
    type MergeDialog = {
        open: boolean;
        sourceListId: number;
        sourceTitle: string;
        taskCount: number;
    };
    let mergeDialog = $state<MergeDialog>({
        open: false,
        sourceListId: 0,
        sourceTitle: "",
        taskCount: 0,
    });

    // リスト削除確認ダイアログの状態
    type ConfirmDeleteListDialog = {
        open: boolean;
        listId: number;
    };
    let confirmDeleteListDialog = $state<ConfirmDeleteListDialog>({
        open: false,
        listId: 0,
    });

    // リストアーカイブ確認ダイアログの状態
    type ConfirmArchiveListDialog = {
        open: boolean;
        listId: number;
    };
    let confirmArchiveListDialog = $state<ConfirmArchiveListDialog>({
        open: false,
        listId: 0,
    });

    // リスト名変更入力ダイアログの状態
    type RenameListDialog = {
        open: boolean;
        listId: number;
        currentTitle: string;
    };
    let renameListDialog = $state<RenameListDialog>({
        open: false,
        listId: 0,
        currentTitle: "",
    });

    const queryClient = useQueryClient();

    // 検索クエリの debounce（300ms）
    // searchQuery の変更ごとにタイマーをリセットし、入力停止後に検索を実行する
    $effect(() => {
        const q = searchQuery;
        const timer = setTimeout(() => (debouncedQuery = q), 300);
        return () => clearTimeout(timer);
    });

    // リスト一覧取得
    const listsQuery = createQuery<RouterOutputs["lists"]["list"]>(() => ({
        queryKey: ["lists", showType] as const,
        queryFn: () => trpc.lists.list.query(showType),
    }));

    // 全アクティブタスク一括取得（SSE でリアルタイム差分同期）
    // selectedListId に依存しないため、ページロード時に即実行する
    const tasksQuery = createQuery<ActiveTasksCache>(() => ({
        queryKey: ["activeTasks"] as const,
        queryFn: async (): Promise<ActiveTasksCache> => {
            const prev = queryClient.getQueryData<ActiveTasksCache>([
                "activeTasks",
            ]);
            const response: GetActiveTasksResult =
                await trpc.tasks.listActive.query({
                    since: prev?.serverTime,
                });
            return mergeActiveTasks(prev, response);
        },
        staleTime: Infinity,
    }));

    // アーカイブタスク取得（showType="archived" のときのみ起動）
    const archivedTasksQuery = createQuery<GetTasksResult>(() => ({
        queryKey: ["tasks", selectedListId, "archived"] as const,
        enabled: showType === "archived" && selectedListId !== null,
        queryFn: () =>
            trpc.tasks.list.query({
                listId: selectedListId!,
                showType: "archived",
            }),
    }));

    // 全文検索クエリ
    const searchResultsQuery = createQuery<RouterOutputs["tasks"]["search"]>(
        () => ({
            queryKey: ["search", debouncedQuery] as const,
            queryFn: () =>
                trpc.tasks.search.query({
                    query: debouncedQuery,
                }),
            enabled: debouncedQuery.length > 0,
        }),
    );

    // リスト集合の id+status に変化があった場合のみアクティブタスクキャッシュをリセットする
    // rename はリセット不要、archive/unarchive/delete/merge はリセット要
    async function syncLists(): Promise<void> {
        debugLog("sync", "lists");
        const prevLists =
            queryClient.getQueryData<RouterOutputs["lists"]["list"]>([
                "lists",
                showType,
            ]) ?? [];
        const prevKey = JSON.stringify(
            prevLists.map((l) => `${l.id}:${l.status}`).sort(),
        );
        await queryClient.invalidateQueries({ queryKey: ["lists"] });
        const newLists =
            queryClient.getQueryData<RouterOutputs["lists"]["list"]>([
                "lists",
                showType,
            ]) ?? [];
        const newKey = JSON.stringify(
            newLists.map((l) => `${l.id}:${l.status}`).sort(),
        );
        if (prevKey !== newKey) {
            debugLog("sync", "lists-reset-cache");
            // 物理削除追従のためアクティブタスクキャッシュをundefined化し、
            // 次のfetchで since 未指定の fullモードリクエストを実行する。
            queryClient.setQueryData<ActiveTasksCache | undefined>(
                ["activeTasks"],
                () => undefined,
            );
            await queryClient.invalidateQueries({
                queryKey: ["activeTasks"],
            });
            // 注: 本ハンドラは async で動作するため、tasksUpdated と並走した場合
            // updatedTaskIds の差分検知が空キャッシュを参照する可能性がある。
            // その場合 updatedTaskIds が一時的に空になるが、後続のSSE/操作で復元されるので許容。
        }
    }

    // タスク更新の再取得。自分のタブ発のSSEは差分同期のみ、それ以外（他タブ/他端末・
    // フォールバック経路）はスナップショット比較で変更タスクIDを `updatedTaskIds` へ反映する。
    async function syncTasks(fromOwnTab: boolean): Promise<void> {
        debugLog("sync", "tasks", { fromOwnTab });
        // アーカイブモード時は archived 用クエリも無効化する
        if (showType === "archived") {
            await queryClient.invalidateQueries({
                queryKey: ["tasks", selectedListId, "archived"],
            });
        }
        // TODO件数バッジはリスト一覧クエリ由来のため、タスクの完了/未完了切替や
        // kind変更の都度、リスト一覧も再取得して反映する
        await queryClient.invalidateQueries({ queryKey: ["lists"] });
        if (fromOwnTab) {
            await queryClient.invalidateQueries({ queryKey: ["activeTasks"] });
            return;
        }
        const oldCache = queryClient.getQueryData<ActiveTasksCache>([
            "activeTasks",
        ]);
        const oldMap = new Map(
            (oldCache?.tasks ?? []).map((t) => [
                t.id,
                `${t.title}\0${t.notes}\0${t.status}`,
            ]),
        );
        await queryClient.invalidateQueries({ queryKey: ["activeTasks"] });
        const newCache = queryClient.getQueryData<ActiveTasksCache>([
            "activeTasks",
        ]);
        for (const task of newCache?.tasks ?? []) {
            const oldKey = oldMap.get(task.id);
            const newKey = `${task.title}\0${task.notes}\0${task.status}`;
            if (oldKey === undefined || oldKey !== newKey) {
                updatedTaskIds.add(task.id);
            }
        }
    }

    // 定期TODOスケジュール一覧の再取得
    async function syncSchedules(): Promise<void> {
        debugLog("sync", "schedules");
        await queryClient.invalidateQueries({ queryKey: ["schedules"] });
    }

    // SSE: サーバーからの通知でクエリを再取得（フォールバックはSSE不健全時のポーリング経路）
    subscribeOnMount({
        [SSE_EVENTS.listsUpdated]: {
            handler: () => {
                void syncLists();
            },
            fallback: syncLists,
        },
        [SSE_EVENTS.tasksUpdated]: {
            handler: (e) => {
                const fromOwnTab = e.data === tabId;
                debugLog("sync", "tasks-received", {
                    fromOwnTab,
                    sourceTabId: e.data,
                });
                void syncTasks(fromOwnTab);
            },
            // フォールバック経路は発信元タブを判別できないため、常に他端末扱いで差分検出する
            fallback: () => syncTasks(false),
        },
        [SSE_EVENTS.schedulesUpdated]: {
            handler: () => {
                void syncSchedules();
            },
            fallback: syncSchedules,
        },
    });
    // ドラッグ終了時にサイドバーのハイライトをリセット
    onMount(() => {
        const clearDragOver = () => (dragOverListId = null);
        document.addEventListener("dragend", clearDragOver);
        return () => {
            document.removeEventListener("dragend", clearDragOver);
        };
    });

    // リスト作成
    const createListMutation = createMutation(() => ({
        mutationFn: (title: string) => trpc.lists.create.mutate({ title }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["lists"] });
            addListTitle = "";
        },
    }));

    // タスク作成
    const createTaskMutation = createMutation(() => ({
        mutationFn: ({
            listId,
            text,
            tags,
            kind,
        }: {
            listId: number;
            text: string;
            tags?: TagInfo[];
            kind?: TaskKind;
        }) => trpc.tasks.create.mutate({ listId, text, tags, kind }),
        onMutate: async ({
            listId,
            text,
            tags,
            kind,
        }: {
            listId: number;
            text: string;
            tags?: TagInfo[];
            kind?: TaskKind;
        }) => {
            await queryClient.cancelQueries({ queryKey: ["activeTasks"] });
            const prev = queryClient.getQueryData<ActiveTasksCache>([
                "activeTasks",
            ]);
            const tempId = -Date.now();
            queryClient.setQueryData<ActiveTasksCache>(
                ["activeTasks"],
                (old) => {
                    // キャッシュ未初期化の場合は楽観タスクを追加せず、
                    // サーバー応答後の差分 sync に委ねる
                    if (!old) return undefined;
                    const minOrder =
                        old.tasks.length > 0
                            ? Math.min(...old.tasks.map((t) => t.sort_order))
                            : 0;
                    const optimisticTask: TaskListItem = {
                        _key: tempId,
                        id: tempId,
                        listId,
                        title: splitTitle(text),
                        notes: splitNotes(text),
                        status: "active",
                        kind: kind ?? "normal",
                        tags: tags ?? [],
                        sort_order: minOrder - 1000,
                        updated: new Date().toISOString(),
                        attachments: [],
                    };
                    return { ...old, tasks: [...old.tasks, optimisticTask] };
                },
            );
            return { prev, tempId };
        },
        onError: (_err, _vars, context) => {
            if (context?.prev !== undefined) {
                queryClient.setQueryData(["activeTasks"], context.prev);
            }
        },
        onSuccess: (data, _vars, context) => {
            // 仮IDタスクを実IDで置き換える。DOMの連続性を保ちつつ正しいIDになる。
            const tempId = context?.tempId;
            if (tempId !== undefined) {
                queryClient.setQueryData<ActiveTasksCache>(
                    ["activeTasks"],
                    (old) =>
                        old
                            ? {
                                  ...old,
                                  tasks: old.tasks.map((t) =>
                                      t.id === tempId
                                          ? { ...t, id: data.taskId }
                                          : t,
                                  ),
                              }
                            : old,
                );
                // 編集ダイアログが楽観タスクを参照していた場合、taskIdを実IDに更新する
                if (editDialog.taskId === tempId) {
                    editDialog.taskId = data.taskId;
                }
            }
            queryClient.invalidateQueries({ queryKey: ["activeTasks"] });
            // TODO区分で作成された場合の通知バッジ反映のため、リスト一覧も再取得する
            queryClient.invalidateQueries({ queryKey: ["lists"] });
            addTaskText = "";
        },
    }));

    // タスク更新
    const updateTaskMutation = createMutation(() => ({
        mutationFn: (input: {
            listId: number;
            taskId: number;
            text?: string;
            status?: TaskStatus;
            completed?: string | null;
            move_to?: number;
            keep_order?: boolean;
            tags?: TagInfo[];
            kind?: TaskKind;
        }) => trpc.tasks.update.mutate(input),
        onMutate: async (variables: {
            listId: number;
            taskId: number;
            text?: string;
            status?: TaskStatus;
            completed?: string | null;
            move_to?: number;
            keep_order?: boolean;
            tags?: TagInfo[];
            kind?: TaskKind;
        }) => {
            await queryClient.cancelQueries({ queryKey: ["activeTasks"] });
            const prev = queryClient.getQueryData<ActiveTasksCache>([
                "activeTasks",
            ]);
            // text変更かつkeep_order=falseなら先頭移動（サーバーロジック踏襲）
            let optimisticSortOrder: number | undefined;
            if (variables.text !== undefined && variables.keep_order !== true) {
                const prev2 = queryClient.getQueryData<ActiveTasksCache>([
                    "activeTasks",
                ]);
                const targetListId = variables.move_to ?? variables.listId;
                const sameListTasks = (prev2?.tasks ?? []).filter(
                    (t) => t.listId === targetListId,
                );
                const minOrder =
                    sameListTasks.length > 0
                        ? Math.min(...sameListTasks.map((t) => t.sort_order))
                        : 1000;
                optimisticSortOrder = minOrder - 1000;
            } else if (variables.move_to !== undefined) {
                // move_to のみの場合も移動先リストの先頭に楽観配置
                const prev2 = queryClient.getQueryData<ActiveTasksCache>([
                    "activeTasks",
                ]);
                const sameListTasks = (prev2?.tasks ?? []).filter(
                    (t) => t.listId === variables.move_to,
                );
                const minOrder =
                    sameListTasks.length > 0
                        ? Math.min(...sameListTasks.map((t) => t.sort_order))
                        : 1000;
                optimisticSortOrder = minOrder - 1000;
            }
            queryClient.setQueryData<ActiveTasksCache>(
                ["activeTasks"],
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
                                ...(variables.move_to !== undefined
                                    ? { listId: variables.move_to }
                                    : {}),
                                ...(optimisticSortOrder !== undefined
                                    ? { sort_order: optimisticSortOrder }
                                    : {}),
                                updated: new Date().toISOString(),
                            };
                        }),
                    };
                },
            );
            return { prev };
        },
        onError: (_err, _vars, context) => {
            if (context?.prev !== undefined) {
                queryClient.setQueryData(["activeTasks"], context.prev);
            }
        },
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["activeTasks"] });
            // タスクが別リストへ移動された場合、または TODO 件数バッジに影響する
            // kind・status の変更を伴う場合はリスト一覧も更新する
            if (
                (variables.move_to !== undefined &&
                    variables.move_to !== variables.listId) ||
                variables.kind !== undefined ||
                variables.status !== undefined
            ) {
                queryClient.invalidateQueries({ queryKey: ["lists"] });
            }
        },
    }));

    // リスト削除
    const deleteListMutation = createMutation(() => ({
        mutationFn: (listId: number) => trpc.lists.delete.mutate({ listId }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["lists"] });
        },
    }));

    // リスト名変更
    const renameListMutation = createMutation(() => ({
        mutationFn: ({ listId, title }: { listId: number; title: string }) =>
            trpc.lists.rename.mutate({ listId, title }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["lists"] });
        },
    }));

    // リストをアーカイブ
    const archiveListMutation = createMutation(() => ({
        mutationFn: (listId: number) => trpc.lists.archive.mutate({ listId }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["lists"] });
        },
    }));

    // リストをアーカイブ解除
    const unarchiveListMutation = createMutation(() => ({
        mutationFn: (listId: number) => trpc.lists.unarchive.mutate({ listId }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["lists"] });
        },
    }));

    // 完了済みタスククリア
    const clearListMutation = createMutation(() => ({
        mutationFn: (listId: number) => trpc.lists.clear.mutate({ listId }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["activeTasks"] });
        },
    }));

    // リスト統合
    const mergeListMutation = createMutation(() => ({
        mutationFn: (input: { sourceListId: number; targetListId: number }) =>
            trpc.lists.merge.mutate(input),
        onSuccess: async () => {
            queryClient.invalidateQueries({ queryKey: ["lists"] });
            queryClient.invalidateQueries({ queryKey: ["schedules"] });
            // リスト統合は物理削除を伴うためキャッシュをundefined化してフル再取得する
            queryClient.setQueryData<ActiveTasksCache | undefined>(
                ["activeTasks"],
                () => undefined,
            );
            await queryClient.invalidateQueries({ queryKey: ["activeTasks"] });
        },
    }));

    // タスク並び替え
    const reorderTasksMutation = createMutation(() => ({
        mutationFn: (input: { listId: number; taskIds: number[] }) =>
            trpc.tasks.reorder.mutate(input),
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ["activeTasks"] });
        },
    }));

    // 派生状態
    const lists = $derived(listsQuery.data ?? []);
    const tasks = $derived.by((): TaskListItem[] => {
        if (showType === "archived") {
            const data = archivedTasksQuery.data;
            if (!data || !("data" in data)) return [];
            return data.data.map((t) => ({
                _key: t.id,
                id: t.id,
                listId: selectedListId!,
                title: t.title,
                notes: t.notes,
                status: t.status,
                kind: t.kind,
                tags: t.tags,
                sort_order: 0,
                updated: "",
                attachments: t.attachments,
            }));
        }
        const cache = tasksQuery.data;
        if (!cache || selectedListId === null) return [];
        return sortByListAndOrder(
            filterByList(cache.tasks, selectedListId, showType),
        );
    });
    // 編集ダイアログ対象タスクの添付一覧。tasksキャッシュから常に最新値を導出する
    const editDialogAttachments = $derived(
        tasks.find((t) => t.id === editDialog.taskId)?.attachments ?? [],
    );
    // 同一リスト内で既に使われているタグ候補（名前ユニーク、同名は最初の色を採用）
    const listTagCandidates = $derived.by(() => {
        const seen = new SvelteMap<string, TagInfo>();
        for (const t of tasks) {
            for (const tag of t.tags) {
                if (!seen.has(tag.name)) seen.set(tag.name, tag);
            }
        }
        return [...seen.values()].sort(compareTagName);
    });
    const isLoading = $derived(
        listsQuery.isLoading ||
            tasksQuery.isLoading ||
            (showType === "archived" && archivedTasksQuery.isLoading),
    );
    const isSearching = $derived(debouncedQuery.length > 0);
    const searchResults = $derived(searchResultsQuery.data ?? []);
    // 検索結果をリスト名でグループ化
    const searchResultsByList = $derived.by(() => {
        const map = new SvelteMap<
            number,
            { title: string; tasks: SearchTaskResult[] }
        >();
        for (const task of searchResults) {
            let group = map.get(task.listId);
            if (!group) {
                group = { title: task.listTitle, tasks: [] };
                map.set(task.listId, group);
            }
            group.tasks.push(task);
        }
        return map;
    });

    // URLハッシュからリストIDを解析
    function parseHashListId(): number | null {
        const hash = window.location.hash;
        if (!hash || hash === "#") return null;
        const id = parseInt(hash.substring(1));
        return isNaN(id) ? null : id;
    }

    // hashchange イベントで URL ハッシュと状態を同期
    // ブラウザのバック/フォワード操作やモバイルのリスト⇔タスク画面遷移を検知する
    $effect(() => {
        function onHashChange() {
            const hashId = parseHashListId();
            hasHash = hashId !== null;
            if (hashId !== null) {
                selectedListId = hashId;
                localStorage.setItem("selectedList", String(hashId));
            }
        }
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
    });

    // リストデータ到着時に選択状態を復元（初回のみ）
    // URLハッシュ > URL パラメータ `list` > localStorage の優先順
    // SSR ではなく $effect で行う理由: window/localStorage/location はブラウザ専用 API のため
    $effect(() => {
        if (lists.length > 0 && selectedListId === null) {
            // URLハッシュ（ブックマーク・直接アクセス等）
            const hashId = parseHashListId();
            if (hashId && lists.some((l) => l.id === hashId)) {
                selectedListId = hashId;
                hasHash = true;
                localStorage.setItem("selectedList", String(hashId));
                return;
            }

            // URL パラメータ（share/ingest からのリダイレクト等、互換性のため残す）
            const urlListId = Number(
                new URLSearchParams(window.location.search).get("list"),
            );
            if (urlListId && lists.some((l) => l.id === urlListId)) {
                selectedListId = urlListId;
                localStorage.setItem("selectedList", String(urlListId));
                // ?list= をハッシュに置換
                history.replaceState(
                    {},
                    "",
                    window.location.pathname + "#" + urlListId,
                );
                hasHash = true;
                return;
            }

            // localStorage フォールバック（ハッシュは付けない → モバイルではリスト一覧から）
            const saved = localStorage.getItem("selectedList");
            const savedId = saved ? parseInt(saved) : null;
            const initial = lists.find((l) => l.id === savedId) ?? lists[0];
            if (initial) {
                selectedListId = initial.id;
                localStorage.setItem("selectedList", String(initial.id));
            }
        }

        // 無効なハッシュ対策: リストデータにハッシュのIDが存在しなければハッシュを除去
        if (lists.length > 0 && hasHash) {
            const hashId = parseHashListId();
            if (hashId && !lists.some((l) => l.id === hashId)) {
                hasHash = false;
                history.replaceState(
                    {},
                    "",
                    window.location.pathname + window.location.search,
                );
            }
        }
    });

    function selectList(listId: number) {
        selectedListId = listId;
        addTaskText = "";
        updatedTaskIds.clear();
        // ハッシュ更新 → hashchange イベントで hasHash と localStorage が同期される
        location.hash = "#" + listId;
    }

    async function changeShowType(type: "active" | "archived" | "all") {
        showType = type;
        updatedTaskIds.clear();
        await queryClient.invalidateQueries({ queryKey: ["lists"] });
        if (!lists.some((l) => l.id === selectedListId)) {
            const first = lists[0];
            if (first) selectList(first.id);
            else selectedListId = null;
        }
    }

    async function addList() {
        const title = addListTitle.trim();
        if (!title) return;
        try {
            await createListMutation.mutateAsync(title);
            const newLists = lists;
            const newList = newLists[newLists.length - 1];
            if (newList) selectList(newList.id);
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    async function addTask(data: {
        text: string;
        tags: TagInfo[];
        attachments: File[];
        kind: TaskKind;
    }): Promise<boolean> {
        if (!selectedListId) return false;
        const text = data.text.trimEnd();
        if (!text) return false;
        const listId = selectedListId;
        try {
            const result = await createTaskMutation.mutateAsync({
                listId,
                text,
                tags: data.tags,
                kind: data.kind,
            });
            await uploadTaskAttachments(result.taskId, data.attachments);
            if (selectedListId === listId && showType !== "archived") {
                taskList?.scrollToTop();
            }
            return true;
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
            return false;
        }
    }

    /** タスク作成成功後、選択済み添付ファイルを順次送信する。個別失敗はタスク自体を残したまま通知する */
    async function uploadTaskAttachments(taskId: number, files: File[]) {
        for (const file of files) {
            try {
                await uploadAttachment(taskId, file);
            } catch (error) {
                showErrorToast(extractErrorMessage(error));
            }
        }
        if (files.length > 0) handleAttachmentChange();
    }

    async function toggleTask(taskId: number, checked: boolean) {
        if (!selectedListId) return;
        const taskData = checked
            ? { status: "completed" as const }
            : { status: "active" as const, completed: null };
        try {
            await updateTaskMutation.mutateAsync({
                listId: selectedListId,
                taskId,
                ...taskData,
            });
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    // 添付ファイル追加・削除完了後の呼び出し。SSE経由の反映を待たず同一タブへ即時反映する
    function handleAttachmentChange() {
        queryClient.invalidateQueries({ queryKey: ["activeTasks"] });
        queryClient.invalidateQueries({
            queryKey: ["tasks", selectedListId, "archived"],
        });
    }

    function openEditDialog(task: TaskListItem) {
        const text = task.notes ? `${task.title}\n\n${task.notes}` : task.title;
        editDialog = {
            open: true,
            listId: selectedListId!,
            taskId: task.id,
            text,
            moveTo: String(selectedListId!),
            completed: task.status === "completed",
            tags: task.tags,
            kind: task.kind,
        };
    }

    async function submitTaskEdit(data: {
        text: string;
        moveTo: string;
        completed: boolean;
        tags: TagInfo[];
        kind: TaskKind;
        closeAfter: boolean;
    }) {
        const { listId, taskId, completed: wasCompleted } = editDialog;

        // 完了状態の変更（toggleTask と同じロジック）
        const statusChange =
            data.completed !== wasCompleted
                ? data.completed
                    ? { status: "completed" as const }
                    : { status: "active" as const, completed: null }
                : {};

        try {
            await updateTaskMutation.mutateAsync({
                listId,
                taskId,
                text: data.text,
                move_to: Number(data.moveTo),
                // 「保存」（closeAfter=false）は編集続行のため並び順を維持し、
                // 「保存して閉じる」（closeAfter=true）は並び順を更新して閉じる。
                // 移動先リストが現在のリストと異なる場合は、サーバー側仕様で
                // keep_order に関わらず移動先リストの先頭へ配置される
                keep_order: !data.closeAfter,
                tags: data.tags,
                kind: data.kind,
                ...statusChange,
            });

            if (data.closeAfter) {
                editDialog.open = false;
            } else {
                // 保存後もダイアログを開いたままにする経路では、後続保存時の statusChange 判定や
                // 対象リスト判定が古い値で行われないよう、保持値を保存後の値へ同期する
                editDialog.listId = Number(data.moveTo);
                editDialog.completed = data.completed;
                editDialog.text = data.text;
                editDialog.moveTo = data.moveTo;
                editDialog.tags = data.tags;
                editDialog.kind = data.kind;
            }

            if (Number(data.moveTo) !== listId) {
                queryClient.invalidateQueries({ queryKey: ["lists"] });
            }
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    function renameList(listId: number, currentTitle: string) {
        renameListDialog = { open: true, listId, currentTitle };
    }

    async function submitRenameList(newTitle: string) {
        const { listId, currentTitle } = renameListDialog;
        renameListDialog.open = false;
        if (!newTitle || newTitle === currentTitle) return;
        try {
            await renameListMutation.mutateAsync({ listId, title: newTitle });
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    function deleteList(listId: number) {
        confirmDeleteListDialog = { open: true, listId };
    }

    async function submitDeleteList() {
        const { listId } = confirmDeleteListDialog;
        confirmDeleteListDialog.open = false;
        try {
            await deleteListMutation.mutateAsync(listId);
            if (selectedListId === listId) {
                const first = lists[0];
                if (first) selectList(first.id);
                else selectedListId = null;
            }
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    function archiveList(listId: number) {
        confirmArchiveListDialog = { open: true, listId };
    }

    async function submitArchiveList() {
        const { listId } = confirmArchiveListDialog;
        confirmArchiveListDialog.open = false;
        try {
            await archiveListMutation.mutateAsync(listId);
            if (selectedListId === listId) {
                const first = lists[0];
                if (first) selectList(first.id);
                else selectedListId = null;
            }
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    async function unarchiveList(listId: number) {
        try {
            await unarchiveListMutation.mutateAsync(listId);
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    /** 統合ダイアログを開く。activeTasks キャッシュからタスク数をカウントする。 */
    function openMergeDialog(listId: number) {
        const list = lists.find((l) => l.id === listId);
        if (!list) return;
        const cache = queryClient.getQueryData<ActiveTasksCache>([
            "activeTasks",
        ]);
        const count =
            cache?.tasks.filter((t) => t.listId === listId).length ?? 0;
        mergeDialog = {
            open: true,
            sourceListId: listId,
            sourceTitle: list.title,
            taskCount: count,
        };
    }

    async function submitMerge(targetListId: number) {
        try {
            await mergeListMutation.mutateAsync({
                sourceListId: mergeDialog.sourceListId,
                targetListId,
            });
            mergeDialog.open = false;
            // 統合先リストを自動選択
            selectList(targetListId);
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    async function clearList(listId: number) {
        try {
            await clearListMutation.mutateAsync(listId);
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    /** タスクの並び替え（楽観的更新 + API呼出） */
    function handleReorderTasks(taskIds: number[]) {
        if (!selectedListId) return;
        // 楽観的更新: キャッシュ内の sort_order と updated をリスト内連番で上書きする
        const now = new Date().toISOString();
        queryClient.setQueryData<ActiveTasksCache>(["activeTasks"], (old) => {
            if (!old) return old;
            const idxMap = new Map(taskIds.map((id, i) => [id, i]));
            return {
                ...old,
                tasks: old.tasks.map((t) => {
                    const newOrder = idxMap.get(t.id);
                    return newOrder !== undefined
                        ? { ...t, sort_order: newOrder, updated: now }
                        : t;
                }),
            };
        });
        reorderTasksMutation.mutate({ listId: selectedListId, taskIds });
    }

    /** サイドバーのリストへのタスクD&D移動（楽観的更新 + 失敗時ロールバック） */
    async function handleTaskDropToList(taskId: number, targetListId: number) {
        if (!selectedListId || targetListId === selectedListId) return;
        dragOverListId = null;

        try {
            // updateTaskMutation の onMutate で楽観的更新を実施する
            await updateTaskMutation.mutateAsync({
                listId: selectedListId,
                taskId,
                move_to: targetListId,
                keep_order: false,
            });
        } catch {
            // onError でロールバック済みのため追加処理不要
        }
    }

    /** 検索結果のタスクをクリックしてリストに遷移 */
    function goToSearchResult(listId: number) {
        searchQuery = "";
        debouncedQuery = "";
        selectList(listId);
    }

    /** モバイルでリスト一覧に戻る（pushState でハッシュを除去） */
    function backToLists() {
        // history.back() だと直接 /#ID にアクセスした場合にサイト外へ遷移するため pushState を使う
        history.pushState(null, "", window.location.pathname);
        // pushState は hashchange を発火しないため手動で同期
        hasHash = false;
    }
</script>

<svelte:window
    onclick={() => (openMenuId = null)}
    onkeydown={(e) => {
        // input/textarea/select にフォーカス中、またはダイアログ表示中はスキップ
        const tag = (e.target as HTMLElement)?.tagName;
        if (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            editDialog.open ||
            mergeDialog.open
        )
            return;
        if (e.key === "n") {
            e.preventDefault();
            const textarea = document.querySelector<HTMLTextAreaElement>(
                '[data-testid="task-add-form"] textarea',
            );
            textarea?.focus();
        } else if (e.key === "/") {
            e.preventDefault();
            const input = document.querySelector<HTMLInputElement>(
                '[data-testid="search-input"]',
            );
            input?.focus();
        } else if (e.key === "Escape") {
            (document.activeElement as HTMLElement)?.blur();
        }
    }}
/>

<Header
    page="tasks"
    {showType}
    {isLoading}
    onChangeShowType={changeShowType}
    {searchQuery}
    onSearchChange={(q) => (searchQuery = q)}
/>

<!-- ボディ: サイドバー + メインコンテンツ -->
<!--
    レスポンシブ幅はbootstrapのcontainer風に各ブレークポイントで細かく刻む方法もあるが、
    本画面では細かく刻まず、xl ブレークポイント以上での最大幅制限のみ行う。
-->
<div class="mx-auto flex h-[calc(100vh-3rem)] w-full xl:max-w-285">
    <ListSidebar
        {lists}
        {selectedListId}
        {isLoading}
        {mobileView}
        {openMenuId}
        {dragOverListId}
        bind:addListTitle
        onSelect={selectList}
        onToggleMenu={(listId) => {
            openMenuId = openMenuId === listId ? null : listId;
        }}
        onRename={renameList}
        onArchive={archiveList}
        onUnarchive={unarchiveList}
        onMerge={openMergeDialog}
        onDelete={deleteList}
        onOpenSchedules={(listId) => (schedulesDialogListId = listId)}
        onAddList={addList}
        onTaskDragOver={(listId) => (dragOverListId = listId)}
        onTaskDrop={handleTaskDropToList}
    />

    <!-- メインコンテンツ: 選択リストのタスク or 検索結果 -->
    <main
        class="flex-1 flex-col bg-white sm:flex dark:bg-gray-800"
        class:flex={mobileView === "tasks"}
        class:hidden={mobileView !== "tasks"}
        class:min-h-0={!isSearching}
        class:overflow-hidden={!isSearching}
        class:overflow-y-auto={isSearching}
    >
        {#if isSearching}
            <SearchResults
                query={debouncedQuery}
                {searchResultsByList}
                isLoading={searchResultsQuery.isLoading}
                onGoToResult={goToSearchResult}
            />
        {:else if selectedListId !== null}
            {@const selectedList = lists.find((l) => l.id === selectedListId)}
            {#if selectedList}
                <TaskListHeader
                    title={selectedList.title}
                    onBack={backToLists}
                    onClear={() => clearList(selectedListId!)}
                />
            {/if}

            <TaskAddForm
                bind:value={addTaskText}
                {listTagCandidates}
                onSubmit={addTask}
            />

            <TaskList
                bind:this={taskList}
                {tasks}
                isLoading={tasksQuery.isLoading}
                onToggle={toggleTask}
                onEdit={openEditDialog}
                onReorder={handleReorderTasks}
                {updatedTaskIds}
            />
        {:else}
            <div class="flex flex-1 items-center justify-center">
                <p class="text-gray-400 dark:text-gray-500">
                    サイドバーからリストを選択してください
                </p>
            </div>
        {/if}
    </main>
</div>

<TaskEditDialog
    {lists}
    open={editDialog.open}
    text={editDialog.text}
    moveTo={editDialog.moveTo}
    completed={editDialog.completed}
    tags={editDialog.tags}
    kind={editDialog.kind}
    {listTagCandidates}
    taskId={editDialog.taskId}
    attachments={editDialogAttachments}
    onAttachmentChange={handleAttachmentChange}
    onSubmit={submitTaskEdit}
    onClose={() => (editDialog.open = false)}
/>

<ScheduleDialog
    open={schedulesDialogListId !== null}
    listId={schedulesDialogListId}
    onClose={() => (schedulesDialogListId = null)}
/>

<MergeListDialog
    open={mergeDialog.open}
    sourceList={{
        id: mergeDialog.sourceListId,
        title: mergeDialog.sourceTitle,
    }}
    allLists={lists}
    taskCount={mergeDialog.taskCount}
    onSubmit={submitMerge}
    onClose={() => (mergeDialog.open = false)}
/>

<ConfirmDialog
    open={confirmDeleteListDialog.open}
    title="リストの削除"
    message="このリストと全てのタスクを削除しますか?"
    confirmLabel="削除"
    variant="danger"
    onConfirm={submitDeleteList}
    onCancel={() => (confirmDeleteListDialog.open = false)}
/>

<ConfirmDialog
    open={confirmArchiveListDialog.open}
    title="リストのアーカイブ"
    message="このリストをアーカイブしますか？"
    confirmLabel="アーカイブ"
    onConfirm={submitArchiveList}
    onCancel={() => (confirmArchiveListDialog.open = false)}
/>

<PromptDialog
    open={renameListDialog.open}
    title="リスト名の変更"
    message="新しいリスト名を入力してください"
    defaultValue={renameListDialog.currentTitle}
    submitLabel="変更"
    onSubmit={submitRenameList}
    onCancel={() => (renameListDialog.open = false)}
/>
