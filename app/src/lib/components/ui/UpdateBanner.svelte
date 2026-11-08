<script lang="ts">
    /**
     * @fileoverview 新バージョン検知バナーと自動再読み込み
     *
     * SvelteKitのversion.pollIntervalによる定期確認か、画面遷移のデータ応答の
     * x-sveltekit-versionで新デプロイが検知されると $app/state の updated.current が true になる
     * （遷移ごとのデータ応答は +layout.server.ts がパスを参照することで発生する）。本コンポーネントは
     * その状態を購読し、作業中でなければ自動で再読み込みする（条件は`update-reload.ts`）。
     * 作業中は画面上部のバナーで新しい版を知らせ、作業が終わった時点で自動で再読み込みする。
     *
     * 長寿命 SPA セッションで新版 JS が読まれないまま古いコードで操作し続ける
     * ことを防ぐのが目的。navigation 時の hard reload は +layout.svelte 側の
     * beforeNavigate で補完している。
     */

    import { updated } from "$app/state";
    import { queryClient } from "#lib/client/query-client.ts";
    import { classifyHealth } from "#lib/client/sse/connectivity-check.js";
    import { startUpdateAutoReload } from "#lib/client/ui/update-reload.ts";
    import { isUserBusy } from "#lib/client/ui/user-busy.ts";
    import ReloadBanner from "./ReloadBanner.svelte";

    $effect(() => {
        if (!updated.current) return;
        return startUpdateAutoReload({
            isBusy: isUserBusy,
            hasPendingWrites: () => queryClient.isMutating() > 0,
            isServerHealthy: async () => (await classifyHealth()) === "healthy",
            reload: () => {
                // eslint-disable-next-line no-restricted-syntax -- 新しい版の検知後、接続が健全と判定できた場合だけ再読み込みする
                location.reload();
            },
        });
    });
</script>

{#if updated.current}
    <ReloadBanner testId="update-banner"
        >新しいバージョンが利用可能です。</ReloadBanner
    >
{/if}
