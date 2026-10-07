/**
 * @fileoverview テーマ管理（light / dark / system 3状態）
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

/** localStorage からテーマ設定を取得する。未設定なら "system" */
export function getStoredTheme(): Theme {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system")
    return stored;
  return "system";
}

/** テーマを localStorage に保存し、DOM に反映する */
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

/** テーマに応じて `<html>` に `.dark` クラスを add/remove する */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const isDark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme:dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

/** テーマを次の状態にトグルする: light → dark → system → light */
export function cycleTheme(current: Theme): Theme {
  if (current === "light") return "dark";
  if (current === "dark") return "system";
  return "light";
}
