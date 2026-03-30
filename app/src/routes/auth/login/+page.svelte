<script lang="ts">
    /**
     * @fileoverview ログインページ
     */

    import type { ActionData } from "./$types";
    import AuthCard from "$lib/components/layout/AuthCard.svelte";
    import { resolve } from "$app/paths";

    const { form }: { form: ActionData } = $props();
</script>

<AuthCard title="GLATasks" error={form?.error}>
    <form method="POST">
        <div class="mb-4">
            <label
                class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                for="user">ユーザーID</label
            >
            <input
                id="user"
                name="user"
                type="text"
                required
                autocomplete="username"
                class="w-full rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
        </div>
        <div class="mb-6">
            <label
                class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                for="password">パスワード</label
            >
            <input
                id="password"
                name="password"
                type="password"
                required
                autocomplete="current-password"
                class="w-full rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
        </div>
        <button
            type="submit"
            class="w-full cursor-pointer rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none"
        >
            ログイン
        </button>
    </form>
    {#snippet footer()}
        <p class="mt-4 text-center text-gray-600 dark:text-gray-300">
            アカウントをお持ちでない方は
            <a
                href={resolve("/auth/regist_user")}
                class="text-blue-600 hover:underline">登録</a
            >
        </p>
    {/snippet}
</AuthCard>
