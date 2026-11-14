<script lang="ts">
    import { onMount, tick } from "svelte";
    import {
        startAuthentication,
        startRegistration,
    } from "@simplewebauthn/browser";
    import { invalidateAll } from "$app/navigation";
    import type { PageData } from "./$types";
    import { trpc, type RouterInputs } from "#lib/client/trpc.ts";
    import {
        defaultPasskeyName,
        passkeyError,
        requireWebAuthn,
    } from "#lib/client/passkey.ts";
    import Header from "#lib/components/layout/Header.svelte";
    import PageScrollArea from "#lib/components/layout/PageScrollArea.svelte";
    import RecoveryCodes from "#lib/components/layout/RecoveryCodes.svelte";
    import { inputClass, grayButtonClass } from "#lib/components/ui/styles.ts";
    let { data }: { data: PageData } = $props();
    let password = $state("");
    let newPassword = $state("");
    let keyName = $state("このブラウザー");
    onMount(() => {
        keyName = defaultPasskeyName(navigator.userAgent);
    });
    let verificationMethod = $state("password");
    let currentTime = $state(Date.now());
    const authenticationRequired = $derived(
        data.authenticatedUntil < currentTime,
    );
    $effect(() => {
        const now = Date.now();
        currentTime = now;
        const remaining = data.authenticatedUntil - now;
        if (remaining < 0) return;
        const timer = setTimeout(() => {
            currentTime = Date.now();
        }, remaining + 1);
        return () => clearTimeout(timer);
    });
    let codes = $state<string[]>([]);
    let disabling = $state(false);
    let disableAttempt = $state("");
    let busy = $state(false);
    let error = $state("");
    let message = $state("");
    let feedback: HTMLDivElement;
    let codesPanel = $state<HTMLDivElement>();
    async function proof() {
        if (data.authenticatedUntil >= Date.now()) return;
        if (verificationMethod === "password" && data.passwordEnabled)
            return { password };
        requireWebAuthn();
        const optionsJSON = await trpc.security.beginVerification.mutate();
        return { response: await startAuthentication({ optionsJSON }) };
    }
    async function run(operation: () => Promise<void>) {
        busy = true;
        error = "";
        message = "";
        try {
            await operation();
            password = "";
            await invalidateAll();
            message = codes.length
                ? "復旧コードを保存してください。"
                : "保存しました。";
        } catch (e) {
            await invalidateAll();
            error = passkeyError(e);
        } finally {
            busy = false;
            await tick();
            // 発行後の保存欄や操作結果がスクロール外に追加されても、次の手順へ移れるようにする。
            (error || !codes.length ? feedback : codesPanel)?.focus();
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
            verificationMethod = "password";
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
        <h1 class="text-xl font-semibold">アカウント設定</h1>
        <div bind:this={feedback} tabindex="-1">
            {#if error}<p role="alert" class="text-red-600 dark:text-red-400">
                    {error}
                </p>{/if}
            {#if message}<p role="status">{message}</p>{/if}
        </div>
        {#if authenticationRequired}<fieldset
                disabled={busy}
                class="space-y-3 rounded border border-gray-200 p-4 dark:border-gray-700"
            >
                <legend class="px-1 font-semibold">変更時の本人確認</legend>
                {#if data.passwordEnabled}
                    {#if data.passkeys.length}<label
                            class="block"
                            for="verification-method">本人確認方法</label
                        >
                        <select
                            id="verification-method"
                            class={inputClass}
                            bind:value={verificationMethod}
                            data-testid="verification-method"
                        >
                            <option value="password">パスワード</option>
                            <option value="passkey">登録済みのパスキー</option>
                        </select>{/if}
                    {#if verificationMethod === "password"}<label
                            class="block"
                            for="current-password">現在のパスワード</label
                        ><input
                            id="current-password"
                            type="password"
                            class={inputClass}
                            autocomplete="current-password"
                            bind:value={password}
                            data-testid="current-password"
                        />{/if}
                {/if}
                {#if verificationMethod === "passkey" || !data.passwordEnabled}<p
                        class="text-sm"
                    >
                        変更時に登録済みのパスキーで本人確認します。
                    </p>{/if}
            </fieldset>{/if}
        <fieldset
            disabled={busy}
            class="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700"
        >
            <legend class="font-semibold">パスキー</legend>
            {#if !data.passkeys.length}<p>
                    登録済みのパスキーはありません。
                </p>{/if}
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
                    {#if !data.passwordEnabled && data.passkeys.length === 1}<p
                            class="text-sm"
                        >
                            最後のパスキーは削除できません。
                        </p>{/if}
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
        </fieldset>
        <fieldset
            disabled={busy}
            class="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700"
        >
            <legend class="font-semibold">
                パスワード（{data.passwordEnabled ? "有効" : "未設定・無効"}）
            </legend>
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
                    無効化すると、パスキーでのみログインできます。復旧コードの保存が必要です。
                </p>
                <button
                    type="button"
                    class={grayButtonClass}
                    disabled={!data.passkeys.length}
                    onclick={() =>
                        run(async () => {
                            await manage({
                                action: "prepareDisable",
                                proof: await proof(),
                            });
                            disabling = true;
                        })}
                    data-testid="password-disable">パスワードを無効化</button
                >
                {#if !data.passkeys.length}<p class="text-sm">
                        先にパスキーを追加してください。
                    </p>{/if}
            {/if}
        </fieldset>
        <fieldset
            disabled={busy}
            class="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700"
        >
            <legend class="font-semibold">復旧コード</legend>
            <p>再発行すると、以前の復旧コードは使えなくなります。</p>
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
        {#if codes.length}<div bind:this={codesPanel} tabindex="-1">
                <RecoveryCodes {codes} onSaved={() => run(saved)} />
            </div>{/if}
    </main>
</PageScrollArea>
