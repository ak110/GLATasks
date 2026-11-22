export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

export function getStoredTheme(): Theme {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system")
    return stored;
  return "system";
}

export function setTheme(theme: Theme): void {
  if (typeof localStorage !== "undefined") {
    if (theme === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  }
  applyTheme(theme);
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const isDark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme:dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

export function cycleTheme(current: Theme): Theme {
  if (current === "light") return "dark";
  if (current === "dark") return "system";
  return "light";
}
