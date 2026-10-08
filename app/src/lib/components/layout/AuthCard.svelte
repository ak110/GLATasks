<script lang="ts">
    /**
     * @fileoverview 認証ページ共通カードラッパー（ログイン・ユーザー登録で使用）
     */

    import type { Snippet } from "svelte";

    interface Props {
        title: string;
        error?: string | null;
        children: Snippet;
        footer: Snippet;
    }

    let { title, error, children, footer }: Props = $props();
</script>

<div
    class="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900"
>
    <div
        class="w-full max-w-sm rounded-lg bg-white p-8 shadow dark:bg-gray-800"
    >
        <h1
            class="mb-6 text-center text-2xl font-bold text-gray-800 dark:text-gray-100"
        >
            {title}
        </h1>
        {#if error}
            <p class="mb-4 rounded bg-red-100 p-3 text-red-700">
                {error}
            </p>
        {/if}
        {@render children()}
        {@render footer()}
    </div>
</div>
