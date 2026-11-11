<script lang="ts">
    import {
        startAuthentication,
        startRegistration,
    } from "@simplewebauthn/browser";
    import { invalidateAll } from "$app/navigation";
    import type { PageData } from "./$types";
    import { trpc, type RouterInputs } from "#lib/client/trpc.ts";
    import { passkeyError, requireWebAuthn } from "#lib/client/passkey.ts";
    import Header from "#lib/components/layout/Header.svelte";
    import PageScrollArea from "#lib/components/layout/PageScrollArea.svelte";
    import RecoveryCodes from "#lib/components/layout/RecoveryCodes.svelte";
    import { inputClass, grayButtonClass } from "#lib/components/ui/styles.ts";
    let { data }: { data: PageData } = $props();
    let password = $state("");
    let newPassword = $state("");
    let keyName = $state("追加のパスキー");
    let usePassword = $state(false);
    let codes = $state<string[]>([]);
    let disabling = $state(false);
    let disableAttempt = $state("");
    let busy = $state(false);
    let error = $state("");
    async function proof(passkeyOnly = false) {
        if (usePassword && data.passwordEnabled && !passkeyOnly)
            return { password };
        requireWebAuthn();
        const optionsJSON = await trpc.security.beginVerification.mutate();
        return { response: await startAuthentication({ optionsJSON }) };
    }
    async function run(operation: () => Promise<void>) {
        busy = true;
        error = "";
        try {
            await operation();
            password = "";
            await invalidateAll();
        } catch (e) {
            error = passkeyError(e);
        } finally {
            busy = false;
        }
    }
    async function manage(input: RouterInputs["security"]["manage"]) {
        const result = await trpc.security.manage.mutate(input);
        if ("codes" in result && result.codes) codes = result.codes;
        if ("attemptId" in result && result.attemptId)
            disableAttempt = result.attemptId;
        return result;
    }
    async function add() {
        const result = await manage({
            action: "beginAdd",
            proof: await proof(),
        });
        if (!("options" in result)) return;
        requireWebAuthn();
        await manage({
            action: "finishAdd",
            response: await startRegistration({ optionsJSON: result.options }),
            name: keyName,
        });
    }
    async function saved() {
        if (disabling) {
            await manage({
                action: "confirmDisable",
                attemptId: disableAttempt,
                saved: true,
            });
            usePassword = false;
        }
        disabling = false;
        codes = [];
    }
</script>

<Header page="security" isLoading={busy} />
<PageScrollArea>
    <main
        class="mx-auto max-w-2xl space-y-5 p-4 text-gray-800 dark:text-gray-100"
    >
        <h1 class="text-xl font-semibold">アカウントのセキュリティ</h1>
        <p>
            認証手段を変更するたびに、有効なパスキーか現在のパスワードで本人確認する。
        </p>
        {#if error}<p role="alert" class="text-red-600 dark:text-red-400">
                {error}
            </p>{/if}
        <fieldset disabled={busy} class="space-y-3">
            <legend class="font-semibold">本人確認の方法</legend>
            {#if data.passwordEnabled}
                <label class="flex cursor-pointer gap-2"
                    ><input
                        type="checkbox"
                        bind:checked={usePassword}
                        data-testid="use-password"
                    />現在のパスワードを使う</label
                >
                {#if usePassword}<label class="block" for="current-password"
                        >現在のパスワード</label
                    ><input
                        id="current-password"
                        type="password"
                        class={inputClass}
                        autocomplete="current-password"
                        bind:value={password}
                        data-testid="current-password"
                    />{/if}
            {/if}
            <h2 class="font-semibold">パスキー</h2>
            {#each data.passkeys as key (key.id)}
                <div
                    class="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700"
                    data-testid="passkey-row"
                >
                    <label class="block" for={key.id}>パスキーの名前</label>
                    <input
                        id={key.id}
                        class={inputClass}
                        value={key.name}
                        data-testid="passkey-name"
                        onchange={(e) =>
                            run(async () => {
                                await manage({
                                    action: "rename",
                                    id: key.id,
                                    name: e.currentTarget.value,
                                });
                            })}
                    />
                    <p class="text-sm">
                        登録: {new Date(key.created).toLocaleString()} / 最終利用:
                        {key.lastUsed
                            ? new Date(key.lastUsed).toLocaleString()
                            : "未使用"}
                    </p>
                    <button
                        type="button"
                        class={grayButtonClass}
                        disabled={!data.passwordEnabled &&
                            data.passkeys.length === 1}
                        onclick={() =>
                            run(async () => {
                                await manage({
                                    action: "delete",
                                    id: key.id,
                                    proof: await proof(),
                                });
                            })}
                        data-testid="passkey-delete">削除</button
                    >
                </div>
            {/each}
            <label class="block" for="new-key-name"
                >追加するパスキーの名前</label
            >
            <input
                id="new-key-name"
                class={inputClass}
                bind:value={keyName}
                data-testid="new-key-name"
            />
            <button
                type="button"
                class={grayButtonClass}
                onclick={() => run(add)}
                data-testid="passkey-add">パスキーを追加</button
            >
            <h2 class="font-semibold">
                パスワード（{data.passwordEnabled ? "有効" : "未設定・無効"}）
            </h2>
            <label class="block" for="new-password">新しいパスワード</label>
            <input
                id="new-password"
                type="password"
                class={inputClass}
                bind:value={newPassword}
                autocomplete="new-password"
                data-testid="new-password"
            />
            <button
                type="button"
                class={grayButtonClass}
                onclick={() =>
                    run(async () => {
                        await manage({
                            action: "password",
                            password: newPassword,
                            proof: await proof(),
                        });
                        newPassword = "";
                    })}
                data-testid="password-set">パスワードを設定</button
            >
            {#if data.passwordEnabled}
                <p>
                    無効化には登録済みパスキーでの本人確認と、新しい復旧コードの保存が必要だ。
                </p>
                <button
                    type="button"
                    class={grayButtonClass}
                    disabled={!data.passkeys.length}
                    onclick={() =>
                        run(async () => {
                            await manage({
                                action: "prepareDisable",
                                proof: await proof(true),
                            });
                            disabling = true;
                        })}
                    data-testid="password-disable">パスワードを無効化</button
                >
            {/if}
            <h2 class="font-semibold">復旧コード</h2>
            <p>再発行すると以前のコードは使えなくなる。</p>
            <button
                type="button"
                class={grayButtonClass}
                onclick={() =>
                    run(async () => {
                        disabling = false;
                        await manage({ action: "codes", proof: await proof() });
                    })}
                data-testid="codes-reissue">復旧コードを再発行</button
            >
        </fieldset>
        {#if codes.length}<RecoveryCodes
                {codes}
                onSaved={() => run(saved)}
            />{/if}
    </main>
</PageScrollArea>
