<script lang="ts">
    /**
     * @fileoverview 接続不全の案内バナー
     *
     * 能動検出（`connection-recovery.svelte.ts`）の`connectivityState.notice`を購読し、
     * 回復を検知して`notice`が`"none"`へ戻った時点で自動的に消える。
     * 到達不能の案内は再読み込みを促さない。通信断の間の再読み込みはオフライン画面へ移り、
     * 回復後はバナーが自動で消えて再読み込みが不要なためである。
     * 応答の横取りを入力中に検知した場合だけ、認証画面へ進むための再読み込みボタンを表示する。
     */

    import { connectivityState } from "#lib/client/sse/connection-recovery.svelte.ts";
    import ReloadBanner from "./ReloadBanner.svelte";
</script>

{#if connectivityState.notice !== "none"}
    <ReloadBanner
        testId="connectivity-recovery-banner"
        showReloadButton={connectivityState.notice === "reload-required"}
        >サーバーに接続できていません。接続が回復するまで保存できない場合があります。</ReloadBanner
    >
{/if}
