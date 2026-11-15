<script lang="ts">
    import { startAuthentication } from "@simplewebauthn/browser";
    import Dialog from "#lib/components/dialogs/Dialog.svelte";
    import { trpc } from "#lib/client/trpc.ts";
    import { passkeyError, requireWebAuthn } from "#lib/client/passkey.ts";
    import {
        grayButtonClass,
        inputClass,
        primaryButtonClass,
    } from "#lib/components/ui/styles.ts";
    import type { Proof } from "./verification.ts";

    /**
     * 本人確認の期限を過ぎた状態で操作を押した時に、その操作の直前で本人確認を求める。
     * onVerifyは証明を使う最初の操作を実行し、失敗をこのダイアログ内に示して再入力させる。
     */
    interface Props {
        open: boolean;
        passwordEnabled: boolean;
        hasPasskeys: boolean;
        onVerify: (proof: Proof) => Promise<void>;
        onCancel: () => void;
    }
    let { open, passwordEnabled, hasPasskeys, onVerify, onCancel }: Props =
        $props();
    let method = $state<"password" | "passkey">("password");
    let password = $state("");
    let error = $state("");
    let busy = $state(false);
    let passwordEl = $state<HTMLInputElement | null>(null);
    const usePassword = $derived(passwordEnabled && method === "password");

    // 開くたびに既定の方法と入力を初期化し、前回の失敗を持ち越さない。
    let prevOpen = $state(false);
    $effect(() => {
        if (open && !prevOpen) {
            method = "password";
            password = "";
            error = "";
        }
        prevOpen = open;
    });

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        busy = true;
        error = "";
        try {
            if (usePassword) await onVerify({ password });
            else {
                requireWebAuthn();
                const optionsJSON =
                    await trpc.security.beginVerification.mutate();
                await onVerify({
                    response: await startAuthentication({ optionsJSON }),
                });
            }
        } catch (e) {
            error = passkeyError(e);
        } finally {
            busy = false;
        }
    }
</script>

<Dialog
    {open}
    title="本人確認"
    widthClass="max-w-sm"
    testId="verification-dialog"
    onClose={onCancel}
    initialFocus={() => passwordEl}
>
    <form class="space-y-3 px-6 pb-6" onsubmit={submit}>
        <p class="text-sm">
            前回の本人確認から15分を過ぎたため、続ける前に本人確認をしてください。
        </p>
        {#if passwordEnabled && hasPasskeys}
            <fieldset class="space-y-1" disabled={busy}>
                <legend class="text-sm font-semibold">確認方法</legend>
                <label class="flex cursor-pointer items-center gap-2">
                    <input
                        type="radio"
                        value="password"
                        bind:group={method}
                        data-testid="verification-method-password"
                    />
                    パスワード
                </label>
                <label class="flex cursor-pointer items-center gap-2">
                    <input
                        type="radio"
                        value="passkey"
                        bind:group={method}
                        data-testid="verification-method-passkey"
                    />
                    登録済みのパスキー
                </label>
            </fieldset>
        {/if}
        {#if usePassword}
            <label class="block text-sm" for="current-password"
                >現在のパスワード</label
            >
            <input
                bind:this={passwordEl}
                id="current-password"
                type="password"
                class="w-full {inputClass}"
                autocomplete="current-password"
                bind:value={password}
                disabled={busy}
                data-testid="current-password"
            />
        {:else}
            <p class="text-sm">登録済みのパスキーで確認します。</p>
        {/if}
        {#if error}<p
                role="alert"
                class="text-sm text-red-600 dark:text-red-400"
            >
                {error}
            </p>{/if}
        <div class="flex justify-end gap-2 pt-2">
            <button type="button" class={grayButtonClass} onclick={onCancel}
                >キャンセル</button
            >
            <button
                type="submit"
                class={primaryButtonClass}
                disabled={busy || (usePassword && !password)}
                data-testid="verification-submit">確認して続ける</button
            >
        </div>
    </form>
</Dialog>
