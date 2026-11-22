<script lang="ts">
    import { getContext, onMount } from "svelte";
    import { resolve } from "$app/paths";
    import type { Theme } from "#lib/client/ui/theme.ts";
    import { menuBehavior } from "#lib/actions/menu.ts";
    import {
        menuFrameClass,
        menuItemClass,
    } from "#lib/components/ui/styles.ts";

    let accountOpen = $state(false);
    let menuReady = $state(false);
    onMount(() => {
        menuReady = true;
    });

    const themeCtx = getContext<{
        readonly theme: Theme;
        changeTheme: () => void;
    }>("themeContext");

    const themeIcon = $derived(
        themeCtx?.theme === "light"
            ? "☀"
            : themeCtx?.theme === "dark"
              ? "🌙"
              : "💻",
    );

    interface Props {
        page: (typeof navigationItems)[number]["key"] | "security";
        isLoading: boolean;
        showType?: "active" | "archived" | "all";
        onChangeShowType?: (type: "active" | "archived" | "all") => void;
        searchQuery?: string;
        onSearchChange?: (query: string) => void;
    }

    let {
        page,
        isLoading,
        showType,
        onChangeShowType,
        searchQuery,
        onSearchChange,
    }: Props = $props();

    const navigationItems = [
        {
            key: "tasks",
            path: "/",
            icon: "📋",
            label: "タスク",
        },
        {
            key: "timers",
            path: "/timers",
            icon: "⏱",
            label: "タイマー",
        },
        {
            key: "translate",
            path: "/translate",
            icon: "🌐",
            label: "翻訳",
        },
        {
            key: "calories",
            path: "/calories",
            icon: "🍴",
            label: "カロリー",
        },
    ] as const;
</script>

<header
    class="z-10 flex min-h-12 shrink-0 flex-wrap items-center gap-x-1 gap-y-1 bg-gray-800 px-2 py-1.5 text-white shadow sm:gap-x-2 sm:px-4 dark:bg-gray-950"
>
    {#each navigationItems as item (item.key)}
        {#if item.key !== "tasks"}
            <span class="text-gray-400" data-testid="header-nav-separator"
                >|</span
            >
        {/if}
        {#if page === item.key}
            <span
                class="text-sm font-semibold text-gray-200"
                data-testid={"header-nav-" + item.key}
                aria-current="page"
                aria-label={item.label}
                title={item.label}
                >{item.icon}<span class="hidden sm:inline">{item.label}</span
                ></span
            >
        {:else}
            <a
                href={resolve(item.path)}
                class="cursor-pointer rounded text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                data-testid={"header-nav-" + item.key}
                aria-label={item.label}
                title={item.label}
                >{item.icon}<span class="hidden sm:inline">{item.label}</span
                ></a
            >
        {/if}
    {/each}
    {#if isLoading}
        <span class="text-sm text-gray-400">読み込み中...</span>
    {/if}
    <div class="ml-auto flex flex-wrap items-center justify-end gap-1 sm:gap-2">
        {#if page === "tasks" && onSearchChange}
            <input
                type="text"
                value={searchQuery ?? ""}
                oninput={(e) => onSearchChange(e.currentTarget.value)}
                placeholder="検索..."
                class="w-16 rounded bg-gray-700 px-2 py-0.5 text-xs text-white placeholder-gray-400 focus:ring-1 focus:ring-blue-400 focus:outline-none sm:w-28 sm:focus:w-40"
                data-testid="search-input"
            />
        {/if}
        {#if page === "tasks" && showType !== undefined && onChangeShowType}
            <select
                value={showType}
                onchange={(e) =>
                    onChangeShowType(
                        e.currentTarget.value as "active" | "archived" | "all",
                    )}
                class="cursor-pointer rounded bg-gray-700 px-1.5 py-0.5 text-xs text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
                <option value="active">表示中</option>
                <option value="archived">アーカイブ</option>
                <option value="all">すべて</option>
            </select>
        {/if}
        {#if themeCtx}
            <button
                onclick={themeCtx.changeTheme}
                class="cursor-pointer rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                title="テーマ切替"
                aria-label="テーマ切替"
                data-testid="theme-toggle"
            >
                {themeIcon}
            </button>
        {/if}
        <div
            class="relative"
            use:menuBehavior={{
                open: accountOpen,
                onClose: () => (accountOpen = false),
            }}
        >
            <button
                type="button"
                class="cursor-pointer rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                onclick={() => (accountOpen = !accountOpen)}
                disabled={!menuReady}
                data-testid="account-menu-toggle"
                aria-label="アカウント"
                title="アカウント"
                ><span aria-hidden="true">👤</span><span
                    class="hidden sm:inline">アカウント</span
                >
                <span aria-hidden="true" class="hidden sm:inline">▾</span
                ></button
            >
            {#if accountOpen}
                <div
                    class="{menuFrameClass} text-sm text-gray-800"
                    data-menu-frame
                    role="menu"
                    data-testid="account-menu"
                    aria-label="アカウント"
                >
                    <a
                        href={resolve("/account/security")}
                        role="menuitem"
                        class={menuItemClass}
                        data-testid="security-link"
                        onclick={() => (accountOpen = false)}>アカウント設定</a
                    >
                    <form method="post" action="/auth/logout">
                        <button
                            type="submit"
                            role="menuitem"
                            class={menuItemClass}
                            data-testid="account-logout">ログアウト</button
                        >
                    </form>
                </div>
            {/if}
        </div>
    </div>
</header>
