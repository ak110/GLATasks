<script lang="ts">
    import "../app.css";
    import type { Snippet } from "svelte";
    import { QueryClientProvider } from "@tanstack/svelte-query";
    import { queryClient } from "#lib/client/query-client.ts";
    import { onMount } from "svelte";
    import { setEncryptKey } from "#lib/client/trpc.ts";
    import { setContext } from "svelte";
    import {
        getStoredTheme,
        setTheme,
        applyTheme,
        cycleTheme,
        type Theme,
    } from "#lib/client/ui/theme.ts";
    import {
        connect,
        disconnect,
        checkConnection,
    } from "#lib/client/sse/sse-client.ts";
    import {
        startConnectivityWatch,
        stopConnectivityWatch,
    } from "#lib/client/sse/connection-recovery.svelte.ts";
    import TimerAlarmMonitor from "#lib/components/timers/TimerAlarmMonitor.svelte";
    import Toast from "#lib/components/ui/Toast.svelte";
    import UpdateBanner from "#lib/components/ui/UpdateBanner.svelte";
    import {
        startDraftRecovery,
        startEditedFieldTracking,
    } from "#lib/client/ui/user-busy.ts";
    import ConnectivityRecoveryBanner from "#lib/components/ui/ConnectivityRecoveryBanner.svelte";
    import { UI_LAYERS } from "#lib/components/ui/styles.ts";
    import { beforeNavigate } from "$app/navigation";
    import { updated } from "$app/state";
    import type { LayoutData } from "./$types";

    interface Props {
        children: Snippet;
        data: LayoutData;
    }

    let { children, data }: Props = $props();

    let draftRestored = $state(false);
    let theme = $state<Theme>("system");

    beforeNavigate((nav) => {
        if (updated.current && nav.to?.url && !nav.willUnload) {
            nav.cancel();
            // eslint-disable-next-line no-restricted-syntax -- 新版の検知後に利用者の操作で起こる遷移を完全な遷移へ切り替える。遷移しない場合も通信断なら画面を取得できない
            location.href = nav.to.url.href;
        }
    });

    $effect(() => {
        if (data.encrypt_key) {
            setEncryptKey(data.encrypt_key);
        }
    });

    onMount(() => {
        let visibilityHandler: (() => void) | null = null;
        const stopEditedFieldTracking = startEditedFieldTracking();
        let draftNoticeTimer: ReturnType<typeof setTimeout> | undefined;
        const stopDraftRecovery = startDraftRecovery(
            () => data.recovery_user_id,
            () => {
                draftRestored = true;
                clearTimeout(draftNoticeTimer);
                draftNoticeTimer = setTimeout(
                    () => (draftRestored = false),
                    5000,
                );
            },
        );
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

        theme = getStoredTheme();
        applyTheme(theme);

        const mq = matchMedia("(prefers-color-scheme:dark)");
        const handler = () => {
            if (theme === "system") applyTheme("system");
        };
        mq.addEventListener("change", handler);

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
                    console.log(
                        "ServiceWorker registration failed: オフライン時の代替画面が使えません。オンラインでの利用は続けられます。オフライン画面が必要ならページを再読み込みしてください",
                        e,
                    ),
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
            stopEditedFieldTracking();
            stopDraftRecovery();
            clearTimeout(draftNoticeTimer);
        };
    });

    function handleChangeTheme() {
        theme = cycleTheme(theme);
        setTheme(theme);
    }

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
    <div class="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
        <div class="relative shrink-0 {UI_LAYERS.banner}">
            <UpdateBanner />
            <ConnectivityRecoveryBanner />
            {#if draftRestored}
                <p role="status">入力中の内容を復元しました。</p>
            {/if}
        </div>
        {@render children()}
    </div>
</QueryClientProvider>
