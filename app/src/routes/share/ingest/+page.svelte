<script lang="ts">
    /**
     * @fileoverview 共有タスク追加ページ（Chrome拡張・Android共有から利用）
     */

    import type { ActionData, PageData } from "./$types";

    const { data, form }: { data: PageData; form: ActionData } = $props();
    const defaultText = $derived(
        [data.title, data.text, data.pageUrl].filter(Boolean).join("\n\n"),
    );
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-100 p-4">
    <div class="w-full max-w-lg rounded-lg bg-white p-6 shadow">
        <h1 class="mb-4 font-bold text-gray-800">タスクを追加</h1>
        {#if form?.error}
            <p class="mb-4 rounded bg-red-100 p-3 text-red-700">
                {form.error}
            </p>
        {/if}
        <form method="POST">
            <div class="mb-4">
                <label
                    class="mb-1 block cursor-pointer font-medium text-gray-700"
                    for="text">内容</label
                >
                <textarea
                    id="text"
                    name="text"
                    rows={5}
                    required
                    value={defaultText}
                    class="w-full rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none"
                ></textarea>
            </div>
            <div class="mb-4">
                <label
                    class="mb-1 block cursor-pointer font-medium text-gray-700"
                    for="list_id">リスト</label
                >
                <select
                    id="list_id"
                    name="list_id"
                    required
                    class="w-full rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                    {#each data.lists as list (list.id)}
                        <option value={list.id}>{list.title}</option>
                    {/each}
                </select>
            </div>
            <div class="flex justify-end">
                <button
                    type="submit"
                    class="cursor-pointer rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none"
                >
                    追加
                </button>
            </div>
        </form>
    </div>
</div>
