<script lang="ts">
    import { onMount } from "svelte";
    import {
        startAuthentication,
        startRegistration,
    } from "@simplewebauthn/browser";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { page } from "$app/state";
    import {
        defaultPasskeyName,
        passkeyError,
        publicPasskeyRequest,
        requireWebAuthn,
    } from "#lib/client/passkey.ts";
    import { grayButtonClass, inputClass } from "#lib/components/ui/styles.ts";
    import RecoveryCodes from "./RecoveryCodes.svelte";

    let { mode }: { mode: "login" | "register" | "recover" } = $props();
    let userId = $state("");
    let code = $state("");
    let error = $state("");
    let busy = $state(false);
    let recovering = $state(false);
    let verified = $state(false);
    let embedded = $state(false);
    let ready = $state(false);
    let codes = $state<string[]>([]);
    onMount(() => {
        embedded = window.self !== window.top;
        ready = true;
    });
    async function finish() {
        const target = page.url.searchParams.get("returnTo");
        await goto(
            resolve(
                (target?.startsWith("/") &&
                !target.startsWith("//") &&
                !target.includes("\\")
                    ? target
                    : "/") as "/",
            ),
            { invalidateAll: true },
        );
    }
    async function run() {
        busy = true;
        error = "";
        try {
            requireWebAuthn();
            if (mode === "recover" && !recovering) {
                await publicPasskeyRequest({ action: "recover", userId, code });
                code = "";
                recovering = true;
                verified = true;
                return;
            }
            if (mode === "login") {
                const begin = await publicPasskeyRequest({
                    action: "beginLogin",
                });
                if (!begin.options || !("rpId" in begin.options))
                    throw new Error(
                        "認証を開始できませんでした。やり直してください。",
                    );
                await publicPasskeyRequest({
                    action: "finishLogin",
                    response: await startAuthentication({
                        optionsJSON: begin.options,
                    }),
                });
                await finish();
                return;
            }
            const begin = await publicPasskeyRequest(
                mode === "register"
                    ? { action: "beginRegister", userId }
                    : { action: "beginRecovery" },
            );
            if (!begin.options || !("rp" in begin.options))
                throw new Error(
                    "登録を開始できませんでした。やり直してください。",
                );
            const result = await publicPasskeyRequest({
                action:
                    mode === "register" ? "finishRegister" : "finishRecovery",
                response: await startRegistration({
                    optionsJSON: begin.options,
                }),
                name: defaultPasskeyName(navigator.userAgent),
            });
            if ("codes" in result && result.codes) codes = result.codes;
        } catch (e) {
            error = passkeyError(e);
        } finally {
            busy = false;
        }
    }
</script>

<section class="my-4 space-y-3" aria-label="パスキー認証">
    {#if embedded}
        <p>
            埋め込み画面ではパスキーを使えません。新しいタブで認証し、この共有画面を開き直してください。
        </p>
        <a
            href={resolve(
                (page.url.pathname + page.url.search) as "/auth/login",
            )}
            target="_blank"
            rel="noopener"
            class="text-blue-600 underline dark:text-blue-400"
            data-testid="passkey-open-tab"
        >
            新しいタブで認証する
        </a>
    {:else if codes.length}
        <RecoveryCodes {codes} onSaved={finish} />
    {:else}
        <h2 class="font-semibold">
            {mode === "login"
                ? "パスキーでログイン"
                : mode === "register"
                  ? "パスキーで登録"
                  : recovering
                    ? "2. 新しいパスキーを登録"
                    : "1. 復旧コードで本人確認"}
        </h2>
        {#if mode !== "login" && !recovering}
            <label class="block" for="passkey-user">ユーザーID</label>
            <input
                id="passkey-user"
                class={inputClass}
                bind:value={userId}
                autocomplete="username"
                data-testid="passkey-user"
            />
        {/if}
        {#if mode === "recover" && !recovering}
            <label class="block" for="recovery-code">未使用の復旧コード</label>
            <input
                id="recovery-code"
                class={inputClass}
                bind:value={code}
                autocomplete="off"
                data-testid="recovery-code"
            />
            <p class="text-sm">
                このブラウザーで本人確認済みなら、15分以内は登録を再開できます。
            </p>
            <button
                type="button"
                class={grayButtonClass}
                disabled={!ready}
                onclick={() => {
                    recovering = true;
                }}
            >
                本人確認済みの登録を再開
            </button>
        {/if}
        {#if recovering && verified}<p>
                本人確認が完了しました。15分以内に登録してください。
            </p>{:else if recovering}<p>
                本人確認から15分以内は登録を再開できます。開始できない場合は、復旧コードの入力に戻ってください。
            </p>
        {/if}
        {#if recovering}
            <button
                type="button"
                class={grayButtonClass}
                onclick={() => {
                    recovering = false;
                    verified = false;
                    error = "";
                }}
                data-testid="recovery-back"
            >
                復旧コードの入力に戻る
            </button>
        {/if}
        <button
            type="button"
            class={grayButtonClass}
            disabled={busy || !ready}
            onclick={run}
            data-testid="passkey-submit"
        >
            {busy
                ? "認証中…"
                : mode === "login"
                  ? "パスキーでログイン"
                  : mode === "register"
                    ? "パスキーを作成して登録"
                    : recovering
                      ? "新しいパスキーを登録"
                      : "復旧コードで本人確認"}
        </button>
    {/if}
    {#if error}<p role="alert" class="text-red-600 dark:text-red-400">
            {error}
        </p>{/if}
</section>
