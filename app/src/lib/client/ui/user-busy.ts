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

const editedFields = new Set<EditableField>();

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

export function startEditedFieldTracking(): () => void {
  document.addEventListener("input", handleInput, true);
  return () => {
    document.removeEventListener("input", handleInput, true);
    editedFields.clear();
  };
}

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
  return key ? JSON.stringify([field.tagName, field.type, key]) : undefined;
}

function findFields(key: string): EditableField[] {
  return Array.from(
    document.querySelectorAll<EditableField>("input, textarea"),
  ).filter((field) => fieldKey(field) === key);
}

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
  } catch {}
}

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
      if (!editedFields.has(field)) {
        field.value = entry.value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    });
  };

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
        } catch {}
      }, snapshot.expires - Date.now());
    }
  } catch {}
  return () => {
    observer.disconnect();
    clearTimeout(expiryTimer);
    recoveryUserId = undefined;
    notifyRestored = undefined;
  };
}
