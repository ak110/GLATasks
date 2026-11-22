import type { TaskStatus } from "./schemas";

export function nextTaskStatus(current: string): TaskStatus {
  if (current === "running") return "completed";
  if (current === "completed") return "active";
  if (current === "archived") return "completed";
  return "running";
}
