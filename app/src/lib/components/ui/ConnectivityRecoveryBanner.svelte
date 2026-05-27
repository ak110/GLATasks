<script lang="ts">
    /**
     * @fileoverview 接続不全検知時の手動リロード通知バナー
     *
     * 能動検出（`connection-recovery.svelte.ts`）が接続不全を検知した時点で、
     * ユーザーが入力中だった場合のみ表示される。入力作業の中断を避けるため、
     * 自動リロードはせず、再読み込みボタンの押下で手動リロードを促す。
     * `connectivityState.pendingReload` を購読し、接続回復が検知されて
     * `pendingReload` が偽へ戻った時点で自動的に消える。
     */

    import { connectivityState } from "$lib/connection-recovery.svelte";

    function reload() {
        location.reload();
    }
</script>

{#if connectivityState.pendingReload}
    <div
        class="fixed top-0 right-0 left-0 z-50 flex items-center justify-center gap-3 bg-blue-600 px-4 py-2 text-sm text-white shadow-md dark:bg-blue-700"
        role="status"
        data-testid="connectivity-recovery-banner"
    >
        <span
            >サーバーに接続できていません。接続が回復するまで保存できない場合があります。</span
        >
        <button
            type="button"
            class="cursor-pointer rounded bg-white px-3 py-1 font-semibold text-blue-700 hover:bg-blue-50 dark:bg-blue-100 dark:hover:bg-white"
            onclick={reload}
        >
            再読み込み
        </button>
    </div>
{/if}
