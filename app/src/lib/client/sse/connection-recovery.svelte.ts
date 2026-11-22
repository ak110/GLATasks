import { debugLog } from "#lib/client/debug-log.ts";
import {
  classifyHealth,
  startConnectivityTriggers,
} from "#lib/client/sse/connectivity-check.js";
import { saveRecoveryDrafts } from "#lib/client/ui/user-busy.ts";
import { loadHiddenFrame } from "#lib/client/sse/silent-pass.ts";

export const CONNECTIVITY_RECOVERED_EVENT = "glatasks:connectivity-recovered";

export const SILENT_PASS_RETRY_INTERVAL_MS = 60_000;

export type Health = Awaited<ReturnType<typeof classifyHealth>>;

export const UNREACHABLE_RECHECK_INTERVAL_MS = 2_000;

export const UNREACHABLE_NOTICE_DELAY_MS = 6_000;

export type ConnectivityNotice = "none" | "unreachable" | "reload-required";

export const connectivityState = $state<{ notice: ConnectivityNotice }>({
  notice: "none",
});

type RecheckTimer = ReturnType<typeof setTimeout>;
type ConnectionPhase =
  | { phase: "healthy" }
  | { phase: "unreachable"; since: number; timer: RecheckTimer }
  | { phase: "intercepted" };
type AuthWatch = { phase: "monitoring"; window: Window; timer?: RecheckTimer };

let connection: ConnectionPhase = { phase: "healthy" };
let authWatch: { phase: "closed" } | AuthWatch = { phase: "closed" };
let watch:
  { phase: "manual" | "stopped" } | { phase: "watching"; stop: () => void } = {
  phase: "manual",
};
let inflight: Promise<Health> | undefined;
let generation = 0;
let silentPassFailedAt: number | undefined;

function transitionConnection(
  next: ConnectionPhase,
  notice: ConnectivityNotice,
): void {
  if (connection.phase === "unreachable") clearTimeout(connection.timer);
  connection = next;
  connectivityState.notice = notice;
}

export function startConnectivityWatch(): void {
  if (watch.phase === "watching") return;
  watch = {
    phase: "watching",
    stop: startConnectivityTriggers(() => {
      void checkConnectivity();
    }),
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

export function stopConnectivityWatch(): void {
  if (watch.phase === "stopped") return;
  if (watch.phase === "watching") watch.stop();
  watch = { phase: "stopped" };
  generation++;
  inflight = undefined;
  silentPassFailedAt = undefined;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  recoverConnectivity();
}

function recoverConnectivity(): void {
  transitionConnection({ phase: "healthy" }, "none");
  stopAuthWatch(true);
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== "hidden") return;
  if (connection.phase === "unreachable") {
    if (connectivityState.notice === "reload-required") {
      transitionConnection({ phase: "intercepted" }, "reload-required");
    } else {
      transitionConnection({ phase: "healthy" }, "none");
    }
  }
}

export async function checkConnectivity(
  fetchFn: typeof fetch = fetch,
): Promise<Health> {
  if (watch.phase === "stopped") return classifyHealth(fetchFn);
  const current = generation;
  inflight ??= runCheck(fetchFn, current).finally(() => {
    if (current === generation) inflight = undefined;
  });
  return inflight;
}

async function runCheck(
  fetchFn: typeof fetch,
  current: number,
): Promise<Health> {
  const health = await classifyHealth(fetchFn);
  if (current !== generation) return health;
  debugLog("connectivity", "check", { health });
  if (health === "healthy") {
    recoverConnectivity();
  } else if (health === "unreachable") {
    handleUnreachable(fetchFn);
  } else {
    transitionConnection(
      { phase: "intercepted" },
      connectivityState.notice === "reload-required"
        ? "reload-required"
        : "none",
    );
    const afterPass = await trySilentPass(fetchFn, current);
    if (current !== generation) return health;
    if (afterPass === "healthy") {
      recoverConnectivity();
      window.dispatchEvent(new Event(CONNECTIVITY_RECOVERED_EVENT));
    } else if (afterPass === "unreachable") {
      handleUnreachable(fetchFn);
      return afterPass;
    } else {
      triggerReload();
    }
  }
  return health;
}

async function trySilentPass(
  fetchFn: typeof fetch,
  current: number,
): Promise<Health> {
  if (
    silentPassFailedAt !== undefined &&
    Date.now() - silentPassFailedAt < SILENT_PASS_RETRY_INTERVAL_MS
  ) {
    return "intercepted";
  }
  await loadHiddenFrame(`/healthcheck?silent-pass=${Date.now()}`);
  if (current !== generation) return "intercepted";
  const health = await classifyHealth(fetchFn);
  if (current !== generation) return health;
  debugLog("connectivity", "silent-pass", { health });
  silentPassFailedAt = health === "intercepted" ? Date.now() : undefined;
  return health;
}

function handleUnreachable(fetchFn: typeof fetch): void {
  if (document.visibilityState === "hidden") return;
  const now = Date.now();
  const since = connection.phase === "unreachable" ? connection.since : now;
  const notice =
    now - since >= UNREACHABLE_NOTICE_DELAY_MS
      ? "unreachable"
      : connectivityState.notice === "reload-required"
        ? "reload-required"
        : "none";
  const timer = setTimeout(() => {
    void checkConnectivity(fetchFn);
  }, UNREACHABLE_RECHECK_INTERVAL_MS);
  transitionConnection({ phase: "unreachable", since, timer }, notice);
}

export function openAuthWindow(fetchFn: typeof fetch = fetch): void {
  if (watch.phase === "stopped") return;
  if (authWatch.phase === "monitoring" && !authWatch.window.closed) {
    authWatch.window.focus();
    return;
  }
  stopAuthWatch(false);
  const authWindow = window.open("/healthcheck", "glatasks-auth");
  debugLog("connectivity", "auth-window", { opened: authWindow !== null });
  if (!authWindow) return;
  authWatch = { phase: "monitoring", window: authWindow };
  scheduleAuthRecheck(authWatch, fetchFn);
}

function scheduleAuthRecheck(session: AuthWatch, fetchFn: typeof fetch): void {
  session.timer = setTimeout(() => {
    session.timer = undefined;
    if (session.window.closed) {
      stopAuthWatch(false);
      return;
    }
    void checkConnectivity(fetchFn).then(() => {
      if (authWatch === session) {
        if (session.window.closed) stopAuthWatch(false);
        else scheduleAuthRecheck(session, fetchFn);
      }
    });
  }, UNREACHABLE_RECHECK_INTERVAL_MS);
}

function stopAuthWatch(close: boolean): void {
  const session = authWatch;
  authWatch = { phase: "closed" };
  if (session.phase === "closed") return;
  clearTimeout(session.timer);
  if (close && !session.window.closed) session.window.close();
}

function triggerReload(): void {
  if (!saveRecoveryDrafts()) {
    debugLog("connectivity", "recover", { mode: "banner" });
    connectivityState.notice = "reload-required";
  } else {
    debugLog("connectivity", "recover", { mode: "reload" });
    // eslint-disable-next-line no-restricted-syntax -- 応答の横取りのときだけ再読み込みし、到達不能では呼ばない。再読み込み先でキャプティブポータルの認証画面へ誘導する
    location.reload();
  }
}
