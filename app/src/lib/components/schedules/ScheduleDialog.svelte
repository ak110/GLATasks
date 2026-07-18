<script lang="ts">
    /**
     * @fileoverview 定期TODOスケジュール管理ダイアログ
     *
     * 指定リストのスケジュール一覧表示、新規追加・編集・削除の各操作を提供する。
     * 一覧表示は `ScheduleList.svelte` へ、繰り返しルールの入力は
     * `RecurrenceEditor.svelte` へ委譲する。
     */

    import {
        createQuery,
        createMutation,
        useQueryClient,
    } from "@tanstack/svelte-query";
    import { trpc, type RouterOutputs } from "$lib/trpc";
    import type { TagInfo, ScheduleInfo } from "$lib/types";
    import { showErrorToast } from "$lib/toast-store.svelte";
    import { extractErrorMessage } from "$lib/extract-error-message";
    import TagEditor from "$lib/components/tasks/TagEditor.svelte";
    import ConfirmDialog from "$lib/components/dialogs/ConfirmDialog.svelte";
    import RecurrenceEditor from "./RecurrenceEditor.svelte";
    import ScheduleList from "./ScheduleList.svelte";

    type Props = {
        open: boolean;
        listId: number | null;
        onClose: () => void;
    };

    let { open, listId, onClose }: Props = $props();

    const queryClient = useQueryClient();

    const schedulesQuery = createQuery<RouterOutputs["schedules"]["list"]>(
        () => ({
            queryKey: ["schedules", listId] as const,
            queryFn: () => trpc.schedules.list.query({ listId: listId! }),
            enabled: listId !== null,
        }),
    );

    const schedules = $derived(schedulesQuery.data ?? []);

    // 編集フォームの状態。null は非表示、"new" は新規追加、ScheduleInfo は編集対象
    let formTarget = $state<ScheduleInfo | "new" | null>(null);
    let formTitle = $state("");
    let formTags = $state<TagInfo[]>([]);

    let confirmDeleteTarget = $state<ScheduleInfo | null>(null);

    function invalidate() {
        queryClient.invalidateQueries({ queryKey: ["schedules", listId] });
    }

    const createMut = createMutation(() => ({
        mutationFn: (input: {
            listId: number;
            title: string;
            tags: TagInfo[];
            rrule: string;
        }) => trpc.schedules.create.mutate(input),
        onSuccess: invalidate,
    }));

    const updateMut = createMutation(() => ({
        mutationFn: (input: {
            scheduleId: number;
            title?: string;
            tags?: TagInfo[];
            rrule?: string;
            enabled?: boolean;
        }) => trpc.schedules.update.mutate(input),
        onSuccess: invalidate,
    }));

    const deleteMut = createMutation(() => ({
        mutationFn: (scheduleId: number) =>
            trpc.schedules.delete.mutate({ scheduleId }),
        onSuccess: invalidate,
    }));

    function openNewForm() {
        formTarget = "new";
        formTitle = "";
        formTags = [];
    }

    function openEditForm(schedule: ScheduleInfo) {
        formTarget = schedule;
        formTitle = schedule.title;
        formTags = schedule.tags;
    }

    function closeForm() {
        formTarget = null;
    }

    async function handleRecurrenceSubmit(input: { rrule: string }) {
        const title = formTitle.trim();
        if (!title || listId === null) return;
        try {
            if (formTarget === "new") {
                await createMut.mutateAsync({
                    listId,
                    title,
                    tags: formTags,
                    rrule: input.rrule,
                });
            } else if (formTarget) {
                await updateMut.mutateAsync({
                    scheduleId: formTarget.id,
                    title,
                    tags: formTags,
                    rrule: input.rrule,
                });
            }
            closeForm();
        } catch (error) {
            showErrorToast(extractErrorMessage(error));
        }
    }

    async function handleToggle(schedule: ScheduleInfo) {
        try {
            await updateMut.mutateAsync({
                scheduleId: schedule.id,
                enabled: !schedule.enabled,
            });
        } catch (error) {
            showErrorToast(extractErrorMessage(error));
        }
    }

    function requestDelete(schedule: ScheduleInfo) {
        confirmDeleteTarget = schedule;
    }

    async function confirmDelete() {
        const target = confirmDeleteTarget;
        confirmDeleteTarget = null;
        if (!target) return;
        try {
            await deleteMut.mutateAsync(target.id);
        } catch (error) {
            showErrorToast(extractErrorMessage(error));
        }
    }

    const titleId = crypto.randomUUID();

    // Escape キーでダイアログを閉じる（ネストする ConfirmDialog 表示中は抑止する）
    $effect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape" && confirmDeleteTarget === null) onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    });
</script>

<ConfirmDialog
    open={confirmDeleteTarget !== null}
    title="定期TODOの削除"
    message="この定期TODOを削除しますか?"
    confirmLabel="削除"
    variant="danger"
    onConfirm={confirmDelete}
    onCancel={() => (confirmDeleteTarget = null)}
/>

{#if open}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabindex="-1"
    >
        <div
            class="w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-800"
            data-testid="schedule-dialog"
        >
            <div class="flex items-center justify-between px-6 py-4">
                <h2
                    id={titleId}
                    class="text-lg font-semibold text-gray-800 dark:text-gray-100"
                >
                    定期TODO
                </h2>
                <button
                    onclick={onClose}
                    class="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    aria-label="閉じる"
                    title="閉じる"
                >
                    ✕
                </button>
            </div>
            <div class="max-h-[70vh] overflow-y-auto p-6">
                {#if formTarget !== null}
                    <div class="mb-4">
                        <label
                            class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                            for="schedule-title">タイトル</label
                        >
                        <input
                            id="schedule-title"
                            type="text"
                            bind:value={formTitle}
                            class="w-full rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                            data-testid="schedule-title-input"
                        />
                    </div>
                    <div class="mb-4">
                        <span
                            class="mb-1 block font-medium text-gray-700 dark:text-gray-200"
                            >タグ</span
                        >
                        <TagEditor bind:tags={formTags} candidates={[]} />
                    </div>
                    <RecurrenceEditor
                        value={formTarget === "new" ? null : formTarget}
                        onSubmit={handleRecurrenceSubmit}
                        onCancel={closeForm}
                    />
                {:else}
                    <ScheduleList
                        {schedules}
                        onEdit={openEditForm}
                        onToggle={handleToggle}
                        onDelete={requestDelete}
                    />
                    <button
                        onclick={openNewForm}
                        class="mt-4 w-full cursor-pointer rounded bg-blue-100 px-4 py-2 text-blue-600 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-400 dark:hover:bg-blue-900/60"
                        data-testid="schedule-add-btn"
                    >
                        定期TODOを追加
                    </button>
                {/if}
            </div>
        </div>
    </div>
{/if}
