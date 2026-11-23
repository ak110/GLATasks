<script lang="ts">
    import type { ActionData } from "./$types";
    import AuthCard from "#lib/components/layout/AuthCard.svelte";
    import PasskeyAuth from "#lib/components/layout/PasskeyAuth.svelte";
    import { resolve } from "$app/paths";
    import { page } from "$app/state";

    interface Props {
        form: ActionData;
    }

    let { form }: Props = $props();

    let loginQuery = $derived.by(() => {
        const returnTo = page.url.searchParams.get("returnTo");
        return returnTo ? `?${new URLSearchParams({ returnTo })}` : "";
    });
</script>

<AuthCard title="GLATasksに登録" error={form?.error}>
    <PasskeyAuth mode="register" />
    <div class="my-5 border-t border-gray-200 dark:border-gray-700"></div>
    <h2 class="mb-3 font-semibold">パスワードで登録</h2>
    <form method="POST">
        <div class="mb-4">
            <label
                class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                for="user_id"
            >
                ユーザーID
            </label>
            <input
                id="user_id"
                name="user_id"
                type="text"
                required
                autocomplete="username"
                class="w-full rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
        </div>
        <div class="mb-4">
            <label
                class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                for="password"
            >
                パスワード
            </label>
            <input
                id="password"
                name="password"
                type="password"
                required
                autocomplete="new-password"
                class="w-full rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
        </div>
        <div class="mb-6">
            <label
                class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                for="password_confirm"
            >
                パスワード（確認）
            </label>
            <input
                id="password_confirm"
                name="password_confirm"
                type="password"
                required
                autocomplete="new-password"
                class="w-full rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
        </div>
        <button
            type="submit"
            class="w-full cursor-pointer rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
            登録
        </button>
    </form>
    {#snippet footer()}
        <p class="mt-4 text-center text-gray-600 dark:text-gray-300">
            アカウントをお持ちの方は
            <a
                href="{resolve('/auth/login')}{loginQuery}"
                class="text-blue-600 hover:underline dark:text-blue-400"
            >
                ログイン
            </a>
        </p>
    {/snippet}
</AuthCard>
