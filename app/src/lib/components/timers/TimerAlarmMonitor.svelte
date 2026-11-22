<script lang="ts">
    import { invalidateEventQueries } from "#lib/client/query-sync.ts";
    import { UI_LAYERS } from "#lib/components/ui/styles.ts";
    import { notificationLayer } from "#lib/client/ui/notification-layer.ts";
    import { timersOptions, queryKeys } from "#lib/client/query-options.ts";

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

    let originalFaviconImg: HTMLImageElement | null = null;
    let badgeFaviconUrl: string | null = null;
    const FAVICON_PATH = "/img/favicon-32.png";

    onMount(() => {
        const img = new Image();
        img.src = FAVICON_PATH;
        img.onload = () => {
            originalFaviconImg = img;
        };
        const unsubOffset = onOffsetChange((v) => {
            localOffset = v;
        });
        return () => {
            unsubOffset();
        };
    });
    const invalidateTimers = () =>
        invalidateEventQueries(queryClient, SSE_EVENTS.timersUpdated);
    subscribeOnMount({
        [SSE_EVENTS.timersUpdated]: {
            handler: invalidateTimers,
            fallback: invalidateTimers,
        },
    });

    function createBadgeFavicon(img: HTMLImageElement): string {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, size, size);
        const r = 6;
        ctx.beginPath();
        ctx.arc(size - r, r, r, 0, Math.PI * 2);
        ctx.fillStyle = "#ef4444";
        ctx.fill();
        return canvas.toDataURL("image/png");
    }

    function updateFavicon(href: string) {
        let link = document.querySelector(
            'link[rel="icon"]',
        ) as HTMLLinkElement | null;
        if (link) {
            link.href = href;
        }
    }

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

    function stopLoopBeepFor(timerId: number) {
        void import("#lib/client/timers/beep.ts").then((m) => {
            if (
                !runs.some(
                    (run) =>
                        run.timerId === timerId && run.kind === "notifying",
                )
            )
                m.stopLoopBeep(timerId);
        });
    }

    function dismissAlarm(run: AlarmRun) {
        if (!isCurrent(run)) return;
        replaceRun(run, { ...run, kind: "dismissed" });
        stopLoopBeepFor(run.timerId);
    }

    const timersQuery = createQuery(() => ({
        ...timersOptions(),
        refetchInterval: 60 * 1000,
    }));

    function calcRemainingMs(timer: TimerInfo): number {
        return calcTimerRemainingMs(timer, localOffset);
    }

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
            // eslint-disable-next-line no-restricted-syntax -- 利用者が通知を押して起こる遷移で、自動処理が表示中の画面を捨てるものではない
            window.location.href = resolve("/timers");
            notification.close();
        };
    }

    async function checkAndAlarm(reserved: AlarmRun) {
        if (!isCurrent(reserved)) return;
        const run: AlarmRun = { ...reserved, kind: "checking" };
        replaceRun(reserved, run);
        try {
            await queryClient.refetchQueries(
                { queryKey: queryKeys.timers },
                { throwOnError: true },
            );
        } catch {
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
        const isCompleted = timer.expired && !timer.running;
        const isAboutToComplete =
            timer.running &&
            timer.startedAt === run.startedAt &&
            calcRemainingMs(timer) <= 0;
        if (!isCompleted && !isAboutToComplete) {
            replaceRun(run);
            return;
        }
        handleAlarm(run, timer.ringSeconds);
    }

    function handleAlarm(checking: AlarmRun, ringSeconds: number) {
        if (!isCurrent(checking)) return;
        const run: AlarmRun = { ...checking, kind: "notifying" };
        replaceRun(checking, run);

        void import("#lib/client/timers/beep.ts").then((m) => {
            if (isCurrent(run)) m.startLoopBeep(run.timerId, ringSeconds);
        });
        showNotification(run.timerName);

        void trpc.timers.stop
            .mutate({ timerId: run.timerId, startedAt: run.startedAt })
            .then(() =>
                queryClient.invalidateQueries({ queryKey: queryKeys.timers }),
            )
            .catch(() => {});
    }

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

        const dataAge = Date.now() - (updatedAt ?? 0);
        if (dataAge > 5 * 60 * 1000) return;

        const runningTimers = timers.filter((t) => t.running);

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
