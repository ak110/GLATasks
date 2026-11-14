import { expect, test } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";
import {
  makeContextOptions,
  uniqueTestName,
  waitForSuccessfulMutationResponse,
} from "./helpers/common.ts";

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const result = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, id: result.authenticatorId };
}
async function codes(page: Page) {
  const text = await page
    .getByTestId("recovery-codes")
    .locator("pre")
    .innerText();
  await page.getByTestId("codes-saved").check();
  await page.getByTestId("codes-continue").click();
  await expect(page.getByTestId("recovery-codes")).toHaveCount(0);
  return text.split("\n");
}
async function securityOperation(page: Page, testId: string) {
  const response = waitForSuccessfulMutationResponse(page, "security.manage");
  await page.getByTestId(testId).click();
  await response;
  await expect(page.getByTestId(testId)).toBeEnabled();
  if (testId === "codes-reissue" || testId === "password-disable") {
    await expect(page.getByTestId("recovery-codes")).toBeInViewport();
    await expect(
      page.getByTestId("recovery-codes").locator(".."),
    ).toBeFocused();
  }
}
async function logout(page: Page) {
  await page.getByTestId("account-menu-toggle").click();
  await page.getByTestId("account-logout").click();
  await expect(page).toHaveURL(/\/auth\/login/);
}
async function credentials(cdp: CDPSession, id: string) {
  return (await cdp.send("WebAuthn.getCredentials", { authenticatorId: id }))
    .credentials;
}

test("パスキー: パスワードアカウントの初回追加は認証getなしで登録createを呼ぶ", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext(
    makeContextOptions({ storageState: { cookies: [], origins: [] } }),
  );
  try {
    const page = await context.newPage();
    const auth = await virtualAuthenticator(page);
    await page.clock.install();
    await page.addInitScript(() => {
      const calls: string[] = [];
      Object.defineProperty(window, "webauthnCalls", { value: calls });
      const get = CredentialsContainer.prototype.get;
      const create = CredentialsContainer.prototype.create;
      CredentialsContainer.prototype.get = function (options) {
        calls.push("get");
        return get.call(this, options);
      };
      CredentialsContainer.prototype.create = function (options) {
        calls.push("create");
        return create.call(this, options);
      };
    });
    const user = uniqueTestName("password")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 32);
    const password = "passkey-test-password-123";
    await page.goto("/auth/regist_user");
    await page.locator('[name="user_id"]').fill(user);
    await page.locator('[name="password"]').fill(password);
    await page.locator('[name="password_confirm"]').fill(password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await page.goto("/account/security");
    await expect(page.getByTestId("account-menu-toggle")).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("security-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({
      path: testInfo.outputPath("security-360.png"),
      fullPage: true,
    });
    await page.getByTestId("account-menu-toggle").click();
    await page.screenshot({
      path: testInfo.outputPath("account-menu-360.png"),
    });
    await page.keyboard.press("Escape");
    const currentPassword = page.getByTestId("current-password");
    await expect(currentPassword).toHaveCount(0);
    await page.getByTestId("passkey-add").click();
    const calls = () =>
      page.evaluate(
        () => (window as unknown as { webauthnCalls: string[] }).webauthnCalls,
      );
    await expect.poll(async () => (await calls()).length).toBeGreaterThan(0);
    const observed = await calls();
    console.log("webauthn-calls", JSON.stringify(observed));
    await testInfo.attach("webauthn-calls", {
      body: JSON.stringify(observed),
      contentType: "application/json",
    });
    expect(observed).toEqual(["create"]);
    await expect(page.getByTestId("passkey-row")).toHaveCount(1);
    await expect(page.getByTestId("passkey-add")).toBeEnabled();
    await page.clock.fastForward(900_001);
    await expect(currentPassword).toBeVisible();
    await expect(page.getByTestId("verification-method")).toHaveValue(
      "password",
    );
    await page.screenshot({
      path: testInfo.outputPath("security-expired-360.png"),
      fullPage: true,
    });
    await currentPassword.fill("incorrect-password");
    await page.getByTestId("passkey-add").click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await calls()).toEqual(["create"]);
    await page.screenshot({
      path: testInfo.outputPath("security-error-360.png"),
      fullPage: true,
    });
    await auth.cdp.send("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId: auth.id,
    });
    const second = await virtualAuthenticator(page);
    await currentPassword.fill(password);
    await page.getByTestId("passkey-add").click();
    await expect(page.getByTestId("passkey-row")).toHaveCount(2);
    console.log("webauthn-calls-after-expiry", JSON.stringify(await calls()));
    expect(await calls()).toEqual(["create", "create"]);
    await expect(page.getByTestId("passkey-add")).toBeEnabled();
    // パスワードが有効な場合の代替と、無効な場合の既定経路を同じ実認証器で通す。
    await page.clock.fastForward(900_001);
    await page.getByTestId("verification-method").selectOption("passkey");
    await securityOperation(page, "codes-reissue");
    await codes(page);
    expect(await calls()).toEqual(["create", "create", "get"]);
    await securityOperation(page, "password-disable");
    await codes(page);
    await expect(page.getByTestId("passkey-add")).toBeEnabled();
    await page.clock.fastForward(900_001);
    await expect(currentPassword).toHaveCount(0);
    await expect(page.getByTestId("verification-method")).toHaveCount(0);
    const beforePassword = await calls();
    await page.getByTestId("new-password").fill(password);
    await securityOperation(page, "password-set");
    expect(await calls()).toEqual([...beforePassword, "get"]);
    // 再有効化後はアプリが選んだパスキー確認を引き継がず、パスワードを既定に戻す。
    await page.clock.fastForward(900_001);
    await expect(currentPassword).toBeVisible();
    await expect(page.getByTestId("verification-method")).toHaveValue(
      "password",
    );
    await currentPassword.fill(password);
    await second.cdp.send("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId: second.id,
    });
    await virtualAuthenticator(page);
    const beforeAdd = await calls();
    await page.getByTestId("passkey-add").click();
    await expect(page.getByTestId("passkey-row")).toHaveCount(3);
    expect(await calls()).toEqual([...beforeAdd, "create"]);
  } finally {
    await context.close();
  }
});

