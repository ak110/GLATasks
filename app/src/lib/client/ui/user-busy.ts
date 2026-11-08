/**
 * @fileoverview 利用者が作業中かの判定
 *
 * 自動の再読み込みは作業中の入力や開いているダイアログを失わせるため、
 * 接続回復と新しい版の検知の両方がこの判定で再読み込みを見送る。
 *
 * 入力欄からフォーカスが外れても、未保存の入力が画面に残る部品は多い
 * （タスク・リストの追加欄、カロリーの追加欄、翻訳の原文など）。
 * 部品ごとの申告に頼ると追加した部品で漏れるため、利用者が入力した欄を文書全体で追跡し、
 * 値が残っている間は作業中とみなす。DOMの欄に値を持たない入力（選択済みのタグ・添付など）だけを、
 * 部品が`holdUnsavedDraft`で申告する。
 */

// 文字や数値を入力する種類のinput。チェックボックスや選択肢の操作は即時に反映する部品が多いため追跡しない
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

type EditableField = HTMLInputElement | HTMLTextAreaElement;

// 利用者が入力した欄。保存後に値を消す部品が多いため、値が残っている欄だけを作業中とみなす
const editedFields = new Set<EditableField>();

// フォーカスが外れた後も画面に残る、DOMの欄に値を持たない未保存の入力。申告した部品ごとの識別子を保持する
const unsavedDrafts = new Set<symbol>();

function isEditableField(target: EventTarget | null): target is EditableField {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type))
  );
}

function handleInput(event: Event): void {
  if (isEditableField(event.target)) editedFields.add(event.target);
}

// 送信したフォームの欄は保存へ渡した入力とみなし、追跡を外す。
// 送信後も値を残す部品（目標値の欄など）が、保存後もずっと作業中と判定され続けないようにするため。
function handleSubmit(event: Event): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  for (const field of editedFields) {
    if (field.form === form) editedFields.delete(field);
  }
}

/** 利用者が入力した欄の追跡を開始する。戻り値は追跡を止める関数 */
export function startEditedFieldTracking(): () => void {
  // 部品の入力処理より先に記録するため、捕捉段階で受け取る
  document.addEventListener("input", handleInput, true);
  document.addEventListener("submit", handleSubmit, true);
  return () => {
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("submit", handleSubmit, true);
    editedFields.clear();
  };
}

/**
 * DOMの欄に値を持たない未保存の入力が画面に残っていることを申告する。戻り値は申告を取り消す関数。
 *
 * 選択済みのタグや添付ファイルのように部品の状態だけに残る入力は、入力欄の追跡では検出できないため、
 * 入力が残る間この申告で作業中として扱わせる。
 */
export function holdUnsavedDraft(): () => void {
  const token = Symbol("unsaved-draft");
  unsavedDrafts.add(token);
  return () => {
    unsavedDrafts.delete(token);
  };
}

function hasEditedFieldWithValue(): boolean {
  for (const field of editedFields) {
    // 画面から外れた欄は入力ごと破棄されているため、追跡からも外す
    if (!field.isConnected) {
      editedFields.delete(field);
      continue;
    }
    if (field.value.trim() !== "") return true;
  }
  return false;
}

/**
 * 作業中なら真。次のいずれかで作業中とみなす。
 *
 * - 入力欄・編集可能要素へのフォーカス
 * - 開いているモーダルダイアログ
 * - 利用者が入力して値が残っている欄（フォーカスが外れていても対象）
 * - `holdUnsavedDraft`で申告された未保存の入力
 */
export function isUserBusy(): boolean {
  const active = document.activeElement;
  if (active) {
    const tag = active.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if ((active as HTMLElement).isContentEditable) return true;
  }
  if (
    document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
  )
    return true;
  if (unsavedDrafts.size > 0) return true;
  return hasEditedFieldWithValue();
}
