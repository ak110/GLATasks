type Toast = {
  id: number;
  message: string;
};

let nextId = 0;
let toasts = $state<Toast[]>([]);

export function getToasts(): Toast[] {
  return toasts;
}

const MIN_TOAST_MS = 5000;

const TOAST_MS_PER_CHAR = 150;

export function getToastDurationMs(message: string): number {
  return Math.max(MIN_TOAST_MS, message.length * TOAST_MS_PER_CHAR);
}

export function showErrorToast(message: string): number {
  const id = nextId++;
  toasts = [...toasts, { id, message }];
  setTimeout(() => dismissToast(id), getToastDurationMs(message));
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
}
