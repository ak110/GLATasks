<script lang="ts">
    import type { PageData } from "./$types";

    interface Props {
        data: PageData;
    }

    let { data }: Props = $props();
</script>

<div
    class="mx-auto mt-20 max-w-md rounded border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
>
    {#if data.error}
        <h1 class="mb-4 text-xl font-semibold text-red-600 dark:text-red-400">
            認可リクエストエラー
        </h1>
        <p class="text-gray-700 dark:text-gray-200">エラー: {data.error}</p>
    {:else if data.params}
        <h1 class="mb-4 text-xl font-semibold text-gray-800 dark:text-gray-100">
            アクセスを許可しますか
        </h1>
        <p class="mb-4 text-gray-700 dark:text-gray-200">
            <strong>{data.clientName}</strong>
            が GLATasks のあなたのデータへアクセスしようとしています。
        </p>
        <p class="mb-6 text-sm text-gray-500 dark:text-gray-400">
            リスト・タスク・タイマーの読み書きが可能になります。
            心当たりがない場合は許可しないでください。
        </p>
        <form method="POST" class="flex justify-end gap-3">
            <button
                type="button"
                onclick={() => {
                    window.location.href = "/";
                }}
                class="cursor-pointer rounded bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
                拒否
            </button>
            <button
                type="submit"
                class="cursor-pointer rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
                許可
            </button>
        </form>
    {/if}
</div>
