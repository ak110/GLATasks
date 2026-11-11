<script lang="ts">
    import AuthCard from "#lib/components/layout/AuthCard.svelte";
    import PasskeyAuth from "#lib/components/layout/PasskeyAuth.svelte";
    import { page } from "$app/state";
    import { resolve } from "$app/paths";
</script>

<AuthCard title="アカウントの復旧">
    <p>
        パスキーを失った場合は、保存した復旧コードを使って新しいパスキーを登録する。
    </p>
    <PasskeyAuth mode="recover" />
    {#snippet footer()}<a
            href="{resolve('/auth/login')}{page.url.search}"
            class="text-blue-600 underline">ログインへ戻る</a
        >{/snippet}
</AuthCard>
