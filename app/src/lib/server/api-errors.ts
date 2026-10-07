export const API_ERRORS = {
  not_found_or_forbidden: {
    code: "NOT_FOUND",
    message: "対象が見つかりません",
  },
  task_not_found: { code: "NOT_FOUND", message: "タスクが見つかりません" },
  attachment_not_found: {
    code: "NOT_FOUND",
    message: "添付ファイルが見つかりません",
  },
  schedule_not_found: {
    code: "NOT_FOUND",
    message: "定期TODOが見つかりません",
  },
  attachment_too_large: {
    code: "BAD_REQUEST",
    message: "ファイルサイズが上限を超えています",
  },
  attachment_limit_exceeded: {
    code: "BAD_REQUEST",
    message: "添付ファイルの件数上限に達しています",
  },
  same_list: { code: "BAD_REQUEST", message: "同じリストは統合できません" },
  list_not_active: {
    code: "BAD_REQUEST",
    message: "アーカイブ済みリストは統合できません",
  },
  invalid_timer_ids: { code: "BAD_REQUEST", message: "タイマーIDが不正です" },
  timer_is_running: {
    code: "BAD_REQUEST",
    message: "タイマー実行中は変更できません",
  },
  alarm_missing_params: {
    code: "BAD_REQUEST",
    message: "アラームモードでは目標時刻とタイムゾーンオフセットが必須です",
  },
  countdown_missing_base_seconds: {
    code: "BAD_REQUEST",
    message: "カウントダウンモードではベース時間が必須です",
  },
  calorie_item_not_found: {
    code: "NOT_FOUND",
    message: "品目が見つかりません",
  },
  calorie_record_not_found: {
    code: "NOT_FOUND",
    message: "記録が見つかりません",
  },
  calorie_item_name_conflict: {
    code: "BAD_REQUEST",
    message: "同じ名前の品目が既にあります",
  },
  calorie_item_in_use: {
    code: "BAD_REQUEST",
    message:
      "この品目を使っている記録か自動記録があるため削除できません。先にそれらを削除するか、記録を一時項目へ変換してください",
  },
  calorie_csv_duplicate_item: {
    code: "BAD_REQUEST",
    message: "品目CSVに重複した品目名があります",
  },
  calorie_csv_unknown_item: {
    code: "BAD_REQUEST",
    message: "記録CSVに未登録の品目があります。品目CSVを先に取り込んでください",
  },
  calorie_auto_record_not_found: {
    code: "NOT_FOUND",
    message: "自動記録の設定が見つかりません",
  },
  title_required: { code: "BAD_REQUEST", message: "タイトルは必須です。" },
  user_id_conflict: {
    code: "BAD_REQUEST",
    message: "既に存在するユーザーIDです。",
  },
  internal_error: {
    code: "INTERNAL_SERVER_ERROR",
    message: "処理に失敗しました。時間をおいて再試行してください。",
  },
} as const;

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

/** 未知の例外はログへ残し、入口に内部情報を渡さない。 */
export function getPublicError(error: unknown) {
  if (error instanceof ApiError && error.code !== "internal_error")
    return API_ERRORS[error.code];
  console.error("サーバー操作に失敗しました", error);
  return API_ERRORS.internal_error;
}

export function getErrorStatus(error: unknown): 400 | 404 | 500 {
  if (error instanceof ApiError) {
    const code = API_ERRORS[error.code].code;
    if (code === "NOT_FOUND") return 404;
    if (code === "BAD_REQUEST") return 400;
  }
  return 500;
}
