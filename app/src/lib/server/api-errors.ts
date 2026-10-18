import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TASK,
} from "#lib/schemas.ts";

/**
 * 公開するエラーの定義。理由（`reason`）と次の操作（`nextAction`）を別々の必須の値として持つ。
 *
 * 画面のトースト、tRPCの応答、MCPの`{error}`、フォームの`fail`は、両方をつないだ文面を返す。
 * 新しい項目で次の操作を欠くと型検査で失敗する。
 */
interface ApiErrorDefinition {
  code: "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR";
  /** 起きた事実。句点で終える */
  reason: string;
  /** 受け取った利用者やMCPクライアントが次に行う操作。句点で終える */
  nextAction: string;
}

const MAX_ATTACHMENT_MIB = MAX_ATTACHMENT_BYTES / 1024 / 1024;

/** 一覧から選び直す操作。画面とMCPクライアントの両方が実行できる形で書く */
function reselect(target: string): string {
  return `${target}の一覧を取得し直し（画面では再読み込みし）、存在する${target}を指定してください。`;
}

export const API_ERRORS = {
  not_found_or_forbidden: {
    code: "NOT_FOUND",
    reason: "対象が見つかりません。",
    nextAction:
      "一覧を取得し直し（画面では再読み込みし）、存在する対象を指定してください。",
  },
  task_not_found: {
    code: "NOT_FOUND",
    reason: "タスクが見つかりません。",
    nextAction: reselect("タスク"),
  },
  attachment_not_found: {
    code: "NOT_FOUND",
    reason: "添付ファイルが見つかりません。",
    nextAction:
      "タスクを開き直し、表示された添付ファイルから選び直してください。",
  },
  schedule_not_found: {
    code: "NOT_FOUND",
    reason: "定期TODOが見つかりません。",
    nextAction: reselect("定期TODO"),
  },
  attachment_too_large: {
    code: "BAD_REQUEST",
    reason: `ファイルサイズが上限（${MAX_ATTACHMENT_MIB} MiB）を超えています。`,
    nextAction: `${MAX_ATTACHMENT_MIB} MiB以下のファイルを選んでください。`,
  },
  attachment_limit_exceeded: {
    code: "BAD_REQUEST",
    reason: `添付ファイルの件数上限（${MAX_ATTACHMENTS_PER_TASK}件）に達しています。`,
    nextAction: "不要な添付ファイルを削除してから追加してください。",
  },
  same_list: {
    code: "BAD_REQUEST",
    reason: "同じリストは統合できません。",
    nextAction: "統合先には別のリストを選んでください。",
  },
  list_not_active: {
    code: "BAD_REQUEST",
    reason: "アーカイブ済みリストは統合できません。",
    nextAction:
      "リストのメニューの「アーカイブ解除」で統合元と統合先をアクティブへ戻してから、統合し直してください。",
  },
  invalid_timer_ids: {
    code: "BAD_REQUEST",
    reason: "タイマーIDが不正です。",
    nextAction:
      "タイマーの一覧を取得し直し（画面では再読み込みし）、全てのタイマーのIDを並べ替える順に指定してください。",
  },
  timer_is_running: {
    code: "BAD_REQUEST",
    reason: "タイマー実行中は変更できません。",
    nextAction: "タイマーを停止してから変更してください。",
  },
  alarm_missing_params: {
    code: "BAD_REQUEST",
    reason: "アラームモードでは目標時刻とタイムゾーンオフセットが必須です。",
    nextAction: "目標時刻とタイムゾーンオフセットを指定してください。",
  },
  countdown_missing_base_seconds: {
    code: "BAD_REQUEST",
    reason: "カウントダウンモードではベース時間が必須です。",
    nextAction: "ベース時間（秒）を指定してください。",
  },
  calorie_item_not_found: {
    code: "NOT_FOUND",
    reason: "品目が見つかりません。",
    nextAction: reselect("品目"),
  },
  calorie_record_not_found: {
    code: "NOT_FOUND",
    reason: "記録が見つかりません。",
    nextAction: reselect("記録"),
  },
  calorie_item_name_conflict: {
    code: "BAD_REQUEST",
    reason: "同じ名前の品目が既にあります。",
    nextAction: "別の名前にするか、既存の品目を使ってください。",
  },
  calorie_item_in_use: {
    code: "BAD_REQUEST",
    reason: "この品目を使っている記録か自動記録があるため削除できません。",
    nextAction: "先にそれらを削除するか、記録を一時項目へ変換してください。",
  },
  calorie_csv_duplicate_item: {
    code: "BAD_REQUEST",
    reason: "品目CSVに重複した品目名があります。",
    nextAction:
      "同じ品目名の行を1行にまとめてから、品目CSVを取り込み直してください。",
  },
  calorie_csv_unknown_item: {
    code: "BAD_REQUEST",
    reason: "記録CSVに未登録の品目があります。",
    nextAction: "品目CSVを先に取り込んでください。",
  },
  calorie_auto_record_not_found: {
    code: "NOT_FOUND",
    reason: "自動記録の設定が見つかりません。",
    nextAction: reselect("自動記録の設定"),
  },
  title_required: {
    code: "BAD_REQUEST",
    reason: "タイトルは必須です。",
    nextAction: "タイトルを入力してください。",
  },
  user_id_conflict: {
    code: "BAD_REQUEST",
    reason: "既に存在するユーザーIDです。",
    nextAction: "別のユーザーIDを入力してください。",
  },
  internal_error: {
    code: "INTERNAL_SERVER_ERROR",
    reason: "処理に失敗しました。",
    nextAction: "時間をおいて再試行してください。",
  },
} as const satisfies Record<string, ApiErrorDefinition>;

export type ApiErrorCode = keyof typeof API_ERRORS;
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ApiError";
  }
}

/** 理由と次の操作をつないで、入口へ返す文面にする。 */
export function formatApiErrorMessage(definition: ApiErrorDefinition): string {
  return `${definition.reason}${definition.nextAction}`;
}

/** 未知の例外はログへ残し、入口に内部情報を渡さない。 */
export function getPublicError(error: unknown): {
  code: ApiErrorDefinition["code"];
  message: string;
} {
  const definition =
    error instanceof ApiError && error.code !== "internal_error"
      ? API_ERRORS[error.code]
      : undefined;
  if (definition) {
    return {
      code: definition.code,
      message: formatApiErrorMessage(definition),
    };
  }
  console.error(
    "サーバー操作に失敗し、入口へinternal_error（時間をおいた再試行の案内）を返しました。続く例外のスタックトレースで失敗した箇所を確認してください",
    error,
  );
  const internal = API_ERRORS.internal_error;
  return { code: internal.code, message: formatApiErrorMessage(internal) };
}

export function getErrorStatus(error: unknown): 400 | 404 | 500 {
  if (error instanceof ApiError) {
    const code = API_ERRORS[error.code].code;
    if (code === "NOT_FOUND") return 404;
    if (code === "BAD_REQUEST") return 400;
  }
  return 500;
}