test("パスキー: 登録・ログイン・管理・パスワード無効化と再有効化・紛失復旧・再ログイン", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const context = await browser.newContext(
    makeContextOptions({ storageState: { cookies: [], origins: [] } }),
  );
  const page = await context.newPage();
  const auth = await virtualAuthenticator(page);
  const name = uniqueTestName("pk")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 32);
  try {
    await page.goto("/auth/regist_user?returnTo=%2Faccount%2Fsecurity");
    await page.getByTestId("passkey-user").fill(name);
    await page.getByTestId("passkey-submit").click();
    await expect(page.getByTestId("recovery-codes")).toBeVisible();
    await codes(page);
    await expect(page).toHaveURL(/\/account\/security/);
    await expect(page.getByTestId("passkey-row")).toHaveCount(1);
    await page.setViewportSize({ width: 320, height: 851 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.screenshot({
      path: testInfo.outputPath("security-narrow-light.png"),
      fullPage: true,
    });
    await page.getByTestId("theme-toggle").click();
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({
      path: testInfo.outputPath("security-narrow-dark.png"),
      fullPage: true,
    });
    await page.getByTestId("theme-toggle").click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await logout(page);
    await page.getByTestId("passkey-submit").click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    const account = page.getByTestId("account-menu-toggle");
    await account.focus();
    await account.press("Enter");
    await account.press("ArrowDown");
    await expect(page.getByTestId("security-link")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();
    await expect(page.getByTestId("account-menu")).toHaveCount(0);
    await account.press("Enter");
    await account.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/account\/security/);
    await expect(page.getByTestId("new-key-name")).toHaveValue("Chrome");
    const rename = waitForSuccessfulMutationResponse(page, "security.manage");
    await page.getByTestId("passkey-name").fill("端末のパスキー");
    await page.getByTestId("passkey-name").press("Tab");
    await rename;
    await expect(page.getByTestId("passkey-name")).toHaveValue(
      "端末のパスキー",
    );
    await page.getByTestId("new-password").fill("old-password-123");
    await securityOperation(page, "password-set");
    const firstId = auth.id;
    await auth.cdp.send("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId: firstId,
    });
    const second = await virtualAuthenticator(page);
    await page.getByTestId("new-key-name").fill("予備");
    await page.getByTestId("passkey-add").click();
    await expect(page.getByTestId("passkey-row")).toHaveCount(2);
    await expect(page.getByTestId("new-key-name")).toHaveValue("予備");
    for (const row of await page.getByTestId("passkey-row").all()) {
      if (
        (await row.getByTestId("passkey-name").inputValue()) ===
        "端末のパスキー"
      )
        await row.getByTestId("passkey-delete").click();
    }
    await expect(page.getByTestId("passkey-row")).toHaveCount(1);
    auth.cdp = second.cdp;
    auth.id = second.id;
    await securityOperation(page, "codes-reissue");
    await page.getByTestId("codes-saved").check();
    await securityOperation(page, "codes-reissue");
    await expect(page.getByTestId("codes-saved")).not.toBeChecked();
    await expect(page.getByTestId("codes-continue")).toBeDisabled();
    await codes(page);
    await securityOperation(page, "password-disable");
    const recovery = await codes(page);
    await expect(page.getByTestId("current-password")).toHaveCount(0);
    const rejected = await context.request.post("/auth/login", {
      form: { user: name, password: "old-password-123" },
      maxRedirects: 0,
    });
    expect(rejected.status()).toBe(401);
    await page.getByTestId("new-password").fill("new-password-123");
    await securityOperation(page, "password-set");
    await expect(page.getByTestId("password-set")).toBeVisible();
    const stale = await browser.newContext(
      makeContextOptions({ storageState: await context.storageState() }),
    );
    const oldCredentials = await credentials(auth.cdp, auth.id);
    try {
      await logout(page);
      await auth.cdp.send("WebAuthn.clearCredentials", {
        authenticatorId: auth.id,
      });
      await page.goto("/auth/recover?returnTo=%2Faccount%2Fsecurity");
      await page.getByTestId("passkey-user").fill(name);
      await page.getByTestId("recovery-code").fill(recovery[0]);
      await page.getByTestId("passkey-submit").click();
      await expect(page.getByTestId("passkey-submit")).toHaveText(
        "新しいパスキーを登録",
      );
      expect(
        (
          await context.request.get("/account/security", { maxRedirects: 0 })
        ).status(),
      ).toBe(302);
      // 本人確認済みのまま復旧状態が失効しても、別の未使用コードでやり直せる。
      await context.clearCookies({ name: "__Host-gla-recovery" });
      await page.getByTestId("passkey-submit").click();
      await expect(page.getByRole("alert")).toContainText(
        "復旧コードの入力に戻り",
      );
      await page.getByTestId("recovery-back").click();
      await page.getByTestId("recovery-code").fill(recovery[1]);
      await page.getByTestId("passkey-submit").click();
      await expect(
        page.getByText("本人確認が完了しました。15分以内に登録してください。"),
      ).toBeVisible();
      await expect(page.getByTestId("recovery-back")).toBeVisible();
      // 中断後に開き直した画面から、有効な復旧状態で再登録へ進めることを確かめる。
      await page.reload();
      await page
        .getByRole("button", { name: "本人確認済みの登録を再開" })
        .click();
      await expect(page.getByTestId("recovery-back")).toBeVisible();
      await page.getByTestId("passkey-submit").click();
      await expect(page.getByTestId("recovery-codes")).toBeVisible();
      await codes(page);
      await expect(page).toHaveURL(/\/account\/security/);
      expect(
        (
          await stale.request.get("/account/security", { maxRedirects: 0 })
        ).status(),
      ).toBe(302);
      const nextCredentials = await credentials(auth.cdp, auth.id);
      await logout(page);
      await auth.cdp.send("WebAuthn.clearCredentials", {
        authenticatorId: auth.id,
      });
      for (const credential of oldCredentials)
        await auth.cdp.send("WebAuthn.addCredential", {
          authenticatorId: auth.id,
          credential,
        });
      await page.getByTestId("passkey-submit").click();
      await expect(page.getByRole("alert")).toBeVisible();
      await auth.cdp.send("WebAuthn.clearCredentials", {
        authenticatorId: auth.id,
      });
      for (const credential of nextCredentials)
        await auth.cdp.send("WebAuthn.addCredential", {
          authenticatorId: auth.id,
          credential,
        });
      await page.getByTestId("passkey-submit").click();
      await expect(page).toHaveURL((url) => url.pathname === "/");
    } finally {
      await stale.close();
    }
  } finally {
    await context.close();
  }
});

