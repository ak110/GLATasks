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

    import { connectivityState } from "#lib/client/sse/connection-recovery.svelte.ts";
    import ReloadBanner from "./ReloadBanner.svelte";
</script>

{#if connectivityState.pendingReload}
    <ReloadBanner testId="connectivity-recovery-banner"
        >サーバーに接続できていません。接続が回復するまで保存できない場合があります。</ReloadBanner
    >
{/if}
