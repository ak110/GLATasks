<script lang="ts">
    import { invalidateEventQueries } from "#lib/client/query-sync.ts";
    import { UI_LAYERS } from "#lib/components/ui/styles.ts";
    import { notificationLayer } from "#lib/client/ui/notification-layer.ts";
    import { timersOptions, queryKeys } from "#lib/client/query-options.ts";
    /**
     * @fileoverview グローバルタイマー完了監視コンポーネント
     *
     * 全ページでタイマー完了時にビープ音・ブラウザ通知・トースト表示・
     * favicon バッジ表示を行うため、+layout.svelte に配置される。
     * setTimeout で正確なタイミングにアラームをスケジュールする。
     */

    import { createQuery, useQueryClient } from "@tanstack/svelte-query";
    import { trpc, type RouterOutputs } from "#lib/client/trpc.ts";
    import {
        getServerOffset,
        onOffsetChange,
    } from "#lib/client/timers/time-sync.ts";
    import { SSE_EVENTS } from "#lib/sse-events.ts";
    import { subscribeOnMount } from "#lib/client/sse/sse-subscribe.ts";
    import type { TimerInfo } from "#lib/types.ts";
    import { calcTimerRemainingMs } from "#lib/timer-utils.ts";
    import { onMount, onDestroy, untrack } from "svelte";
    import { resolve } from "$app/paths";

    type AlarmRun = {
        timerId: TimerInfo["id"];
        timerName: TimerInfo["name"];
        startedAt: string | null;
    } & (
        | { kind: "reserved"; timeout: ReturnType<typeof setTimeout> }
        | { kind: "checking" }
        | { kind: "notifying" }
        | { kind: "dismissed" }
    );

    const queryClient = useQueryClient();

    // 共有オフセットのローカルミラー（$effect の依存追跡用）
    let localOffset = $state(getServerOffset());

    let runs = $state.raw<AlarmRun[]>([]);
    const alarms = $derived(runs.filter((run) => run.kind === "notifying"));
    let disposed = false;

    function isCurrent(run: AlarmRun) {
        return !disposed && runs.includes(run);
    }

    function replaceRun(run: AlarmRun, next?: AlarmRun) {
        if (run.kind === "reserved") clearTimeout(run.timeout);
        runs = runs.flatMap((current) =>
            current === run ? (next ? [next] : []) : [current],
        );
    }

    onDestroy(() => {
        disposed = true;
        for (const run of runs) {
            if (run.kind === "reserved") clearTimeout(run.timeout);
            stopLoopBeepFor(run.timerId);
        }
        runs = [];
    });

    // favicon の元画像（onMount で読み込み）
    let originalFaviconImg: HTMLImageElement | null = null;
    // favicon バッジ付き Data URL のキャッシュ
    let badgeFaviconUrl: string | null = null;
    const FAVICON_PATH = "/img/favicon-32.png";

    onMount(() => {
        const img = new Image();
        img.src = FAVICON_PATH;
        img.onload = () => {
            originalFaviconImg = img;
        };
        // オフセット変更を localOffset に同期（$effect の再トリガー用）
        const unsubOffset = onOffsetChange((v) => {
            localOffset = v;
        });
        return () => {
            unsubOffset();
        };
    });
    // SSE: タイマー更新通知でデータを再取得
    // （/timers ページ以外でもトースト消去・favicon 復元が即座に反映されるように）
    // 全ページに常駐するため、/timers 以外の画面でもフォールバック経由で queryKeys.timers が同期される
    const invalidateTimers = () =>
        invalidateEventQueries(queryClient, SSE_EVENTS.timersUpdated);
    subscribeOnMount({
        [SSE_EVENTS.timersUpdated]: {
            handler: invalidateTimers,
            fallback: invalidateTimers,
        },
    });

    /** favicon に赤丸バッジを重ねた Data URL を生成する */
    function createBadgeFavicon(img: HTMLImageElement): string {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, size, size);
        // 右上に赤丸バッジ
        const r = 6;
        ctx.beginPath();
        ctx.arc(size - r, r, r, 0, Math.PI * 2);
        ctx.fillStyle = "#ef4444";
        ctx.fill();
        return canvas.toDataURL("image/png");
    }

    /** favicon を更新する */
    function updateFavicon(href: string) {
        let link = document.querySelector(
            'link[rel="icon"]',
        ) as HTMLLinkElement | null;
        if (link) {
            link.href = href;
        }
    }

    // 完了状態のタイマーの有無に応じて favicon バッジを切り替え
    // （トースト消去ではなくタイマーデータに基づく判定）
    $effect(() => {
        const timers = timersQuery.data?.timers ?? [];
        const hasCompletedTimer = timers.some((t) => t.expired && !t.running);
        if (hasCompletedTimer) {
            if (originalFaviconImg) {
                if (!badgeFaviconUrl) {
                    badgeFaviconUrl = createBadgeFavicon(originalFaviconImg);
                }
                updateFavicon(badgeFaviconUrl);
            }
        } else {
            badgeFaviconUrl = null;
            updateFavicon(FAVICON_PATH);
        }
    });

    /** ループビープが回っていれば停止する（動的 import で SSR 安全） */
    function stopLoopBeepFor(timerId: number) {
        void import("#lib/client/timers/beep.ts").then((m) => {
            // 同じIDの次の実行が鳴動を開始していたら、その音は止めない。
            if (
                !runs.some(
                    (run) =>
                        run.timerId === timerId && run.kind === "notifying",
                )
            )
                m.stopLoopBeep(timerId);
        });
    }

    /** トースト通知を閉じる（ループビープも合わせて停止） */
    function dismissAlarm(run: AlarmRun) {
        if (!isCurrent(run)) return;
        replaceRun(run, { ...run, kind: "dismissed" });
        stopLoopBeepFor(run.timerId);
    }

    // タイマー一覧取得（/timers ページとキャッシュ共有）
    const timersQuery = createQuery(() => ({
        ...timersOptions(resolve("/timers")),
        refetchInterval: 60 * 1000,
    }));

    /** サーバー時刻補正込みの残りミリ秒を計算する */
    function calcRemainingMs(timer: TimerInfo): number {
        return calcTimerRemainingMs(timer, localOffset);
    }

    /** タイマー完了時にブラウザ通知を表示する */
    function showNotification(timerName: TimerInfo["name"]) {
        if (
            typeof Notification === "undefined" ||
            Notification.permission !== "granted"
        ) {
            return;
        }
        const title = timerName ? `${timerName} 完了` : "タイマー完了";
        const notification = new Notification(title, {
            body: "タイマーが終了しました",
            tag: "timer",
        });
        notification.onclick = () => {
            window.focus();
            window.location.href = resolve("/timers");
            notification.close();
        };
    }

    /**
     * タイマー完了直前にサーバーから最新状態を取得し、
     * まだ running ならアラームを発火する。
     * 別端末でリセット/停止された場合の誤アラームを防ぐ。
     */
    async function checkAndAlarm(reserved: AlarmRun) {
        if (!isCurrent(reserved)) return;
        const run: AlarmRun = { ...reserved, kind: "checking" };
        replaceRun(reserved, run);
        // サーバーから最新状態を取得
        try {
            await queryClient.refetchQueries(
                { queryKey: queryKeys.timers },
                { throwOnError: true },
            );
        } catch {
            // サーバー確認できない場合はアラームしない
            // （refetchOnWindowFocus / refetchInterval で最新データ取得後に再スケジュールされる）
            if (isCurrent(run)) replaceRun(run);
            return;
        }
        if (!isCurrent(run)) return;
        const data = queryClient.getQueryData<RouterOutputs["timers"]["list"]>(
            queryKeys.timers,
        );
        const timer = data?.timers?.find((t) => t.id === run.timerId);
        if (!timer) {
            replaceRun(run);
            return;
        }
        // autoStopIfExpired で停止済み（expired=true）→ 完了として扱う
        const isCompleted = timer.expired && !timer.running;
        // まだ running で startedAt が一致 → 完了直前
        const isAboutToComplete =
            timer.running &&
            timer.startedAt === run.startedAt &&
            calcRemainingMs(timer) <= 0;
        // リセット（remaining > 0）や再開（startedAt 変更）はスキップ
        if (!isCompleted && !isAboutToComplete) {
            replaceRun(run);
            return;
        }
        handleAlarm(run, timer.ringSeconds);
    }

    /** タイマー完了時の処理 */
    function handleAlarm(checking: AlarmRun, ringSeconds: number) {
        if (!isCurrent(checking)) return;
        const run: AlarmRun = { ...checking, kind: "notifying" };
        replaceRun(checking, run);

        // ビープ音 + ブラウザ通知 + トースト
        void import("#lib/client/timers/beep.ts").then((m) => {
            if (isCurrent(run)) m.startLoopBeep(run.timerId, ringSeconds);
        });
        showNotification(run.timerName);

        // サーバーに停止報告（startedAt でリセット/再開されていないことを確認）
        void trpc.timers.stop
            .mutate({ timerId: run.timerId, startedAt: run.startedAt })
            .then(() =>
                queryClient.invalidateQueries({ queryKey: queryKeys.timers }),
            )
            .catch(() => {
                // 通知済み状態は保持し、次の取得による同期へ委ねる。
                // stop失敗によって同じ実行の音と通知を重複させない。
            });
    }

    // running タイマーを監視し、setTimeout で正確なアラームをスケジュール
    // localOffset を参照してオフセット変更時にも再スケジュールする
    $effect(() => {
        void localOffset;
        const timers = timersQuery.data?.timers;
        const updatedAt = timersQuery.dataUpdatedAt;
        if (!timers) return;
        untrack(() => syncRuns(timers, updatedAt));
    });

    function syncRuns(timers: TimerInfo[], updatedAt: number) {
        for (const run of runs) {
            const timer = timers.find((timer) => timer.id === run.timerId);
            const keep =
                timer &&
                (timer.running
                    ? timer.startedAt === run.startedAt
                    : timer.expired);
            if (!keep) {
                replaceRun(run);
                stopLoopBeepFor(run.timerId);
            } else if (run.kind === "reserved" && timer.running) {
                replaceRun(run);
            }
        }

        // キャッシュが古すぎる場合はスケジュールしない
        // （refetchOnWindowFocus 完了後に dataUpdatedAt が更新され $effect が再発火する）
        const dataAge = Date.now() - (updatedAt ?? 0);
        if (dataAge > 5 * 60 * 1000) return;

        const runningTimers = timers.filter((t) => t.running);

        // 各 running タイマーに setTimeout をスケジュール
        for (const timer of runningTimers) {
            if (
                runs.some(
                    (run) =>
                        run.timerId === timer.id &&
                        run.startedAt === timer.startedAt,
                )
            )
                continue;

            const remainingMs = calcRemainingMs(timer);
            // startedAt をキャプチャしてリセット/再開の検出に使用
            const run: AlarmRun = {
                timerId: timer.id,
                timerName: timer.name,
                startedAt: timer.startedAt,
                kind: "reserved",
                timeout: setTimeout(
                    () => {
                        void checkAndAlarm(run);
                    },
                    Math.max(0, remainingMs),
                ),
            };
            runs = [...runs, run];
        }
    }
</script>

<!-- タイマー完了トースト通知 -->
{#if alarms.length > 0}
    <div
        popover="manual"
        {@attach notificationLayer}
        class="fixed inset-auto top-14 right-4 m-0 flex flex-col gap-2 overflow-visible border-0 bg-transparent p-0 {UI_LAYERS.notification}"
    >
        {#each alarms as alarm (alarm.timerId)}
            <div
                class="flex items-center gap-2 rounded-lg bg-red-500 text-white shadow-lg"
            >
                <a
                    href={resolve("/timers")}
                    class="cursor-pointer px-4 py-3 font-medium"
                >
                    {alarm.timerName
                        ? `${alarm.timerName} 完了`
                        : "タイマー完了"}
                </a>
                <button
                    class="cursor-pointer rounded p-1 pr-3 hover:bg-red-600"
                    aria-label="タイマー完了の通知を閉じる"
                    title="タイマー完了の通知を閉じる"
                    onclick={() => dismissAlarm(alarm)}
                >
                    ✕
                </button>
            </div>
        {/each}
    </div>
{/if}
