<script lang="ts">
    import { updated } from "$app/state";
    import { queryClient } from "#lib/client/query-client.ts";
    import { classifyHealth } from "#lib/client/sse/connectivity-check.js";
    import { hasPendingDirectWrites } from "#lib/client/ui/pending-writes.ts";
    import { startUpdateAutoReload } from "#lib/client/ui/update-reload.ts";
    import { isUserBusy } from "#lib/client/ui/user-busy.ts";
    import ReloadBanner from "./ReloadBanner.svelte";

    $effect(() => {
        if (!updated.current) return;
        return startUpdateAutoReload({
            isBusy: isUserBusy,
            hasPendingWrites: () =>
                queryClient.isMutating() > 0 || hasPendingDirectWrites(),
            isServerHealthy: async () => (await classifyHealth()) === "healthy",
            reload: () => {
                // eslint-disable-next-line no-restricted-syntax -- 新しい版の検知後、接続が健全と判定できた場合だけ再読み込みする
                location.reload();
            },
        });
    });
</script>

{#if updated.current}
    <ReloadBanner testId="update-banner">
        新しいバージョンが利用可能です。入力や保存が終わると自動で再読み込みします。
    </ReloadBanner>
{/if}
