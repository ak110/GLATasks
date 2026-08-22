/**
 * タスクのチェック操作で遷移する次の状態を返す。
 *
 * `TaskListItem.status` とDBの `task.status` は列挙制約のない文字列であるため、
 * 外部境界から未知の値を受け取っても操作を継続できるよう引数を `string` とする。
 * archived は既存のチェック操作と同じく completed へ戻し、active・未知値は
 * 実行中として扱う。
 */
import type { TaskStatus } from "./schemas";

export function nextTaskStatus(current: string): TaskStatus {
  if (current === "running") return "completed";
  if (current === "completed") return "active";
  if (current === "archived") return "completed";
  return "running";
}
