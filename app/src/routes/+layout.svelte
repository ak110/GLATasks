<script lang="ts">
    import "../app.css";
    import type { Snippet } from "svelte";
    import { QueryClientProvider } from "@tanstack/svelte-query";
    import { queryClient } from "$lib/query-client";
    import { onMount } from "svelte";
    import { setEncryptKey } from "$lib/trpc";
    import { setContext } from "svelte";
    import {
        getStoredTheme,
        setTheme,
        applyTheme,
        cycleTheme,
        type Theme,
    } from "$lib/theme";
    import { connect, disconnect } from "$lib/sse-client";
    import TimerAlarmMonitor from "$lib/components/timers/TimerAlarmMonitor.svelte";
    import Toast from "$lib/components/ui/Toast.svelte";
    import type { LayoutData } from "./$types";

    const { children, data }: { children: Snippet; data: LayoutData } =
        $props();

    let theme = $state<Theme>("system");

    // 暗号化鍵が提供されている場合は設定
    $effect(() => {
        if (data.encrypt_key) {
            setEncryptKey(data.encrypt_key);
        }
    });

    onMount(() => {
        // SSE 接続（ログイン済みの場合のみ）
        if (data.logged_in) {
            connect();
        }

        // テーマ初期化
        theme = getStoredTheme();
        applyTheme(theme);

        // OS テーマ変更リスナー
        const mq = matchMedia("(prefers-color-scheme:dark)");
        const handler = () => {
            if (theme === "system") applyTheme("system");
        };
        mq.addEventListener("change", handler);

        // サービスワーカー登録
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker
                .register("/sw.js")
                .then((r) =>
                    console.log(
                        "ServiceWorker registration successful with scope:",
                        r.scope,
                    ),
                )
                .catch((e) =>
                    console.log("ServiceWorker registration failed:", e),
                );
        }

        return () => {
            mq.removeEventListener("change", handler);
            disconnect();
        };
    });

    function handleChangeTheme() {
        theme = cycleTheme(theme);
        setTheme(theme);
    }

    // テーマを子コンポーネントに提供
    setContext("themeContext", {
        get theme() {
            return theme;
        },
        changeTheme: handleChangeTheme,
    });
</script>

<QueryClientProvider client={queryClient}>
    <Toast />
    {#if data.logged_in}
        <TimerAlarmMonitor />
    {/if}
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
        {@render children()}
    </div>
</QueryClientProvider>
