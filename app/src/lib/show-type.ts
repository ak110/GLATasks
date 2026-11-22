import type { ShowType } from "#lib/schemas.ts";

export function matchesShowType(
  status: string,
  showType: ShowType,
  domain: "task" | "list" = "task",
): boolean {
  if (domain === "list") {
    return showType !== "active" || status === "active";
  }
  if (showType === "active") return status !== "archived";
  if (showType === "archived") return status === "archived";
  return true;
}
