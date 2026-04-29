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
    import { onMount } from "svelte";
    import { SvelteSet, SvelteMap } from "svelte/reactivity";
    import type { TaskStatus } from "$lib/schemas";
    import type {
        TagInfo,
        TaskInfo,
        GetTasksResult,
        SearchTaskResult,
    } from "$lib/types";
    import { compareTagName } from "$lib/tag-sort";
    import Header from "$lib/components/layout/Header.svelte";
    import ListSidebar from "$lib/components/lists/ListSidebar.svelte";
    import TaskList from "$lib/components/tasks/TaskList.svelte";
    import TaskAddForm from "$lib/components/tasks/TaskAddForm.svelte";
    import TaskListHeader from "$lib/components/tasks/TaskListHeader.svelte";
    import TaskEditDialog from "$lib/components/tasks/TaskEditDialog.svelte";
    import MergeListDialog from "$lib/components/lists/MergeListDialog.svelte";
    import SearchResults from "$lib/components/search/SearchResults.svelte";

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
    const mobileView = $derived(
        hasHash ? ("tasks" as const) : ("lists" as const),
    );

    type EditDialog = {
        open: boolean;
        listId: number;
        taskId: number;
        text: string;
        moveTo: string;
        completed: boolean;
        tags: TagInfo[];
    };
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

    let editDialog = $state<EditDialog>({
        open: false,
        listId: 0,
        taskId: 0,
        text: "",
        moveTo: "",
        completed: false,
        tags: [],
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

    // タスク一覧取得（SSE でリアルタイム同期）
    const tasksQuery = createQuery<RouterOutputs["tasks"]["list"]>(() => ({
        queryKey: ["tasks", selectedListId, showType] as const,
        queryFn: async (): Promise<RouterOutputs["tasks"]["list"]> => {
            if (!selectedListId)
                return {
                    status: 200 as const,
                    data: [] as TaskInfo[],
                    lastModified: "",
                };
            return trpc.tasks.list.query({
                listId: selectedListId,
                showType,
            });
        },
        enabled: selectedListId !== null,
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

    // SSE: サーバーからの通知でクエリを再取得
    subscribeOnMount({
        [SSE_EVENTS.listsUpdated]: () => {
            queryClient.invalidateQueries({ queryKey: ["lists"] });
        },
        [SSE_EVENTS.tasksUpdated]: (e) => {
            // 自分のタブからのイベント → データ再取得のみ
            if (e.data === tabId) {
                queryClient.invalidateQueries({ queryKey: ["tasks"] });
                return;
            }
            // 他タブ/他端末からの更新 → スナップショット比較で変更タスクを検出
            const currentData = queryClient.getQueryData<GetTasksResult>([
                "tasks",
                selectedListId,
                showType,
            ]);
            const oldTasks: TaskInfo[] =
                currentData && "data" in currentData ? currentData.data : [];
            const oldMap = new Map(
                oldTasks.map((t) => [
                    t.id,
                    `${t.title}\0${t.notes}\0${t.status}`,
                ]),
            );
            queryClient.invalidateQueries({ queryKey: ["tasks"] }).then(() => {
                const newData = queryClient.getQueryData<GetTasksResult>([
                    "tasks",
                    selectedListId,
                    showType,
                ]);
                const newTasks: TaskInfo[] =
                    newData && "data" in newData ? newData.data : [];
                for (const task of newTasks) {
                    const oldKey = oldMap.get(task.id);
                    const newKey = `${task.title}\0${task.notes}\0${task.status}`;
                    if (oldKey === undefined || oldKey !== newKey) {
                        updatedTaskIds.add(task.id);
                    }
                }
            });
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
        }: {
            listId: number;
            text: string;
            tags?: TagInfo[];
        }) => trpc.tasks.create.mutate({ listId, text, tags }),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({
                queryKey: ["tasks", variables.listId],
            });
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
        }) => trpc.tasks.update.mutate(input),
        onSuccess: (_data, variables) => {
            // 更新元リストを無効化
            queryClient.invalidateQueries({
                queryKey: ["tasks", variables.listId],
            });
            // タスクが別リストへ移動された場合は移動先リストも無効化
            if (
                variables.move_to !== undefined &&
                variables.move_to !== variables.listId
            ) {
                queryClient.invalidateQueries({
                    queryKey: ["tasks", variables.move_to],
                });
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
        onSuccess: (_data, listId) => {
            queryClient.invalidateQueries({
                queryKey: ["tasks", listId],
            });
        },
    }));

    // リスト統合
    const mergeListMutation = createMutation(() => ({
        mutationFn: (input: { sourceListId: number; targetListId: number }) =>
            trpc.lists.merge.mutate(input),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["lists"] });
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
        },
    }));

    // タスク並び替え
    const reorderTasksMutation = createMutation(() => ({
        mutationFn: (input: { listId: number; taskIds: number[] }) =>
            trpc.tasks.reorder.mutate(input),
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
        },
    }));

    // 派生状態
    const lists = $derived(listsQuery.data ?? []);
    const tasks = $derived.by(() => {
        const data = tasksQuery.data;
        return data && "data" in data ? data.data : [];
    });
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
    const isLoading = $derived(listsQuery.isLoading || tasksQuery.isLoading);
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
    }): Promise<boolean> {
        if (!selectedListId) return false;
        const text = data.text.trimEnd();
        if (!text) return false;
        try {
            await createTaskMutation.mutateAsync({
                listId: selectedListId,
                text,
                tags: data.tags,
            });
            return true;
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
            return false;
        }
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

    function openEditDialog(task: TaskInfo) {
        const text = task.notes ? `${task.title}\n\n${task.notes}` : task.title;
        editDialog = {
            open: true,
            listId: selectedListId!,
            taskId: task.id,
            text,
            moveTo: String(selectedListId!),
            completed: task.status === "completed",
            tags: task.tags,
        };
    }

    async function submitTaskEdit(data: {
        text: string;
        moveTo: string;
        completed: boolean;
        tags: TagInfo[];
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
            }

            if (Number(data.moveTo) !== listId) {
                queryClient.invalidateQueries({ queryKey: ["lists"] });
            }
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    async function renameList(listId: number, currentTitle: string) {
        const newTitle = globalThis.prompt(
            "新しいリスト名を入力してください",
            currentTitle,
        );
        if (!newTitle || newTitle === currentTitle) return;
        try {
            await renameListMutation.mutateAsync({ listId, title: newTitle });
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    async function deleteList(listId: number) {
        if (!globalThis.confirm("このリストと全てのタスクを削除しますか?"))
            return;
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

    async function archiveList(listId: number) {
        if (!globalThis.confirm("このリストをアーカイブしますか？")) return;
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

    /** 統合ダイアログを開く。タスク数を取得するため現在のクエリキャッシュを参照する。 */
    async function openMergeDialog(listId: number) {
        const list = lists.find((l) => l.id === listId);
        if (!list) return;
        // タスク数を取得（全タスクを取得してカウント）
        const tasksResult = await queryClient.fetchQuery<
            RouterOutputs["tasks"]["list"]
        >({
            queryKey: ["tasks", listId, "all"],
            queryFn: () =>
                trpc.tasks.list.query({
                    listId,
                    showType: "all",
                }),
        });
        const count =
            tasksResult && "data" in tasksResult ? tasksResult.data.length : 0;
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
        // 楽観的更新: キャッシュ内のタスク配列を即座に並び替え
        queryClient.setQueryData(
            ["tasks", selectedListId, showType],
            (old: GetTasksResult | undefined) => {
                if (!old || !("data" in old)) return old;
                const taskMap = new Map(old.data.map((t) => [t.id, t]));
                const reordered = taskIds
                    .map((id) => taskMap.get(id))
                    .filter((t): t is TaskInfo => t !== undefined);
                return { ...old, data: reordered };
            },
        );
        reorderTasksMutation.mutate({ listId: selectedListId, taskIds });
    }

    /** サイドバーのリストへのタスクD&D移動（楽観的更新 + 失敗時ロールバック） */
    async function handleTaskDropToList(taskId: number, targetListId: number) {
        if (!selectedListId || targetListId === selectedListId) return;
        dragOverListId = null;

        // 楽観的更新: 現在のリストのキャッシュからタスクを除去
        queryClient.setQueryData(
            ["tasks", selectedListId, showType],
            (old: GetTasksResult | undefined) => {
                if (!old || !("data" in old)) return old;
                return {
                    ...old,
                    data: old.data.filter((t) => t.id !== taskId),
                };
            },
        );

        try {
            await updateTaskMutation.mutateAsync({
                listId: selectedListId,
                taskId,
                move_to: targetListId,
                keep_order: false,
            });
        } catch {
            // 失敗時はキャッシュを再取得してロールバック
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
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
    参考: bootstrapのcontainer風にするなら
    w-full px-3 sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1140px] 2xl:max-w-[1320px]
    という感じ。
    ここではそこまで細かくはしない。
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
        onAddList={addList}
        onTaskDragOver={(listId) => (dragOverListId = listId)}
        onTaskDrop={handleTaskDropToList}
    />

    <!-- メインコンテンツ: 選択リストのタスク or 検索結果 -->
    <main
        class="flex-1 flex-col overflow-y-auto bg-white sm:flex dark:bg-gray-800"
        class:flex={mobileView === "tasks"}
        class:hidden={mobileView !== "tasks"}
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
    {listTagCandidates}
    onSubmit={submitTaskEdit}
    onClose={() => (editDialog.open = false)}
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
