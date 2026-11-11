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
}
async function logout(page: Page) {
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
}
async function credentials(cdp: CDPSession, id: string) {
  return (await cdp.send("WebAuthn.getCredentials", { authenticatorId: id }))
    .credentials;
}

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
    await page.getByTestId("security-link").click();
    const rename = waitForSuccessfulMutationResponse(page, "security.manage");
    await page.getByTestId("passkey-name").fill("端末のパスキー");
    await page.getByTestId("passkey-name").press("Tab");
    await rename;
    await expect(page.getByTestId("passkey-name")).toHaveValue(
      "端末のパスキー",
    );
    await page.getByTestId("new-password").fill("old-password-123");
    await securityOperation(page, "password-set");
    await page.getByTestId("use-password").check();
    await page.getByTestId("current-password").fill("old-password-123");
    const firstId = auth.id;
    await auth.cdp.send("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId: firstId,
    });
    const second = await virtualAuthenticator(page);
    await page.getByTestId("new-key-name").fill("予備");
    await page.getByTestId("passkey-add").click();
    await expect(page.getByTestId("passkey-row")).toHaveCount(2);
    await page.getByTestId("use-password").check();
    await page.getByTestId("current-password").fill("old-password-123");
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
    await page.getByTestId("use-password").uncheck();
    await securityOperation(page, "codes-reissue");
    await page.getByTestId("codes-saved").check();
    await securityOperation(page, "codes-reissue");
    await expect(page.getByTestId("codes-saved")).not.toBeChecked();
    await expect(page.getByTestId("codes-continue")).toBeDisabled();
    await codes(page);
    await page.getByTestId("use-password").check();
    await securityOperation(page, "password-disable");
    const recovery = await codes(page);
    await expect(page.getByTestId("use-password")).toHaveCount(0);
    const rejected = await context.request.post("/auth/login", {
      form: { user: name, password: "old-password-123" },
      maxRedirects: 0,
    });
    expect(rejected.status()).toBe(401);
    await page.getByTestId("new-password").fill("new-password-123");
    await securityOperation(page, "password-set");
    await expect(page.getByTestId("use-password")).toBeVisible();
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

test("パスキー: 埋め込み画面は戻り先を保って新しいタブで認証へ進む", async ({
  browser,
}) => {
  const context = await browser.newContext(
    makeContextOptions({ storageState: { cookies: [], origins: [] } }),
  );
  const page = await context.newPage();
  try {
    await page.goto("/auth/login");
    await page.setContent(
      '<iframe title="共有の認証" src="/auth/login?returnTo=%2Fshare%2Fingest%3Fin_popup%3D1"></iframe>',
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
