import { describe, expect, it } from "vitest";
import { nextTaskStatus } from "./task-status";

describe("nextTaskStatus", () => {
  it.each([
    ["active", "running"],
    ["running", "completed"],
    ["completed", "active"],
    ["archived", "completed"],
    ["unknown", "running"],
  ])("%s から %s へ遷移する", (current, expected) => {
    expect(nextTaskStatus(current)).toBe(expected);
  });
});
