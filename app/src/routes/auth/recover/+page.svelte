<script lang="ts">
    import AuthCard from "#lib/components/layout/AuthCard.svelte";
    import PasskeyAuth from "#lib/components/layout/PasskeyAuth.svelte";
    import { page } from "$app/state";
    import { resolve } from "$app/paths";
</script>

<AuthCard title="アカウントの復旧">
    <p>
        保存した復旧コードで本人確認し、新しいパスキーを登録する。その後、新しい復旧コードを保存するとログインできる。パスワードを使える場合は、ログイン画面からログインできる。
    </p>
    <PasskeyAuth mode="recover" />
    {#snippet footer()}<a
            href="{resolve('/auth/login')}{page.url.search}"
            class="text-blue-600 underline">ログインへ戻る</a
        >{/snippet}
</AuthCard>
