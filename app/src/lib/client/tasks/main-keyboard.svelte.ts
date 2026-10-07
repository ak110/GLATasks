/** 入力欄やモーダルを操作していないときだけ、メイン画面のショートカットを受け付ける。 */
export function handleMainKeyboard(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (
    target?.matches("input, textarea, select, [contenteditable='true']") ||
    document.querySelector("dialog[open]")
  )
    return;
  if (event.key === "n") {
    event.preventDefault();
    document
      .querySelector<HTMLTextAreaElement>(
        '[data-testid="task-add-form"] textarea',
      )
      ?.focus();
  } else if (event.key === "/") {
    event.preventDefault();
    document
      .querySelector<HTMLInputElement>('[data-testid="search-input"]')
      ?.focus();
  } else if (event.key === "Escape") {
    (document.activeElement as HTMLElement | null)?.blur();
  }
}
