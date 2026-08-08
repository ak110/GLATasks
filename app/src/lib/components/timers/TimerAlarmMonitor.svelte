<script lang="ts">
    /**
     * @fileoverview グローバルタイマー完了監視コンポーネント
     *
     * 全ページでタイマー完了時にビープ音・ブラウザ通知・トースト表示・
     * favicon バッジ表示を行うため、+layout.svelte に配置される。
     * setTimeout で正確なタイミングにアラームをスケジュールする。
     */

    import { createQuery, useQueryClient } from "@tanstack/svelte-query";
    import { trpc, type RouterOutputs } from "$lib/trpc";
    import {
        getServerOffset,
        setServerOffset,
        onOffsetChange,
    } from "$lib/sse-client";
    import { SSE_EVENTS } from "$lib/sse-events";
    import { subscribeOnMount } from "$lib/sse-subscribe";
    import type { TimerInfo } from "$lib/types";
    import { calcTimerRemainingMs } from "$lib/timer-utils";
    import { TIMER_DEFAULT_RING_SECONDS } from "$lib/schemas";
    import { onMount } from "svelte";
    import { resolve } from "$app/paths";

    type AlarmInfo = {
        timerId: number;
        timerName: string;
    };

    const queryClient = useQueryClient();

    // 共有オフセットのローカルミラー（$effect の依存追跡用）
    let localOffset = $state(getServerOffset());

    // アラーム再生済みタイマーIDのセット（二重再生防止）
    let alarmedIds = $state(new Set<number>());

    // トースト通知用のアラーム一覧（✕で手動クリアのみ）
    let alarms = $state<AlarmInfo[]>([]);

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
    // 全ページに常駐するため、/timers 以外の画面でもフォールバック経由で ["timers"] が同期される
    const invalidateTimers = () =>
        queryClient.invalidateQueries({ queryKey: ["timers"] });
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

    // タイマーがリセットされたらトーストを自動消去
    // expired が解除された/タイマーが消滅したものはループビープも止める
    $effect(() => {
        const timers = timersQuery.data?.timers ?? [];
        if (alarms.length === 0) return;
        const filtered = alarms.filter((alarm) => {
            const timer = timers.find((t) => t.id === alarm.timerId);
            if (!timer) {
                stopLoopBeepFor(alarm.timerId);
                return false;
            }
            // まだ running（stop 完了待ち）→ 維持
            // expired（自然期限切れ）→ 維持
            // リセット済み or 手動で0にした（expired=false）→ 除去
            const keep = timer.running || timer.expired;
            if (!keep) stopLoopBeepFor(alarm.timerId);
            return keep;
        });
        // 新しい配列参照を毎回生成すると Svelte が変更検知して無限ループするため、変化があるときだけ更新
        if (filtered.length !== alarms.length) {
            alarms = filtered;
        }
    });

    /** ループビープが回っていれば停止する（動的 import で SSR 安全） */
    function stopLoopBeepFor(timerId: number) {
        import("$lib/beep").then((m) => m.stopLoopBeep(timerId));
    }

    /** トースト通知を閉じる（ループビープも合わせて停止） */
    function dismissAlarm(timerId: number) {
        stopLoopBeepFor(timerId);
        alarms = alarms.filter((a) => a.timerId !== timerId);
    }

    // タイマー一覧取得（/timers ページとキャッシュ共有）
    const timersQuery = createQuery<RouterOutputs["timers"]["list"]>(() => ({
        queryKey: ["timers"] as const,
        queryFn: async (): Promise<RouterOutputs["timers"]["list"]> => {
            // RTT/2 補正付きオフセット計算
            const t0 = Date.now();
            const result = await trpc.timers.list.query();
            const t1 = Date.now();
            const serverMs = new Date(result.server_time).getTime();
            setServerOffset(serverMs - (t0 + t1) / 2);
            return result;
        },
        refetchInterval: 60 * 1000,
    }));

    /** サーバー時刻補正込みの残りミリ秒を計算する */
    function calcRemainingMs(timer: TimerInfo): number {
        return calcTimerRemainingMs(timer, localOffset);
    }

    /** タイマー完了時にブラウザ通知を表示する */
    function showNotification(timerName: string) {
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
            window.location.href = "/timers";
            notification.close();
        };
    }

    /**
     * タイマー完了直前にサーバーから最新状態を取得し、
     * まだ running ならアラームを発火する。
     * 別端末でリセット/停止された場合の誤アラームを防ぐ。
     */
    async function checkAndAlarm(
        timerId: number,
        timerName: string,
        startedAt: string | null,
    ) {
        // サーバーから最新状態を取得
        try {
            await queryClient.refetchQueries(
                { queryKey: ["timers"] },
                { throwOnError: true },
            );
        } catch {
            // サーバー確認できない場合はアラームしない
            // （refetchOnWindowFocus / refetchInterval で最新データ取得後に再スケジュールされる）
            return;
        }
        const data = queryClient.getQueryData<RouterOutputs["timers"]["list"]>([
            "timers",
        ]);
        const timer = data?.timers?.find((t) => t.id === timerId);
        if (!timer) return;
        // autoStopIfExpired で停止済み（expired=true）→ 完了として扱う
        const isCompleted = timer.expired && !timer.running;
        // まだ running で started_at が一致 → 完了直前
        const isAboutToComplete =
            timer.running && timer.started_at === startedAt;
        // リセット（remaining > 0）や再開（started_at 変更）はスキップ
        if (!isCompleted && !isAboutToComplete) return;
        handleAlarm(timerId, timerName, startedAt);
    }

    /** タイマー完了時の処理 */
    function handleAlarm(
        timerId: number,
        timerName: string,
        startedAt: string | null,
    ) {
        if (alarmedIds.has(timerId)) return;
        alarmedIds = new Set([...alarmedIds, timerId]);

        // 当該タイマーの ring_seconds 秒だけビープをループ再生する
        const timers = timersQuery.data?.timers ?? [];
        const timer = timers.find((t) => t.id === timerId);
        const ringSeconds = timer?.ring_seconds ?? TIMER_DEFAULT_RING_SECONDS;

        // ビープ音 + ブラウザ通知 + トースト
        import("$lib/beep").then((m) => {
            m.startLoopBeep(timerId, ringSeconds);
        });
        showNotification(timerName);
        alarms = [...alarms, { timerId, timerName }];

        // サーバーに停止報告（started_at でリセット/再開されていないことを確認）
        trpc.timers.stop
            .mutate({ timerId, started_at: startedAt })
            .then(() => queryClient.invalidateQueries({ queryKey: ["timers"] }))
            .catch(() => {
                alarmedIds = new Set(
                    [...alarmedIds].filter((id) => id !== timerId),
                );
            });
    }

    // running タイマーを監視し、setTimeout で正確なアラームをスケジュール
    // localOffset を参照してオフセット変更時にも再スケジュールする
    $effect(() => {
        void localOffset; // 依存追跡用: オフセット変更時に再スケジュール

        // キャッシュが古すぎる場合はスケジュールしない
        // （refetchOnWindowFocus 完了後に dataUpdatedAt が更新され $effect が再発火する）
        const dataAge = Date.now() - (timersQuery.dataUpdatedAt ?? 0);
        if (dataAge > 5 * 60 * 1000) return;

        const timers = timersQuery.data?.timers ?? [];
        const runningTimers = timers.filter((t) => t.running);

        // running タイマーがなければ alarmedIds をリセット
        // 新しい Set 参照を毎回生成すると Svelte が変更検知して無限ループするため、空でないときだけ更新
        if (runningTimers.length === 0) {
            if (alarmedIds.size > 0) {
                alarmedIds = new Set();
            }
            return;
        }

        // 各 running タイマーに setTimeout をスケジュール
        const timeoutIds: ReturnType<typeof setTimeout>[] = [];
        for (const timer of runningTimers) {
            if (alarmedIds.has(timer.id)) continue;

            const remainingMs = calcRemainingMs(timer);
            // started_at をキャプチャしてリセット/再開の検出に使用
            const startedAt = timer.started_at;
            if (remainingMs <= 0) {
                // 既に満了済み → サーバー確認してからアラーム
                checkAndAlarm(timer.id, timer.name, startedAt);
            } else {
                const id = setTimeout(
                    () => checkAndAlarm(timer.id, timer.name, startedAt),
                    remainingMs,
                );
                timeoutIds.push(id);
            }
        }

        return () => {
            for (const id of timeoutIds) {
                clearTimeout(id);
            }
        };
    });
</script>

<!-- タイマー完了トースト通知 -->
{#if alarms.length > 0}
    <div class="fixed top-14 right-4 z-50 flex flex-col gap-2">
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
                    onclick={() => dismissAlarm(alarm.timerId)}
                >
                    ✕
                </button>
            </div>
        {/each}
    </div>
{/if}
