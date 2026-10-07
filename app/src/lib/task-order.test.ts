import { describe, expect, it } from "vitest";
import { getHeadSortOrder } from "./task-order.ts";

describe("先頭の並び順", () => {
  it.each([
    { orders: [], expected: 0 },
    { orders: [2000, 3000], expected: 1000 },
    { orders: [-1000, 0], expected: -2000 },
  ])("$ordersから$expectedを求める", ({ orders, expected }) => {
    expect(getHeadSortOrder(orders)).toBe(expected);
  });
});
