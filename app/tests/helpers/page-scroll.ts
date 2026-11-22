import { requireBoundingBox } from "./common";
import { expect, type Page } from "@playwright/test";
import { openStubbedPage } from "./translate-page";
export { requireBoundingBox } from "./common";

export const PAGE_NAMES = ["tasks", "timers", "translate", "calories"] as const;

export type PageName = (typeof PAGE_NAMES)[number];

export async function openPage(page: Page, name: PageName): Promise<void> {
  if (name === "translate") {
    // ブラウザ内蔵AI APIはPlaywright同梱のChromiumに存在しないため、スタブを注入して開く
    await openStubbedPage(page);
  } else {
    const path = name === "tasks" ? "/" : `/${name}`;
    await Promise.all([
      page.goto(path),
      page.waitForResponse((response) => response.url().includes("/api/trpc")),
    ]);
  }
  await expect(page.getByTestId("theme-toggle")).toBeVisible();
}

export function getRootOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.scrollingElement;
    if (!root) throw new Error("文書ルートを取得できません");
    return root.scrollHeight - root.clientHeight;
  });
}

export async function verifyScrollAreaScrollsAlone(page: Page): Promise<void> {
  const scrollArea = page.getByTestId("page-scroll-area");
  const dimensions = await scrollArea.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  const header = page.locator("header");
  const headerBefore = await requireBoundingBox(header);
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
  });
  await expect
    .poll(() => scrollArea.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const headerAfter = await requireBoundingBox(header);
  expect(headerAfter.y).toBeCloseTo(headerBefore.y, 1);
  expect(await getRootOverflow(page)).toBeLessThanOrEqual(0);
}
