<script lang="ts">
    /**
     * @fileoverview 新バージョン検知バナー
     *
     * SvelteKitのversion.pollIntervalで新デプロイが検知されると
     * $app/state の updated.current が true になる。本コンポーネントは
     * その状態を購読し、画面上部固定で再読み込みを促すバナーを表示する。
     *
     * 長寿命 SPA セッションで新版 JS が読まれないまま古いコードで操作し続ける
     * ことを防ぐのが目的。navigation 時の hard reload は +layout.svelte 側の
     * beforeNavigate で補完している。
     */

    import { updated } from "$app/state";
    import ReloadBanner from "./ReloadBanner.svelte";
</script>

{#if updated.current}
    <ReloadBanner testId="update-banner"
        >新しいバージョンが利用可能です。</ReloadBanner
    >
{/if}
