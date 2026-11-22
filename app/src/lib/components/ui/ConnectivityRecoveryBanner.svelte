<script lang="ts">
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
