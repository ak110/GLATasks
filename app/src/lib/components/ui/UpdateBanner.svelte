<script lang="ts">
    /**
     * @fileoverview 新バージョン検知バナー
     *
     * SvelteKit の kit.version.pollInterval で新デプロイが検知されると
     * $app/state の updated.current が true になる。本コンポーネントは
     * その状態を購読し、画面上部固定で再読み込みを促すバナーを表示する。
     *
     * 長寿命 SPA セッションで新版 JS が読まれないまま古いコードで操作し続ける
     * ことを防ぐのが目的。navigation 時の hard reload は +layout.svelte 側の
     * beforeNavigate で補完している。
     */

    import { updated } from "$app/state";

    function reload() {
        location.reload();
    }
</script>

{#if updated.current}
    <div
        class="fixed top-0 right-0 left-0 z-50 flex items-center justify-center gap-3 bg-blue-600 px-4 py-2 text-sm text-white shadow-md dark:bg-blue-700"
        role="status"
        data-testid="update-banner"
    >
        <span>新しいバージョンが利用可能です。</span>
        <button
            type="button"
            class="cursor-pointer rounded bg-white px-3 py-1 font-semibold text-blue-700 hover:bg-blue-50 dark:bg-blue-100 dark:hover:bg-white"
            onclick={reload}
        >
            再読み込み
        </button>
    </div>
{/if}
