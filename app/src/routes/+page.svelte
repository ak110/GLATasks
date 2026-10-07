<script lang="ts">
    import { handleMainKeyboard } from "#lib/client/tasks/main-keyboard.svelte.ts";
    import { queryKeys } from "#lib/client/query-options.ts";
    import { createMainNavigation } from "#lib/client/tasks/main-navigation.svelte.ts";
    import { subscribeMainSync } from "#lib/client/tasks/main-sync.svelte.ts";
    import { createMainMutations } from "#lib/client/tasks/main-mutations.svelte.ts";
    import { createMainQueries } from "#lib/client/tasks/main-queries.svelte.ts";
    import { createMainState } from "#lib/client/tasks/main-state.svelte.ts";
    /**
     * @fileoverview タスクメモ管理メインページ（リスト一覧 + タスク一覧）
     */

    import { useQueryClient } from "@tanstack/svelte-query";
    import { showErrorToast } from "#lib/client/ui/toast-store.svelte.ts";
    import { extractErrorMessage } from "#lib/client/ui/extract-error-message.ts";
    import { uploadAttachment } from "#lib/client/attachments/attachment-utils.ts";
    import { SvelteMap } from "svelte/reactivity";
    import type { TaskStatus, TaskKind } from "#lib/schemas.ts";
    import type { TagInfo, TaskListItem } from "#lib/types.ts";
    import {
        isTempTaskId,
        sortByTaskOrder,
        filterByList,
        type ActiveTasksCache,
    } from "#lib/client/tasks/task-cache.ts";
    import { groupSearchResultsByList } from "#lib/client/search/search-grouping.ts";
    import { compareTagName } from "#lib/tag-sort.ts";
    import Header from "#lib/components/layout/Header.svelte";
    import ListSidebar from "#lib/components/lists/ListSidebar.svelte";
    import TaskList from "#lib/components/tasks/TaskList.svelte";
    import TaskAddForm from "#lib/components/tasks/TaskAddForm.svelte";
    import TaskListHeader from "#lib/components/tasks/TaskListHeader.svelte";
    import TaskEditDialog from "#lib/components/tasks/TaskEditDialog.svelte";
    import MergeListDialog from "#lib/components/lists/MergeListDialog.svelte";
    import ScheduleDialog from "#lib/components/schedules/ScheduleDialog.svelte";
    import SearchResults from "#lib/components/search/SearchResults.svelte";
    import ConfirmDialog from "#lib/components/dialogs/ConfirmDialog.svelte";
    import PromptDialog from "#lib/components/dialogs/PromptDialog.svelte";

    const state = createMainState();
    const mobileView = $derived(
        state.hasHash ? ("tasks" as const) : ("lists" as const),
    );

    const queryClient = useQueryClient();

    // 検索クエリの debounce（300ms）
    // state.searchQuery の変更ごとにタイマーをリセットし、入力停止後に検索を実行する
    $effect(() => {
        const q = state.searchQuery;
        const timer = setTimeout(() => (state.debouncedQuery = q), 300);
        return () => clearTimeout(timer);
    });

    const {
        listsQuery,
        tasksQuery,
        archivedTasksQuery,
        searchResultsQuery,
        resetActiveTasks,
    } = createMainQueries(queryClient, state);

    subscribeMainSync(queryClient, state, resetActiveTasks);

    const {
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
    } = createMainMutations(queryClient, state, resetActiveTasks);

    // 派生状態
    const lists = $derived(listsQuery.data ?? []);
    const tasks = $derived.by((): TaskListItem[] => {
        if (state.showType === "archived") {
            const data = archivedTasksQuery.data;
            if (!data || !("data" in data)) return [];
            return data.data.map((t) => ({
                _key: t.id,
                id: t.id,
                listId: state.selectedListId!,
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
        if (!cache || state.selectedListId === null) return [];
        return sortByTaskOrder(
            filterByList(cache.tasks, state.selectedListId, state.showType),
        );
    });
    // 編集ダイアログ対象タスクの添付一覧。tasksキャッシュから常に最新値を導出する
    const editDialogAttachments = $derived(
        tasks.find((t) => t.id === state.dialogs.editDialog.taskId)
            ?.attachments ?? [],
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
            (state.showType === "archived" && archivedTasksQuery.isLoading),
    );
    const isSearching = $derived(state.debouncedQuery.length > 0);
    const searchResults = $derived(searchResultsQuery.data ?? []);
    // 検索結果をリスト名でグループ化
    const searchResultsByList = $derived.by(() => {
        return groupSearchResultsByList(searchResults, state.selectedListId);
    });

    const { selectList, changeShowType } = createMainNavigation(
        queryClient,
        state,
        () => lists,
    );

    async function addList() {
        const title = state.addListTitle.trim();
        if (!title) return;
        try {
            const result = await createListMutation.mutateAsync(title);
            selectList(result.listId);
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
        if (!state.selectedListId) return false;
        const text = data.text.trimEnd();
        if (!text) return false;
        const listId = state.selectedListId;
        try {
            const result = await createTaskMutation.mutateAsync({
                listId,
                text,
                tags: data.tags,
                kind: data.kind,
            });
            await uploadTaskAttachments(result.taskId, data.attachments);
            if (
                state.selectedListId === listId &&
                state.showType !== "archived"
            ) {
                state.taskList?.scrollToTop();
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

    async function toggleTask(taskId: number, nextStatus: TaskStatus) {
        if (!state.selectedListId) return;
        const taskData =
            nextStatus === "completed"
                ? { status: "completed" as const }
                : { status: nextStatus, completed: null };
        try {
            await updateTaskMutation.mutateAsync({
                listId: state.selectedListId,
                taskId,
                ...taskData,
            });
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    // 添付ファイル追加・削除完了後の呼び出し。SSE経由の反映を待たず同一タブへ即時反映する
    function handleAttachmentChange() {
        queryClient.invalidateQueries({ queryKey: queryKeys.activeTasks });
        queryClient.invalidateQueries({
            queryKey: queryKeys.archivedTasks(state.selectedListId),
        });
    }

    function openEditDialog(task: TaskListItem) {
        const text = task.notes ? `${task.title}\n\n${task.notes}` : task.title;
        state.dialogs.editDialog = {
            open: true,
            listId: state.selectedListId!,
            taskId: task.id,
            text,
            moveTo: String(state.selectedListId!),
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
        const {
            listId,
            taskId,
            completed: wasCompleted,
        } = state.dialogs.editDialog;

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
                state.dialogs.editDialog.open = false;
            } else {
                // 保存後もダイアログを開いたままにする経路では、後続保存時の statusChange 判定や
                // 対象リスト判定が古い値で行われないよう、保持値を保存後の値へ同期する
                state.dialogs.editDialog.listId = Number(data.moveTo);
                state.dialogs.editDialog.completed = data.completed;
                state.dialogs.editDialog.text = data.text;
                state.dialogs.editDialog.moveTo = data.moveTo;
                state.dialogs.editDialog.tags = data.tags;
                state.dialogs.editDialog.kind = data.kind;
            }

            if (Number(data.moveTo) !== listId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.lists });
            }
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    function renameList(listId: number, currentTitle: string) {
        state.dialogs.renameListDialog = { open: true, listId, currentTitle };
    }

    async function submitRenameList(newTitle: string) {
        const { listId, currentTitle } = state.dialogs.renameListDialog;
        state.dialogs.renameListDialog.open = false;
        if (!newTitle || newTitle === currentTitle) return;
        try {
            await renameListMutation.mutateAsync({ listId, title: newTitle });
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    function deleteList(listId: number) {
        state.dialogs.confirmDeleteListDialog = { open: true, listId };
    }

    async function submitDeleteList() {
        const { listId } = state.dialogs.confirmDeleteListDialog;
        state.dialogs.confirmDeleteListDialog.open = false;
        try {
            await deleteListMutation.mutateAsync(listId);
            if (state.selectedListId === listId) {
                const first = lists[0];
                if (first) selectList(first.id);
                else state.selectedListId = null;
            }
        } catch {
            // グローバルエラーハンドラがトースト表示を担当
        }
    }

    function archiveList(listId: number) {
        state.dialogs.confirmArchiveListDialog = { open: true, listId };
    }

    async function submitArchiveList() {
        const { listId } = state.dialogs.confirmArchiveListDialog;
        state.dialogs.confirmArchiveListDialog.open = false;
        try {
            await archiveListMutation.mutateAsync(listId);
            if (state.selectedListId === listId) {
                const first = lists[0];
                if (first) selectList(first.id);
                else state.selectedListId = null;
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
        const cache = queryClient.getQueryData<ActiveTasksCache>(
            queryKeys.activeTasks,
        );
        const count =
            cache?.tasks.filter((t) => t.listId === listId).length ?? 0;
        state.dialogs.mergeDialog = {
            open: true,
            sourceListId: listId,
            sourceTitle: list.title,
            taskCount: count,
        };
    }

    async function submitMerge(targetListId: number) {
        try {
            await mergeListMutation.mutateAsync({
                sourceListId: state.dialogs.mergeDialog.sourceListId,
                targetListId,
            });
            state.dialogs.mergeDialog.open = false;
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
        if (!state.selectedListId) return;
        // 仮IDはサーバー入力の正整数制約に反するため、送信配列と楽観更新の双方から除く
        const persistedTaskIds = taskIds.filter(
            (taskId) => !isTempTaskId(taskId),
        );
        reorderTasksMutation.mutate({
            listId: state.selectedListId,
            taskIds: persistedTaskIds,
        });
    }

    /** サイドバーのリストへのタスクD&D移動（楽観的更新 + 失敗時ロールバック） */
    async function handleTaskDropToList(taskId: number, targetListId: number) {
        if (!state.selectedListId || targetListId === state.selectedListId)
            return;
        state.dragOverListId = null;

        try {
            // updateTaskMutation の onMutate で楽観的更新を実施する
            await updateTaskMutation.mutateAsync({
                listId: state.selectedListId,
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
        state.searchQuery = "";
        state.debouncedQuery = "";
        selectList(listId);
    }

    /** モバイルでリスト一覧に戻る（pushState でハッシュを除去） */
    function backToLists() {
        // history.back() だと直接 /#ID にアクセスした場合にサイト外へ遷移するため pushState を使う
        history.pushState(null, "", window.location.pathname);
        // pushState は hashchange を発火しないため手動で同期
        state.hasHash = false;
    }
</script>

<svelte:window onkeydown={handleMainKeyboard} />

<Header
    page="tasks"
    showType={state.showType}
    {isLoading}
    onChangeShowType={changeShowType}
    searchQuery={state.searchQuery}
    onSearchChange={(q) => (state.searchQuery = q)}
/>

<!-- ボディ: サイドバー + メインコンテンツ -->
<!--
    レスポンシブ幅はbootstrapのcontainer風に各ブレークポイントで細かく刻む方法もあるが、
    本画面では細かく刻まず、xl ブレークポイント以上での最大幅制限のみ行う。
-->
<div class="mx-auto flex min-h-0 w-full flex-1 xl:max-w-285">
    <ListSidebar
        {lists}
        selectedListId={state.selectedListId}
        {isLoading}
        {mobileView}
        openMenuId={state.openMenuId}
        dragOverListId={state.dragOverListId}
        bind:addListTitle={state.addListTitle}
        onSelect={selectList}
        onToggleMenu={(listId) => {
            state.openMenuId = state.openMenuId === listId ? null : listId;
        }}
        onRename={renameList}
        onArchive={archiveList}
        onUnarchive={unarchiveList}
        onMerge={openMergeDialog}
        onDelete={deleteList}
        onOpenSchedules={(listId) =>
            (state.dialogs.schedulesDialogListId = listId)}
        onAddList={addList}
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
                query={state.debouncedQuery}
                {searchResultsByList}
                isLoading={searchResultsQuery.isLoading}
                onGoToResult={goToSearchResult}
            />
        {:else if state.selectedListId !== null}
            {@const selectedList = lists.find(
                (l) => l.id === state.selectedListId,
            )}
            {#if selectedList}
                <TaskListHeader
                    title={selectedList.title}
                    onBack={backToLists}
                    onClear={() => clearList(state.selectedListId!)}
                />
            {/if}

            <TaskAddForm
                bind:value={state.addTaskText}
                {listTagCandidates}
                onSubmit={addTask}
            />

            <TaskList
                bind:this={state.taskList}
                {tasks}
                isLoading={tasksQuery.isLoading}
                onToggle={toggleTask}
                onEdit={openEditDialog}
                onReorder={handleReorderTasks}
                onTaskDragOver={(listId) => (state.dragOverListId = listId)}
                onTaskDrop={handleTaskDropToList}
                updatedTaskIds={state.updatedTaskIds}
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
    open={state.dialogs.editDialog.open}
    text={state.dialogs.editDialog.text}
    moveTo={state.dialogs.editDialog.moveTo}
    completed={state.dialogs.editDialog.completed}
    tags={state.dialogs.editDialog.tags}
    kind={state.dialogs.editDialog.kind}
    {listTagCandidates}
    taskId={state.dialogs.editDialog.taskId}
    attachments={editDialogAttachments}
    onAttachmentChange={handleAttachmentChange}
    onSubmit={submitTaskEdit}
    onClose={() => (state.dialogs.editDialog.open = false)}
/>

<ScheduleDialog
    open={state.dialogs.schedulesDialogListId !== null}
    listId={state.dialogs.schedulesDialogListId}
    onClose={() => (state.dialogs.schedulesDialogListId = null)}
/>

<MergeListDialog
    open={state.dialogs.mergeDialog.open}
    sourceList={{
        id: state.dialogs.mergeDialog.sourceListId,
        title: state.dialogs.mergeDialog.sourceTitle,
    }}
    allLists={lists}
    taskCount={state.dialogs.mergeDialog.taskCount}
    onSubmit={submitMerge}
    onClose={() => (state.dialogs.mergeDialog.open = false)}
/>

<ConfirmDialog
    open={state.dialogs.confirmDeleteListDialog.open}
    title="リストの削除"
    message="このリストと全てのタスクを削除しますか?"
    confirmLabel="削除"
    variant="danger"
    onConfirm={submitDeleteList}
    onCancel={() => (state.dialogs.confirmDeleteListDialog.open = false)}
/>

<ConfirmDialog
    open={state.dialogs.confirmArchiveListDialog.open}
    title="リストのアーカイブ"
    message="このリストをアーカイブしますか？"
    confirmLabel="アーカイブ"
    onConfirm={submitArchiveList}
    onCancel={() => (state.dialogs.confirmArchiveListDialog.open = false)}
/>

<PromptDialog
    open={state.dialogs.renameListDialog.open}
    title="リスト名の変更"
    message="新しいリスト名を入力してください"
    defaultValue={state.dialogs.renameListDialog.currentTitle}
    submitLabel="変更"
    onSubmit={submitRenameList}
    onCancel={() => (state.dialogs.renameListDialog.open = false)}
/>
