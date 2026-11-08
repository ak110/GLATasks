/**
 * @fileoverview QueryClientのmutationを経由しない保存処理の進行状況
 *
 * 添付ファイルの送信・削除はtRPCを直接呼ぶため、`queryClient.isMutating()`に数えられない。
 * 新しい版の自動再読み込みが保存の途中で画面を破棄しないよう、これらの処理の進行中件数をここで数える。
 */

let pendingCount = 0;

/** 保存処理を実行し、完了（成功・失敗を問わない）まで進行中として数える */
export async function trackPendingWrite<T>(run: () => Promise<T>): Promise<T> {
  pendingCount += 1;
  try {
    return await run();
  } finally {
    pendingCount -= 1;
  }
}

/** QueryClientを経由しない保存処理が進行中なら真 */
export function hasPendingDirectWrites(): boolean {
  return pendingCount > 0;
}
