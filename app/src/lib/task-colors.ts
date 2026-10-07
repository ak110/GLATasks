export function taskTextColor(status: string, notes = false): string {
  if (status === "completed" || status === "running")
    return "text-gray-400 dark:text-gray-500";
  return notes ? "text-gray-500 dark:text-gray-400" : "dark:text-gray-100";
}
