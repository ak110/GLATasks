<script lang="ts">
    import { handleMainKeyboard } from "#lib/client/tasks/main-keyboard.svelte.ts";
    import { queryKeys } from "#lib/client/query-options.ts";
    import { trpc } from "#lib/client/trpc.ts";
    import { invalidateEventQueries } from "#lib/client/query-sync.ts";
    import { SSE_EVENTS } from "#lib/sse-events.ts";
    import { createMainNavigation } from "#lib/client/tasks/main-navigation.svelte.ts";
    import { subscribeMainSync } from "#lib/client/tasks/main-sync.svelte.ts";
    import { createMainMutations } from "#lib/client/tasks/main-mutations.svelte.ts";
    import { createMainQueries } from "#lib/client/tasks/main-queries.svelte.ts";
    import { createMainState } from "#lib/client/tasks/main-state.svelte.ts";

    import { useQueryClient, hashKey } from "@tanstack/svelte-query";
    import { reconcileVisibleQueryErrorToasts } from "#lib/client/query-client.ts";
    import { showErrorToast } from "#lib/client/ui/toast-store.svelte.ts";
    import { extractErrorMessage } from "#lib/client/ui/extract-error-message.ts";
    import { uploadAttachment } from "#lib/client/attachments/attachment-utils.ts";
    import { SvelteMap } from "svelte/reactivity";
    import type { TaskStatus } from "#lib/schemas.ts";
    import type {
        TaskAddSubmission,
        TaskEditSubmission,
    } from "#lib/client/tasks/task-form-types.ts";
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
    import { grayButtonClass } from "#lib/components/ui/styles.ts";
    import ListSidebar from "#lib/components/lists/ListSidebar.svelte";
    import TaskList from "#lib/components/tasks/TaskList.svelte";
    import TaskAddForm from "#lib/components/tasks/TaskAddForm.svelte";
    import TaskListHeader from "#lib/components/tasks/TaskListHeader.svelte";
    import TaskEditDialog from "#lib/components/tasks/TaskEditDialog.svelte";
    import MergeListDialog from "#lib/components/lists/MergeListDialog.svelte";
    import ScheduleDialog from "#lib/components/schedules/ScheduleDialog.svelte";
    import TaskPaging from "#lib/components/tasks/TaskPaging.svelte";
    import SearchResults from "#lib/components/search/SearchResults.svelte";
    import ConfirmDialog from "#lib/components/dialogs/ConfirmDialog.svelte";
    import PromptDialog from "#lib/components/dialogs/PromptDialog.svelte";

    const state = createMainState();
    const mobileView = $derived(
        state.hasHash ? ("tasks" as const) : ("lists" as const),
    );

    const queryClient = useQueryClient();

    $effect(() => {
        void mobileView;
        void reconcileVisibleQueryErrorToasts();
    });

    $effect(() => {
        const q = state.searchQuery;
        const timer = setTimeout(() => (state.debouncedQuery = q), 300);
        return () => clearTimeout(timer);
    });

    const {
        listsQuery,
        tasksQuery,
        archivedTasksQuery,
        archiveTagCandidatesQuery,
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
        reorderArchivePageMutation,
    } = createMainMutations(queryClient, state, resetActiveTasks);

    const lists = $derived(listsQuery.data ?? []);
    const tasks = $derived.by((): TaskListItem[] => {
        if (state.showType === "archived") {
            const data = archivedTasksQuery.data;
            if (!data) return [];
            return data.tasks.map((t) => ({
                _key: t.id,
                id: t.id,
                listId: state.selectedListId!,
                title: t.title,
                notes: t.notes,
                status: t.status,
                kind: t.kind,
                tags: t.tags,
                sortOrder: 0,
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
    const editDialogAttachments = $derived(
        tasks.find((t) => t.id === state.dialogs.editDialog.taskId)
            ?.attachments ?? [],
    );
    const listTagCandidates = $derived.by(() => {
        if (state.showType === "archived") {
            return [...(archiveTagCandidatesQuery.data ?? [])].sort(
                compareTagName,
            );
        }
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
    const isSearching = $derived(state.searchQuery.length > 0);
    const waitingForSearch = $derived(
        state.searchQuery !== state.debouncedQuery,
    );
    const displayedTasksQuery = $derived(
        state.showType === "archived" ? archivedTasksQuery : tasksQuery,
    );
    const archivePageActions = $derived.by(() => {
        const data = archivedTasksQuery.data;
        if (
            state.showType !== "archived" ||
            !data ||
            state.selectedListId === null
        )
            return undefined;
        const listId = state.selectedListId;
        return {
            previous: data.page > 0,
            next: (data.page + 1) * data.pageSize < data.total,
            disabled:
                archivedTasksQuery.isFetching ||
                reorderArchivePageMutation.isPending,
            move: (taskId: number, kind: "previous" | "next") =>
                reorderArchivePageMutation.mutate({
                    listId,
                    page: data.page,
                    change: { kind, taskId },
                }),
        };
    });
    const searchResults = $derived(
        waitingForSearch ? [] : (searchResultsQuery.data?.tasks ?? []),
    );
    const searchResultsByList = $derived.by(() => {
        return groupSearchResultsByList(searchResults, state.selectedListId);
    });

    const { selectList, changeShowType } = createMainNavigation(
        queryClient,
        state,
        () => lists,
        () => listsQuery.isSuccess,
    );

    async function addList() {
        const title = state.addListTitle.trim();
        if (!title) return;
        try {
            const result = await createListMutation.mutateAsync(title);
            selectList(result.listId);
        } catch {}
    }

    async function addTask(data: TaskAddSubmission): Promise<boolean> {
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
            return false;
        }
    }

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
        } catch {}
    }

    function handleAttachmentChange() {
        void invalidateEventQueries(queryClient, SSE_EVENTS.tasksUpdated);
    }

    function openEditDialog(task: TaskListItem) {
        const text = task.notes ? `${task.title}\n\n${task.notes}` : task.title;
        state.dialogs.editDialog = {
            sessionId: state.dialogs.editDialog.sessionId + 1,
            open: true,
            listId: state.selectedListId!,
            taskId: task.id,
            text,
            moveTo: String(state.selectedListId!),
            completed: task.status === "completed",
            savedCompleted: task.status === "completed",
            tags: task.tags,
            kind: task.kind,
        };
    }

    async function submitTaskEdit(
        data: TaskEditSubmission,
        isCurrent: () => boolean,
    ) {
        const session = state.dialogs.editDialog;
        const { listId, taskId, savedCompleted: wasCompleted } = session;

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
                moveTo: Number(data.moveTo),
                keepOrder: !data.closeAfter,
                tags: data.tags,
                kind: data.kind,
                ...statusChange,
            });

            if (state.dialogs.editDialog === session && session.open) {
                session.listId = Number(data.moveTo);
                session.savedCompleted = data.completed;
            }
            if (
                state.dialogs.editDialog === session &&
                session.open &&
                isCurrent()
            ) {
                session.completed = data.completed;
                session.text = data.text;
                session.moveTo = data.moveTo;
                session.tags = data.tags;
                session.kind = data.kind;
            }

            if (Number(data.moveTo) !== listId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.lists });
            }
            return true;
        } catch {
            return false;
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
        } catch {}
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
        } catch {}
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
        } catch {}
    }

    async function unarchiveList(listId: number) {
        try {
            await unarchiveListMutation.mutateAsync(listId);
        } catch {}
    }

    function openMergeDialog(listId: number) {
        const list = lists.find((l) => l.id === listId);
        if (!list) return;
        const cache = queryClient.getQueryData<ActiveTasksCache>(
            queryKeys.activeTasks,
        );
        const count =
            cache?.tasks.filter((t) => t.listId === listId).length ?? 0;
        state.dialogs.openMergeDialog({
            sourceListId: listId,
            sourceTitle: list.title,
            taskCount: count,
        });
    }

    async function submitMerge(targetListId: number, isCurrent: () => boolean) {
        const submission = state.dialogs.beginMerge();
        if (!submission) return;
        let succeeded = false;
        try {
            await mergeListMutation.mutateAsync({
                sourceListId: submission.session.sourceListId,
                targetListId,
            });
            succeeded = isCurrent();
        } catch {
        } finally {
            if (state.dialogs.finishMerge(submission, succeeded)) {
                selectList(targetListId);
            }
        }
    }

    async function clearList(listId: number) {
        try {
            await clearListMutation.mutateAsync(listId);
        } catch {}
    }

    function handleReorderTasks(taskIds: number[]) {
        if (!state.selectedListId) return;
        const persistedTaskIds = taskIds.filter(
            (taskId) => !isTempTaskId(taskId),
        );
        if (state.showType === "archived") {
            if (
                archivedTasksQuery.isFetching ||
                reorderArchivePageMutation.isPending
            )
                return;
            reorderArchivePageMutation.mutate({
                listId: state.selectedListId,
                page: state.archivePage,
                change: { kind: "reorder", taskIds: persistedTaskIds },
            });
            return;
        }
        reorderTasksMutation.mutate({
            listId: state.selectedListId,
            taskIds: persistedTaskIds,
        });
    }

    async function handleTaskDropToList(taskId: number, targetListId: number) {
        if (!state.selectedListId || targetListId === state.selectedListId)
            return;
        state.dragOverListId = null;

        try {
            await updateTaskMutation.mutateAsync({
                listId: state.selectedListId,
                taskId,
                moveTo: targetListId,
                keepOrder: false,
            });
        } catch {}
    }

    let searchResultNavigation = 0;
    async function goToSearchResult(listId: number, taskId?: number) {
        const navigation = ++searchResultNavigation;
        let page = 0;
        if (taskId !== undefined && state.showType === "archived") {
            const { searchQuery, showType } = state;
            try {
                ({ page } = await trpc.tasks.findArchivePage.query({
                    listId,
                    taskId,
                }));
            } catch (error) {
                showErrorToast(extractErrorMessage(error));
            }
            if (
                navigation !== searchResultNavigation ||
                state.searchQuery !== searchQuery ||
                state.showType !== showType
            )
                return;
        }
        state.searchQuery = "";
        state.debouncedQuery = "";
        selectList(listId);
        if (state.selectedListId === listId) state.archivePage = page;
    }

    function backToLists() {
        history.pushState(null, "", window.location.pathname);
        state.hasHash = false;
    }
