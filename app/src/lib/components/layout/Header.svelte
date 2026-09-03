<script lang="ts">
    /**
     * @fileoverview 共通ヘッダーコンポーネント
     */

    import { getContext } from "svelte";
    import { resolve } from "$app/paths";
    import type { Theme } from "$lib/theme";

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

    type Props = {
        page: "tasks" | "timers" | "translate" | "calories";
        isLoading: boolean;
        showType?: "active" | "archived" | "all";
        onChangeShowType?: (type: "active" | "archived" | "all") => void;
        searchQuery?: string;
        onSearchChange?: (query: string) => void;
    };

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
    class="z-10 flex h-12 shrink-0 items-center gap-1 bg-gray-800 px-2 text-white shadow sm:gap-2 sm:px-4 dark:bg-gray-950"
>
    <a href={resolve("/")} class="font-bold hover:text-gray-300">GLATasks</a>
    <span class="hidden text-gray-400 sm:inline">|</span>
    {#each navigationItems as item (item.key)}
        {#if page === item.key}
            <span class="text-sm font-semibold text-gray-200"
                >{item.icon}<span class="hidden sm:inline">{item.label}</span
                ></span
            >
        {:else}
            <a
                href={resolve(item.path)}
                class="cursor-pointer rounded text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                >{item.icon}<span class="hidden sm:inline">{item.label}</span
                ></a
            >
        {/if}
    {/each}
    {#if isLoading}
        <span class="text-sm text-gray-400">読み込み中...</span>
    {/if}
    <div class="ml-auto flex items-center gap-2">
        {#if page === "tasks" && onSearchChange}
            <input
                type="text"
                value={searchQuery ?? ""}
                oninput={(e) => onSearchChange(e.currentTarget.value)}
                placeholder="検索..."
                class="w-16 rounded bg-gray-700 px-2 py-0.5 text-xs text-white placeholder-gray-400 focus:w-24 focus:ring-1 focus:ring-blue-400 focus:outline-none sm:w-28 sm:focus:w-40"
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
                class="cursor-pointer rounded bg-gray-700 px-1.5 py-0.5 text-xs text-white focus:outline-none"
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
        <form method="post" action="/auth/logout">
            <button
                type="submit"
                class="cursor-pointer rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                ><span class="hidden sm:inline">ログアウト</span><span
                    class="sm:hidden">↩</span
                ></button
            >
        </form>
    </div>
</header>
