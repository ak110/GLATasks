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
 *
 * 保存に成功した後も値を欄に残す部品（目標値、一括操作の条件など）と、保存後に空でない初期値
 * （数量の1、現在の日時など）へ戻す部品は、未保存の入力が無いとみなす値を欄の`data-clean-value`属性で示す。
 * その欄は値がこの値と異なる間だけ作業中とみなすため、保存に成功すれば自動の再読み込みを妨げず、
 * 失敗して入力が残れば保護する。
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

// 利用者が入力した欄。保存後に値を消す部品が多いため、値が残っている欄だけを作業中とみなす。
// フォームの送信では追跡を外さない。保存の成否は送信の時点では分からず、失敗して入力が残った場合も保護するため
const editedFields = new Set<EditableField>();

// フォーカスが外れた後も画面に残る、DOMの欄に値を持たない未保存の入力。申告した部品ごとの識別子を保持する
const unsavedDrafts = new Map<
  symbol,
  { key: string; serialize: () => string | undefined } | undefined
>();

function isEditableField(target: EventTarget | null): target is EditableField {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type))
  );
}

function handleInput(event: Event): void {
  if (isEditableField(event.target)) editedFields.add(event.target);
}

/** 利用者が入力した欄の追跡を開始する。戻り値は追跡を止める関数 */
export function startEditedFieldTracking(): () => void {
  // 部品の入力処理より先に記録するため、捕捉段階で受け取る
  document.addEventListener("input", handleInput, true);
  return () => {
    document.removeEventListener("input", handleInput, true);
    editedFields.clear();
  };
}

/**
 * DOMの欄に値を持たない未保存の入力が画面に残っていることを申告する。戻り値は申告を取り消す関数。
 *
 * 選択済みのタグや添付ファイルのように部品の状態だけに残る入力は、入力欄の追跡では検出できないため、
 * 入力が残る間この申告で作業中として扱わせる。
 */
export function holdUnsavedDraft(draft?: {
  key: string;
  serialize: () => string | undefined;
}): () => void {
  const token = Symbol("unsaved-draft");
  unsavedDrafts.set(token, draft);
  return () => {
    unsavedDrafts.delete(token);
  };
}

function* editedFieldsWithValue(): Generator<EditableField> {
  for (const field of editedFields) {
    // 画面から外れた欄は入力ごと破棄されているため、追跡からも外す
    if (!field.isConnected) {
      editedFields.delete(field);
      continue;
    }
    const cleanValue = field.dataset.cleanValue;
    if (cleanValue !== undefined) {
      if (field.value !== cleanValue) yield field;
    } else if (field.value.trim() !== "") {
      yield field;
    }
  }
}

/**
 * 作業中なら真。次のいずれかで作業中とみなす。
 *
 * - 入力欄・編集可能要素へのフォーカス
 * - 開いているモーダルダイアログ
 * - 利用者が入力して値が残っている欄（フォーカスが外れていても対象。`data-clean-value`を持つ欄はその値と異なる間）
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
  return !editedFieldsWithValue().next().done;
}

const STORAGE_KEY = "glatasks:auth-recovery-drafts";
const DRAFT_TTL_MS = 15 * 60_000;

type Entry = { kind: "field" | "draft"; key: string; value: string };
type Snapshot = {
  expires: number;
  url: string;
  userId: number;
  entries: Entry[];
};

let recoveryUserId: (() => number | undefined) | undefined;
let notifyRestored: (() => void) | undefined;

function fieldKey(field: EditableField): string | undefined {
  if (field.type === "password" || field.closest('dialog, [role="dialog"]'))
    return;
  const key = field.dataset.recoveryKey ?? (field.id || field.dataset.testid);
  // 同じキーの別種の欄へは復元しない。
  return key ? JSON.stringify([field.tagName, field.type, key]) : undefined;
}

function findFields(key: string): EditableField[] {
  return Array.from(
    document.querySelectorAll<EditableField>("input, textarea"),
  ).filter((field) => fieldKey(field) === key);
}

/** 退避できない内容が残るなら再読み込みを許可しない。 */
export function saveRecoveryDrafts(): boolean {
  try {
    const entries: Entry[] = [];
    for (const field of editedFieldsWithValue()) {
      const key = fieldKey(field);
      if (!key || findFields(key).length !== 1) return false;
      entries.push({ kind: "field", key, value: field.value });
    }
    const keys = new Set<string>();
    for (const draft of unsavedDrafts.values()) {
      if (!draft || keys.has(draft.key)) return false;
      const value = draft.serialize();
      if (value === undefined) return false;
      keys.add(draft.key);
      entries.push({ kind: "draft", key: draft.key, value });
    }
    if (entries.length === 0) return true;

    const userId = recoveryUserId?.();
    if (userId === undefined) return false;
    const previous = readSnapshot();
    const snapshot: Snapshot = {
      userId,
      url: location.href,
      expires: previous?.expires ?? Date.now() + DRAFT_TTL_MS,
      entries: [
        ...(previous?.entries.filter(
          (old) =>
            !entries.some(
              (entry) => entry.key === old.key && entry.kind === old.kind,
            ),
        ) ?? []),
        ...entries,
      ],
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

function readStoredSnapshot(): Snapshot | undefined {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) return;
  const snapshot = JSON.parse(raw) as Snapshot;
  if (snapshot.expires <= Date.now()) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  return snapshot;
}

function readSnapshot(): Snapshot | undefined {
  const snapshot = readStoredSnapshot();
  if (snapshot?.url === location.href && snapshot.userId === recoveryUserId?.())
    return snapshot;
}

function restoreEntries(apply: (entry: Entry) => boolean): void {
  try {
    const snapshot = readSnapshot();
    if (!snapshot) return;
    const remaining = snapshot.entries.filter((entry) => !apply(entry));
    if (remaining.length === snapshot.entries.length) return;
    if (remaining.length === 0) sessionStorage.removeItem(STORAGE_KEY);
    else
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...snapshot, entries: remaining }),
      );
    notifyRestored?.();
  } catch {
    // 保存領域にアクセスできなければ入力欄の初期値を保つ。
  }
}

/** DOMを持たない下書きを、同じ識別子の所有部品にだけ戻す。 */
export function restoreRecoveryDraft(
  key: string,
  apply: (value: string) => boolean,
): void {
  restoreEntries(
    (entry) =>
      entry.kind === "draft" && entry.key === key && apply(entry.value),
  );
}

export function startDraftRecovery(
  userId: () => number | undefined,
  onRestored: () => void,
): () => void {
  recoveryUserId = userId;
  notifyRestored = onRestored;
  const restoreFields = () => {
    restoreEntries((entry) => {
      if (entry.kind !== "field") return false;
      const fields = findFields(entry.key);
      if (fields.length !== 1) return false;
      const field = fields[0];
      // 遅れて現れた復元先で、既に編集された入力を上書きしない。
      if (!editedFields.has(field)) {
        field.value = entry.value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    });
  };

  // 一覧の取得後に初めて描画される欄にも戻す。
  const observer = new MutationObserver(restoreFields);
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = readStoredSnapshot();
    if (snapshot) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-recovery-key"],
      });
      restoreFields();
      expiryTimer = setTimeout(() => {
        observer.disconnect();
        try {
          readStoredSnapshot();
        } catch {
          // 次に保存領域を使える時に期限を確認する。
        }
      }, snapshot.expires - Date.now());
    }
  } catch {
    // 保存領域を利用できない環境では復元しない。
  }
  return () => {
    observer.disconnect();
    clearTimeout(expiryTimer);
    recoveryUserId = undefined;
    notifyRestored = undefined;
  };
}