</script>

<svelte:window
    onkeydown={handleMainKeyboard}
    onresize={() => void reconcileVisibleQueryErrorToasts()}
/>

<Header
    page="tasks"
    showType={state.showType}
    {isLoading}
    onChangeShowType={changeShowType}
    searchQuery={state.searchQuery}
    onSearchChange={(q) => (state.searchQuery = q)}
/>

{#if listsQuery.isError && listsQuery.data === undefined}
    <div
        role="alert"
        data-query-error-key={hashKey(queryKeys.list(state.showType))}
        class="p-4 text-red-600 dark:text-red-400"
    >
        <p>リストを取得できませんでした。</p>
        <button
            type="button"
            class={grayButtonClass}
            onclick={() => void listsQuery.refetch()}>再試行</button
        >
    </div>
{/if}

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

    <main
        class="flex-1 flex-col bg-white sm:flex dark:bg-gray-800"
        class:flex={mobileView === "tasks"}
        class:hidden={mobileView !== "tasks"}
        class:min-h-0={!isSearching}
        class:overflow-hidden={!isSearching}
        class:overflow-y-auto={isSearching}
    >
        {#if isSearching}
            {#if !waitingForSearch && searchResultsQuery.data}
                <TaskPaging
                    data={searchResultsQuery.data}
                    onPage={(page) => {
                        state.searchPage = page;
                        document.querySelector("main")?.scrollTo({ top: 0 });
                    }}
                />
            {/if}
            <SearchResults
                query={state.searchQuery}
                {searchResultsByList}
                queryErrorKey={hashKey([
                    ...queryKeys.searchResults(
                        state.debouncedQuery,
                        state.showType,
                    ),
                    state.selectedListId,
                    state.searchPage,
                ])}
                isLoading={waitingForSearch || searchResultsQuery.isLoading}
                error={!waitingForSearch &&
                searchResultsQuery.isError &&
                searchResultsQuery.data === undefined
                    ? "検索結果を取得できませんでした。"
                    : undefined}
                onRetry={() => void searchResultsQuery.refetch()}
                onGoToResult={(listId, taskId) =>
                    void goToSearchResult(listId, taskId)}
            />
        {:else if state.selectedListId !== null && lists.some((list) => list.id === state.selectedListId)}
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
                listId={state.selectedListId}
                bind:value={state.addTaskText}
                {listTagCandidates}
                onSubmit={addTask}
            />

            <TaskList
                bind:this={state.taskList}
                {tasks}
                queryErrorKey={hashKey(
                    state.showType === "archived"
                        ? [
                              ...queryKeys.archivedTasks(state.selectedListId),
                              state.archivePage,
                          ]
                        : queryKeys.activeTasks,
                )}
                isLoading={displayedTasksQuery.isLoading}
                error={displayedTasksQuery.isError &&
                displayedTasksQuery.data === undefined
                    ? "タスクを取得できませんでした。"
                    : undefined}
                onRetry={() => void displayedTasksQuery.refetch()}
                onToggle={toggleTask}
                onEdit={openEditDialog}
                onReorder={handleReorderTasks}
                {archivePageActions}
                onTaskDragOver={(listId) => (state.dragOverListId = listId)}
                onTaskDrop={handleTaskDropToList}
                updatedTaskIds={state.updatedTaskIds}
            />
            {#if state.showType === "archived" && archivedTasksQuery.data}
                <TaskPaging
                    data={archivedTasksQuery.data}
                    onPage={(page) => {
                        state.archivePage = page;
                        state.taskList?.scrollToTop();
                    }}
                />
            {/if}
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
    sessionId={state.dialogs.editDialog.sessionId}
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

{#if state.dialogs.mergeDialog.phase !== "closed"}
    {@const session = state.dialogs.mergeDialog.session}
    <MergeListDialog
        {session}
        open={true}
        sourceList={{ id: session.sourceListId, title: session.sourceTitle }}
        allLists={lists}
        taskCount={session.taskCount}
        submitting={state.dialogs.mergeDialog.phase === "submitting"}
        onSubmit={submitMerge}
        onClose={state.dialogs.closeMergeDialog}
    />
{/if}

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