test("パスキー: 不正originの登録失敗はユーザーIDを占有しない", async ({
  browser,
}) => {
  const context = await browser.newContext(
    makeContextOptions({ storageState: { cookies: [], origins: [] } }),
  );
  const page = await context.newPage();
  await virtualAuthenticator(page);
  try {
    const name = uniqueTestName("reject")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 32);
    await page.goto("/auth/regist_user");
    await page.route("**/auth/passkey", async (route) => {
      const input = route.request().postDataJSON();
      if (input.action === "finishRegister") {
        const client = JSON.parse(
          Buffer.from(
            input.response.response.clientDataJSON,
            "base64url",
          ).toString(),
        );
        client.origin = "https://evil.example";
        input.response.response.clientDataJSON = Buffer.from(
          JSON.stringify(client),
        ).toString("base64url");
        await route.continue({ postData: JSON.stringify(input) });
      } else await route.continue();
    });
    await page.getByTestId("passkey-user").fill(name);
    await page.getByTestId("passkey-submit").click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("recovery-codes")).toHaveCount(0);
    await page.unroute("**/auth/passkey");
    await page.getByTestId("passkey-submit").click();
    await expect(page.getByTestId("recovery-codes")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("パスキー: 本人確認前の再開は完了を断定せず、復旧コードの入力へ戻れる", async ({
  browser,
}) => {
  const context = await browser.newContext(
    makeContextOptions({ storageState: { cookies: [], origins: [] } }),
  );
  const page = await context.newPage();
  try {
    await virtualAuthenticator(page);
    await page.goto("/auth/recover");
    await page
      .getByRole("button", { name: "本人確認済みの登録を再開" })
      .click();
    await expect(page.getByText("本人確認が完了しました。")).toHaveCount(0);
    await expect(
      page.getByText("本人確認から15分以内は登録を再開できます。"),
    ).toBeVisible();
    await page.getByTestId("passkey-submit").click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "復旧コードの入力に戻り",
    );
    await page.getByTestId("recovery-back").click();
    await expect(page.getByTestId("recovery-code")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("パスキー: 埋め込み画面は戻り先を保って新しいタブで認証へ進む", async ({
  browser,
}) => {
  const context = await browser.newContext(
    makeContextOptions({ storageState: { cookies: [], origins: [] } }),
  );
  const page = await context.newPage();
  try {
    await page.goto("/auth/login");
    // Chrome拡張のポップアップ（chrome_extension/popup.html）と同じ500x500で埋め込む。
    // 既定の300x150では、リンクをスクロールで表示してもiframeの外へはみ出し、外側の文書がクリックを受ける。
    await page.setContent(
      '<iframe title="共有の認証" style="width: 500px; height: 500px; border: none" src="/auth/login?returnTo=%2Fshare%2Fingest%3Fin_popup%3D1"></iframe>',
    );
    const frame = page.frameLocator("iframe");
    await expect(frame.getByTestId("passkey-open-tab")).toBeVisible();
    await expect(frame.getByTestId("passkey-submit")).toHaveCount(0);
    const opened = context.waitForEvent("page");
    await frame.getByTestId("passkey-open-tab").click();
    const popup = await opened;
    await expect(popup).toHaveURL(
      (url) =>
        url.pathname === "/auth/login" &&
        url.searchParams.get("returnTo") === "/share/ingest?in_popup=1",
    );
    await expect(popup.getByTestId("passkey-submit")).toBeEnabled();
  } finally {
    await context.close();
  }
});
