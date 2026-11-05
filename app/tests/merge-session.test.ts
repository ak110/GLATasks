import { test, expect } from "@playwright/test";
import {
  cleanupTestLists,
  createListFromPage,
  isTrpcUrl,
  uniqueTestName,
} from "./helpers/common.ts";

for (const reopen of [false, true]) {
  test(`統合の古い成功が${reopen ? "別セッション" : "変更した統合先"}を閉じない`, async ({
    page,
    browser,
  }) => {
    const names = ["統合元", "統合先", "別の統合元"].map(uniqueTestName);
    const gate = Promise.withResolvers<void>();
    const intercepted = Promise.withResolvers<void>();
    const row = (name: string) =>
      page.getByTestId("list-item").filter({ hasText: name });
    try {
      await Promise.all([
        page.goto("/"),
        page.waitForResponse((response) =>
          response.url().includes("/api/trpc"),
        ),
      ]);
      for (const name of names) await createListFromPage(page, name);
      await row(names[0]).getByTestId("list-menu-btn").click();
      await page.getByRole("menuitem", { name: "他のリストに統合" }).click();
      const dialog = page.getByRole("dialog", { name: "リストの統合" });
      const target = dialog.getByLabel("統合先リスト");
      await target.selectOption({ label: names[1] });
      await page.route("**/api/trpc/**", async (route) => {
        if (!isTrpcUrl(route.request().url(), "lists.merge")) {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        intercepted.resolve();
        await gate.promise;
        await route.fulfill({ response });
      });
      await dialog.getByRole("button", { name: "統合", exact: true }).click();
      await intercepted.promise;
      if (reopen) {
        await dialog
          .getByRole("button", { name: "閉じる", exact: true })
          .click();
        await row(names[2]).getByTestId("list-menu-btn").click();
        await page.getByRole("menuitem", { name: "他のリストに統合" }).click();
      }
      const nextTargetName = reopen ? names[1] : names[2];
      await target.selectOption({ label: nextTargetName });
      const selected = await target.inputValue();
      const response = page.waitForResponse((result) =>
        isTrpcUrl(result.url(), "lists.merge"),
      );
      const refreshed = page.waitForResponse((result) =>
        isTrpcUrl(result.url(), "lists.list"),
      );
      gate.resolve();
      expect((await response).ok()).toBe(true);
      expect((await refreshed).ok()).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      await expect(dialog).toBeVisible();
      await expect(target).toHaveValue(selected);
      if (reopen) await expect(dialog).toContainText(names[2]);
    } finally {
      gate.resolve();
      await page.unroute("**/api/trpc/**");
      await cleanupTestLists(browser, names);
    }
  });
}
