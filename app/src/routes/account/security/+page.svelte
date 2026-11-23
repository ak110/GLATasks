<script lang="ts">
    import { tick } from "svelte";
    import { startRegistration } from "@simplewebauthn/browser";
    import { invalidateAll } from "$app/navigation";
    import type { PageData } from "./$types";
    import { trpc, type RouterInputs } from "#lib/client/trpc.ts";
    import {
        defaultPasskeyName,
        passkeyError,
        requireWebAuthn,
    } from "#lib/client/passkey.ts";
    import ConfirmDialog from "#lib/components/dialogs/ConfirmDialog.svelte";
    import Header from "#lib/components/layout/Header.svelte";
    import PageScrollArea from "#lib/components/layout/PageScrollArea.svelte";
    import RecoveryCodes from "#lib/components/layout/RecoveryCodes.svelte";
    import {
        actionAreaClass,
        dangerButtonClass,
        grayButtonClass,
        inputClass,
        nameAreaClass,
        primaryButtonClass,
    } from "#lib/components/ui/styles.ts";
    import VerificationDialog from "./VerificationDialog.svelte";
    import type { Proof } from "./verification.ts";
    let { data }: { data: PageData } = $props();
    let newPassword = $state("");
    let newPasswordConfirm = $state("");
    let passwordError = $state("");
    let passwordErrorField = $state<"new" | "confirm">();
    let newPasswordEl = $state<HTMLInputElement>();
    let newPasswordConfirmEl = $state<HTMLInputElement>();
    let editingId = $state<string>();
    let editingName = $state("");
    let deleteTarget = $state<{ id: string; name: string }>();
    let confirmingReissue = $state(false);
    let codes = $state<string[]>([]);
    let disabling = $state(false);
    let disableAttempt = $state("");
    let busy = $state(false);
    let error = $state("");
    let message = $state("");
    let feedback: HTMLDivElement;
    let codesPanel = $state<HTMLDivElement>();
    let pendingVerification = $state<{
        verify: (proof: Proof) => Promise<void>;
        cancel: () => void;
    }>();
    const CANCELLED = Symbol("cancelled");
    const dateFormat = { dateStyle: "medium", timeStyle: "short" } as const;

    function withProof<T>(
        step: (proof?: Proof) => Promise<T>,
    ): Promise<T | typeof CANCELLED> {
        if (data.authenticatedUntil >= Date.now()) return step();
        return new Promise((resolve) => {
            pendingVerification = {
                verify: async (proof) => {
                    const result = await step(proof);
                    pendingVerification = undefined;
                    resolve(result);
                },
                cancel: () => {
                    pendingVerification = undefined;
                    resolve(CANCELLED);
                },
            };
        });
    }
    async function run(operation: () => Promise<string | undefined>) {
        busy = true;
        error = "";
        message = "";
        try {
            const result = await operation();
            await invalidateAll();
            if (result) message = result;
        } catch (e) {
            await invalidateAll();
            error = passkeyError(e);
        } finally {
            busy = false;
            await tick();
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
        const result = await withProof((proof) =>
            manage({ action: "beginAdd", proof }),
        );
        if (result === CANCELLED || !("options" in result)) return;
        requireWebAuthn();
        await manage({
            action: "finishAdd",
            response: await startRegistration({ optionsJSON: result.options }),
            name: defaultPasskeyName(navigator.userAgent),
        });
        return "パスキーを追加しました。";
    }
    async function rename(id: string) {
        await manage({ action: "rename", id, name: editingName });
        editingId = undefined;
        return "パスキーの名前を変更しました。";
    }
    async function remove(id: string) {
        const result = await withProof((proof) =>
            manage({ action: "delete", id, proof }),
        );
        if (result === CANCELLED) return;
        return "パスキーを削除しました。";
    }
    async function submitPassword() {
        if (!newPassword) {
            passwordError = "新しいパスワードを入力してください。";
            passwordErrorField = "new";
        } else if (newPassword !== newPasswordConfirm) {
            passwordError =
                "確認用のパスワードが一致しません。同じパスワードを入力してください。";
            passwordErrorField = "confirm";
        } else {
            passwordError = "";
            passwordErrorField = undefined;
            await run(setPassword);
            return;
        }
        await tick();
        (passwordErrorField === "new"
            ? newPasswordEl
            : newPasswordConfirmEl
        )?.focus();
    }
    async function setPassword() {
        const wasEnabled = data.passwordEnabled;
        const result = await withProof((proof) =>
            manage({ action: "password", password: newPassword, proof }),
        );
        if (result === CANCELLED) return;
        newPassword = "";
        newPasswordConfirm = "";
        return wasEnabled
            ? "パスワードを変更しました。"
            : "パスワードを設定しました。";
    }
    async function disablePassword() {
        const result = await withProof((proof) =>
            manage({ action: "prepareDisable", proof }),
        );
        if (result === CANCELLED) return;
        disabling = true;
        return "復旧コードを保存すると、パスワードを無効化します。";
    }
    async function reissueCodes() {
        const result = await withProof((proof) =>
            manage({ action: "codes", proof }),
        );
        if (result === CANCELLED) return;
        disabling = false;
        return "新しい復旧コードを保存してください。";
    }
    async function saved() {
        const wasDisabling = disabling;
        if (disabling)
            await manage({
                action: "confirmDisable",
                attemptId: disableAttempt,
                saved: true,
            });
        disabling = false;
        codes = [];
        return wasDisabling
            ? "パスワードを無効化しました。パスキーでログインしてください。"
            : "復旧コードを再発行しました。以前の復旧コードは使えません。";
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
        <section
            class="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700"
            aria-labelledby="passkeys-heading"
        >
            <h2 id="passkeys-heading" class="font-semibold">パスキー</h2>
            {#if !data.passkeys.length}<p>
                    登録済みのパスキーはありません。
                </p>{/if}
            {#each data.passkeys as key (key.id)}
                <div
                    class="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700"
                    data-testid="passkey-row"
                >
                    {#if editingId === key.id}
                        <form
                            class="space-y-2"
                            onsubmit={(e) => {
                                e.preventDefault();
                                run(() => rename(key.id));
                            }}
                        >
                            <label class="block text-sm" for="rename-{key.id}">
                                パスキーの名前
                            </label>
                            <input
                                id="rename-{key.id}"
                                class="w-full {inputClass}"
                                bind:value={editingName}
                                disabled={busy}
                                data-testid="passkey-name-input"
                            />
                            <div class="flex flex-wrap gap-2">
                                <button
                                    type="submit"
                                    class={primaryButtonClass}
                                    disabled={busy || !editingName.trim()}
                                    data-testid="passkey-name-save"
                                >
                                    保存
                                </button>
                                <button
                                    type="button"
                                    class={grayButtonClass}
                                    disabled={busy}
                                    onclick={() => (editingId = undefined)}
                                    data-testid="passkey-name-cancel"
                                >
                                    キャンセル
                                </button>
                            </div>
                        </form>
                    {:else}
                        <div class="flex items-start gap-2">
                            <p
                                class="{nameAreaClass} font-medium"
                                data-testid="passkey-name"
                            >
                                {key.name}
                            </p>
                            <div class="{actionAreaClass} flex gap-2">
                                <button
                                    type="button"
                                    class={grayButtonClass}
                                    disabled={busy}
                                    onclick={() => {
                                        editingId = key.id;
                                        editingName = key.name;
                                    }}
                                    data-testid="passkey-rename"
                                >
                                    名前を変更
                                </button>
                                <button
                                    type="button"
                                    class={dangerButtonClass}
                                    disabled={busy ||
                                        (!data.passwordEnabled &&
                                            data.passkeys.length === 1)}
                                    onclick={() =>
                                        (deleteTarget = {
                                            id: key.id,
                                            name: key.name,
                                        })}
                                    data-testid="passkey-delete"
                                >
                                    削除
                                </button>
                            </div>
                        </div>
                    {/if}
                    <p class="text-sm text-gray-600 dark:text-gray-300">
                        登録: {new Date(key.created).toLocaleString(
                            undefined,
                            dateFormat,
                        )} / 最終利用:
                        {key.lastUsed
                            ? new Date(key.lastUsed).toLocaleString(
                                  undefined,
                                  dateFormat,
                              )
                            : "未使用"}
                    </p>
                    {#if !data.passwordEnabled && data.passkeys.length === 1}<p
                            class="text-sm"
                        >
                            最後のパスキーは削除できません。先にパスワードを設定するか、別のパスキーを追加してください。
                        </p>{/if}
                </div>
            {/each}
            <button
                type="button"
                class={primaryButtonClass}
                disabled={busy}
                onclick={() => run(add)}
                data-testid="passkey-add"
            >
                パスキーを追加
            </button>
        </section>
        <section
            class="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700"
            aria-labelledby="password-heading"
        >
            <h2 id="password-heading" class="font-semibold">パスワード</h2>
            <p data-testid="password-status">
                {data.passwordEnabled
                    ? "パスワードでもログインできます。"
                    : "パスワードは設定されていません。パスキーでログインします。"}
            </p>
            <form
                class="space-y-3"
                onsubmit={(e) => {
                    e.preventDefault();
                    void submitPassword();
                }}
            >
                <div class="space-y-1">
                    <label class="block text-sm" for="new-password">
                        新しいパスワード
                    </label>
                    <input
                        bind:this={newPasswordEl}
                        id="new-password"
                        type="password"
                        class={inputClass}
                        bind:value={newPassword}
                        autocomplete="new-password"
                        disabled={busy}
                        aria-invalid={passwordErrorField === "new"
                            ? "true"
                            : undefined}
                        aria-describedby={passwordErrorField === "new"
                            ? "new-password-error"
                            : undefined}
                        data-testid="new-password"
                    />
                </div>
                <div class="space-y-1">
                    <label class="block text-sm" for="new-password-confirm">
                        新しいパスワード（確認用）
                    </label>
                    <input
                        bind:this={newPasswordConfirmEl}
                        id="new-password-confirm"
                        type="password"
                        class={inputClass}
                        bind:value={newPasswordConfirm}
                        autocomplete="new-password"
                        disabled={busy}
                        aria-invalid={passwordErrorField === "confirm"
                            ? "true"
                            : undefined}
                        aria-describedby={passwordErrorField === "confirm"
                            ? "new-password-error"
                            : undefined}
                        data-testid="new-password-confirm"
                    />
                    {#if passwordError}<p
                            id="new-password-error"
                            class="text-sm text-red-600 dark:text-red-400"
                            data-testid="new-password-error"
                        >
                            {passwordError}
                        </p>{/if}
                </div>
                <button
                    type="submit"
                    class={primaryButtonClass}
                    disabled={busy}
                    data-testid="password-set"
                >
                    {data.passwordEnabled
                        ? "パスワードを変更"
                        : "パスワードを設定"}
                </button>
            </form>
            {#if data.passwordEnabled}
                <p>
                    無効化すると、パスキーでのみログインできます。新しい復旧コードの保存が必要です。
                </p>
                <button
                    type="button"
                    class={dangerButtonClass}
                    disabled={busy || !data.passkeys.length}
                    onclick={() => run(disablePassword)}
                    data-testid="password-disable"
                >
                    パスワードを無効化
                </button>
                {#if !data.passkeys.length}<p class="text-sm">
                        先にパスキーを追加してください。
                    </p>{/if}
            {/if}
        </section>
        <section
            class="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700"
            aria-labelledby="codes-heading"
        >
            <h2 id="codes-heading" class="font-semibold">復旧コード</h2>
            <p>再発行すると、以前の復旧コードは使えなくなります。</p>
            <button
                type="button"
                class={grayButtonClass}
                disabled={busy}
                onclick={() => (confirmingReissue = true)}
                data-testid="codes-reissue"
            >
                復旧コードを再発行
            </button>
        </section>
        {#if codes.length}<div bind:this={codesPanel} tabindex="-1">
                <RecoveryCodes {codes} onSaved={() => run(saved)} />
            </div>{/if}
    </main>
</PageScrollArea>
<ConfirmDialog
    open={deleteTarget !== undefined}
    title="パスキーの削除"
    message="「{deleteTarget?.name}」を削除します。削除したパスキーではログインできなくなります。"
    confirmLabel="削除"
    variant="danger"
    onCancel={() => (deleteTarget = undefined)}
    onConfirm={() => {
        const id = deleteTarget?.id;
        deleteTarget = undefined;
        if (id) run(() => remove(id));
    }}
/>
<ConfirmDialog
    open={confirmingReissue}
    title="復旧コードの再発行"
    message="再発行すると、以前の復旧コードは使えなくなります。新しい復旧コードを保存してください。"
    confirmLabel="再発行"
    variant="danger"
    onCancel={() => (confirmingReissue = false)}
    onConfirm={() => {
        confirmingReissue = false;
        run(reissueCodes);
    }}
/>
<VerificationDialog
    open={pendingVerification !== undefined}
    passwordEnabled={data.passwordEnabled}
    hasPasskeys={data.passkeys.length > 0}
    onVerify={(proof) => pendingVerification!.verify(proof)}
    onCancel={() => pendingVerification?.cancel()}
/>
