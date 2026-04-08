/**
 * @fileoverview テーマ管理のユニットテスト
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { getStoredTheme, applyTheme, setTheme, cycleTheme } from "./theme";

// localStorage モック
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

// document.documentElement.classList モック
const classList = new Set<string>();
const classListMock = {
  add: (cls: string) => classList.add(cls),
  remove: (cls: string) => classList.delete(cls),
  toggle: (cls: string, force?: boolean) => {
    if (force) classList.add(cls);
    else classList.delete(cls);
  },
  contains: (cls: string) => classList.has(cls),
};

beforeEach(() => {
  storage.clear();
  classList.clear();
  vi.stubGlobal("localStorage", localStorageMock);
  vi.stubGlobal("document", {
    documentElement: { classList: classListMock },
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false }) as MediaQueryList),
  );
});

describe("theme", () => {
  describe("getStoredTheme", () => {
    test("未設定時は system を返す", () => {
      expect(getStoredTheme()).toBe("system");
    });

    test("light を保存時は light を返す", () => {
      storage.set("theme", "light");
      expect(getStoredTheme()).toBe("light");
    });

    test("dark を保存時は dark を返す", () => {
      storage.set("theme", "dark");
      expect(getStoredTheme()).toBe("dark");
    });

    test("不正値は system を返す", () => {
      storage.set("theme", "invalid");
      expect(getStoredTheme()).toBe("system");
    });
  });

  describe("applyTheme", () => {
    test("dark テーマで .dark クラスを追加する", () => {
      applyTheme("dark");
      expect(classList.has("dark")).toBe(true);
    });

    test("light テーマで .dark クラスを除去する", () => {
      classList.add("dark");
      applyTheme("light");
      expect(classList.has("dark")).toBe(false);
    });

    test("system テーマで prefers-color-scheme に従う", () => {
      applyTheme("system");
      // matchMedia モックが matches: false のためライトモード
      expect(classList.has("dark")).toBe(false);
    });
  });

  describe("setTheme", () => {
    test("dark を設定すると localStorage に保存し DOM に反映する", () => {
      setTheme("dark");
      expect(storage.get("theme")).toBe("dark");
      expect(classList.has("dark")).toBe(true);
    });

    test("system を設定すると localStorage からキーを削除する", () => {
      storage.set("theme", "dark");
      setTheme("system");
      expect(storage.has("theme")).toBe(false);
    });
  });

  describe("cycleTheme", () => {
    test("light → dark → system → light の順でトグルする", () => {
      expect(cycleTheme("light")).toBe("dark");
      expect(cycleTheme("dark")).toBe("system");
      expect(cycleTheme("system")).toBe("light");
    });
  });
});
