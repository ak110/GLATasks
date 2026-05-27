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
    import { connect, disconnect, checkConnection } from "$lib/sse-client";
    import {
        startConnectivityWatch,
        stopConnectivityWatch,
    } from "$lib/connection-recovery.svelte";
    import TimerAlarmMonitor from "$lib/components/timers/TimerAlarmMonitor.svelte";
    import Toast from "$lib/components/ui/Toast.svelte";
    import UpdateBanner from "$lib/components/ui/UpdateBanner.svelte";
    import ConnectivityRecoveryBanner from "$lib/components/ui/ConnectivityRecoveryBanner.svelte";
    import { beforeNavigate } from "$app/navigation";
    import { updated } from "$app/state";
    import type { LayoutData } from "./$types";

    const { children, data }: { children: Snippet; data: LayoutData } =
        $props();

    let theme = $state<Theme>("system");

    // 新バージョンを検知している状態で navigation が起きた場合、
    // バナーを見逃したユーザーにも確実に新版 JS を読み込ませるため hard reload に切り替える。
    beforeNavigate((nav) => {
        if (updated.current && nav.to?.url && !nav.willUnload) {
            nav.cancel();
            location.href = nav.to.url.href;
        }
    });

    // 暗号化鍵が提供されている場合は設定
    $effect(() => {
        if (data.encrypt_key) {
            setEncryptKey(data.encrypt_key);
        }
    });

    onMount(() => {
        // SSE 接続・能動検出監視・可視復帰トリガ（ログイン済みの場合のみ）
        // visibilitychange は SSE 接続の健全性を前倒し判定するためのトリガであり、
        // 未ログイン時は購読対象が存在しないため connect と同じ条件ブロックに統合する。
        // 能動検出監視（connection-recovery）はポーリングと可視・オンライン復帰の
        // 検出トリガを自前で持つため、ここでは起動・停止のみを担う。
        let visibilityHandler: (() => void) | null = null;
        if (data.logged_in) {
            connect(queryClient);
            startConnectivityWatch();
            visibilityHandler = () => {
                if (document.visibilityState === "visible") {
                    checkConnection();
                }
            };
            document.addEventListener("visibilitychange", visibilityHandler);
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
            if (visibilityHandler) {
                document.removeEventListener(
                    "visibilitychange",
                    visibilityHandler,
                );
            }
            stopConnectivityWatch();
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
    <UpdateBanner />
    <ConnectivityRecoveryBanner />
    <Toast />
    {#if data.logged_in}
        <TimerAlarmMonitor />
    {/if}
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
        {@render children()}
    </div>
</QueryClientProvider>
