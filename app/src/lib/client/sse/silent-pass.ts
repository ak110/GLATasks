export const SILENT_PASS_LOAD_TIMEOUT_MS = 8_000;

export const SILENT_PASS_SETTLE_MS = 1_500;

export function loadHiddenFrame(url: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(loadTimer);
      clearTimeout(settleTimer);
      frame.remove();
      resolve();
    };
    const loadTimer = setTimeout(finish, SILENT_PASS_LOAD_TIMEOUT_MS);
    frame.addEventListener(
      "load",
      () => {
        settleTimer = setTimeout(finish, SILENT_PASS_SETTLE_MS);
      },
      { once: true },
    );
    frame.addEventListener("error", finish, { once: true });
    frame.src = url;
    try {
      document.body.appendChild(frame);
    } catch {
      finish();
    }
  });
}
