<script lang="ts">
    import AuthCard from "#lib/components/layout/AuthCard.svelte";
    import PasskeyAuth from "#lib/components/layout/PasskeyAuth.svelte";
    import { page } from "$app/state";
    import { resolve } from "$app/paths";
</script>

<AuthCard title="アカウントの復旧">
    <p>登録済みのパスキーと以前の復旧コードは使えなくなります。</p>
    <PasskeyAuth mode="recover" />
    {#snippet footer()}<a
            href="{resolve('/auth/login')}{page.url.search}"
            class="text-blue-600 underline dark:text-blue-400"
        >
            ログインへ戻る
        </a>{/snippet}
</AuthCard>
