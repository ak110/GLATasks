<script lang="ts">
    /**
     * @fileoverview 接続不全の案内バナー
     *
     * 能動検出（`connection-recovery.svelte.ts`）の`connectivityState.notice`を購読し、
     * 回復を検知して`notice`が`"none"`へ戻った時点で自動的に消える。
     * 到達不能の案内は再読み込みを促さない。通信断の間の再読み込みはオフライン画面へ移り、
     * 回復後はバナーが自動で消えて再読み込みが不要なためである。
     * 到達不能の案内にも、認証画面を別ウィンドウで開くボタンを表示する。HTTPSの通信自体を遮断する認証画面は
     * 通信エラーとなり、到達不能と区別できないためである。
     * 認証に進む前に入力を退避できない場合は、認証画面へ進むための再読み込みボタンと、
     * 入力中の画面を残したまま認証画面を別ウィンドウで開くボタンを表示する。
     */

    import {
        connectivityState,
        openAuthWindow,
    } from "#lib/client/sse/connection-recovery.svelte.ts";
    import ReloadBanner from "./ReloadBanner.svelte";
</script>

{#snippet authAction(buttonClass: string)}
    <button type="button" class={buttonClass} onclick={() => openAuthWindow()}
        >認証画面を開く</button
    >
{/snippet}

{#if connectivityState.notice !== "none"}
    <ReloadBanner
        testId="connectivity-recovery-banner"
        showReloadButton={connectivityState.notice === "reload-required"}
        actions={authAction}
        >{#if connectivityState.notice === "reload-required"}再読み込みすると認証画面が開きますが、入力中の内容が消える場合があります。{:else}サーバーに接続できていません。接続が回復するまで保存できない場合があります。Wi-Fiなどの認証が必要な場合は「認証画面を開く」から認証してください。接続が回復するとこの表示は自動で消えます。{/if}</ReloadBanner
    >
{/if}
