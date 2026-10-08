<script lang="ts">
    import { queryKeys } from "#lib/client/query-options.ts";
    import { schedulesOptions } from "#lib/client/query-options.ts";
    import { dialogInputClass } from "#lib/components/ui/styles.ts";
    import Dialog from "#lib/components/dialogs/Dialog.svelte";
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
    import { trpc, type RouterInputs } from "#lib/client/trpc.ts";
    import type { TagInfo, ScheduleInfo } from "#lib/types.ts";
    import { showErrorToast } from "#lib/client/ui/toast-store.svelte.ts";
    import { extractErrorMessage } from "#lib/client/ui/extract-error-message.ts";
    import TagEditor from "#lib/components/tasks/TagEditor.svelte";
    import ConfirmDialog from "#lib/components/dialogs/ConfirmDialog.svelte";
    import RecurrenceEditor from "./RecurrenceEditor.svelte";
    import ScheduleList from "./ScheduleList.svelte";

    interface Props {
        open: boolean;
        listId: number | null;
        onClose: () => void;
    }

    let { open, listId, onClose }: Props = $props();

    const queryClient = useQueryClient();

    const schedulesQuery = createQuery(() => schedulesOptions(listId));

    const schedules = $derived(schedulesQuery.data ?? []);

    // 編集フォームの状態。null は非表示、"new" は新規追加、ScheduleInfo は編集対象
    let formTarget = $state<ScheduleInfo | "new" | null>(null);
    let formTitle = $state("");
    let formTags = $state<TagInfo[]>([]);

    let confirmDeleteTarget = $state<ScheduleInfo | null>(null);

    function invalidate() {
        queryClient.invalidateQueries({
            queryKey: queryKeys.listSchedules(listId),
        });
    }

    const createMut = createMutation(() => ({
        mutationFn: (input: RouterInputs["schedules"]["create"]) =>
            trpc.schedules.create.mutate(input),
        onSuccess: invalidate,
    }));

    const updateMut = createMutation(() => ({
        mutationFn: (input: RouterInputs["schedules"]["update"]) =>
            trpc.schedules.update.mutate(input),
        onSuccess: invalidate,
    }));

    const deleteMut = createMutation(() => ({
        mutationFn: (
            scheduleId: RouterInputs["schedules"]["delete"]["scheduleId"],
        ) => trpc.schedules.delete.mutate({ scheduleId }),
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

    async function handleRecurrenceSubmit(
        input: Pick<RouterInputs["schedules"]["create"], "rrule">,
    ) {
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

<Dialog
    {open}
    title="定期TODO"
    widthClass="max-w-lg"
    {onClose}
    testId="schedule-dialog"
>
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
                    class="w-full {dialogInputClass}"
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
</Dialog>
