import { describe, it, expect } from "vitest";
import type { TagInfo } from "./types";
import { TAG_COLOR_KEYS } from "./types";
import { getTagColorClass, pickTagColor, resolveTagColor } from "./tag-palette";

describe("pickTagColor", () => {
  it("未使用色がある場合はその中から選ぶ", () => {
    const used = TAG_COLOR_KEYS.slice(0, 4);
    const picked = pickTagColor("新タグ", used);
    expect(TAG_COLOR_KEYS).toContain(picked);
    expect(used).not.toContain(picked);
  });

  it("同じ名前と使用状況に対して決定論的に同じ色を返す", () => {
    const a = pickTagColor("安定", ["amber", "sky"]);
    const b = pickTagColor("安定", ["amber", "sky"]);
    expect(a).toBe(b);
  });

  it("全色使用済みでもパレット内の色を返す", () => {
    const picked = pickTagColor("重複", TAG_COLOR_KEYS);
    expect(TAG_COLOR_KEYS).toContain(picked);
  });
});

describe("resolveTagColor", () => {
  it("前後の空白にかかわらず既存同名タグの色を再利用する", () => {
    const existing: TagInfo[] = [{ name: "重要", color: "red" }];
    expect(resolveTagColor("重要", existing)).toBe("red");
    expect(resolveTagColor("  重要  ", existing)).toBe("red");
  });

  it("同名が無ければ未使用色を優先する", () => {
    const existing: TagInfo[] = TAG_COLOR_KEYS.slice(0, 4).map((color, i) => ({
      name: `tag${i}`,
      color,
    }));
    const resolved = resolveTagColor("newtag", existing);
    expect(TAG_COLOR_KEYS).toContain(resolved);
    expect(existing.map((t) => t.color)).not.toContain(resolved);
  });
});

describe("getTagColorClass", () => {
  it("パレットの各色を背景色へ反映する", () => {
    for (const color of TAG_COLOR_KEYS) {
      expect(getTagColorClass(color), color).toContain(`bg-${color}-`);
    }
  });

  it("未知の色キーはslateフォールバックを返す", () => {
    expect(getTagColorClass("unknown" as string)).toMatch(/bg-slate-/);
  });
});
