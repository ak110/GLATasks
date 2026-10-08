import type { RouterInputs } from "#lib/client/trpc.ts";

/** APIと共通する入力に、アップロード前のファイル選択状態だけを加える。 */
export type TaskAddSubmission = Required<
  Pick<RouterInputs["tasks"]["create"], "text" | "tags" | "kind">
> & { attachments: File[] };

/** リスト選択文字列と完了チェック、保存後の表示制御は画面だけが持つ。 */
export type TaskEditSubmission = Required<
  Pick<RouterInputs["tasks"]["update"], "text" | "tags" | "kind">
> & {
  moveTo: string;
  completed: boolean;
  closeAfter: boolean;
};
