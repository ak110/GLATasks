import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";

import {
  cleanupTestList,
  createListFromPage,
  makeContextOptions,
  requireBoundingBox,
  uniqueTestName,
} from "./helpers/common";
import {
  getRootOverflow,
  openPage,
  PAGE_NAMES,
  type PageName,
} from "./helpers/page-scroll";

const NARROW = { width: 320, height: 800 };
const DESKTOP = { width: 1280, height: 800 };

function longName(prefix: string): string {
  return `${uniqueTestName(prefix)}_${"W".repeat(60)}`;
}

async function expectReachable(
  page: Page,
  target: Locator,
  { focusable = true }: { focusable?: boolean } = {},
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  const scrolledHorizontally = await target.evaluate((element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (node.scrollLeft !== 0) return true;
    }
    return false;
  });
  expect(scrolledHorizontally).toBe(false);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("表示幅を取得できません");
  const box = await requireBoundingBox(target);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  const hit = await target.evaluate(
    (element, [x, y]) => {
      const found = document.elementFromPoint(x, y);
      return found !== null && (found === element || element.contains(found));
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(hit).toBe(true);
  if (!focusable) return;
  await target.focus();
  await expect(target).toBeFocused();
}

async function expectFullName(name: Locator, container: Locator) {
  for (const element of [name, container]) {
    const overflow = await element.evaluate(
      (node) => node.scrollWidth - node.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
  const nameBox = await requireBoundingBox(name);
  const containerBox = await requireBoundingBox(container);
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
    containerBox.x + containerBox.width,
  );
}

async function expectHeaderActionsReachable(
  page: Page,
  current: PageName,
): Promise<void> {
  const header = page.locator("header");
  for (const item of PAGE_NAMES) {
    await expectReachable(page, header.getByTestId(`header-nav-${item}`), {
      focusable: item !== current,
    });
  }
  await expectReachable(page, header.getByTestId("theme-toggle"));
  await expectReachable(page, header.getByTestId("account-menu-toggle"));
  await header.getByTestId("account-menu-toggle").click();
  await expectReachable(page, header.getByTestId("security-link"));
  await expectReachable(
    page,
    header.locator('form[action="/auth/logout"] button'),
  );
  await page.keyboard.press("Escape");
}

test.describe("狭い画面の共通ヘッダー", () => {
  test("Android幅360・390・412pxでヘッダーの主要操作が1行に収まる", async ({
    page,
  }, testInfo) => {
    for (const width of [360, 390, 412]) {
      await page.setViewportSize({ width, height: 800 });
      await openPage(page, "tasks");
      const navigation = await requireBoundingBox(
        page.getByTestId("header-nav-tasks"),
      );
      const account = await requireBoundingBox(
        page.getByTestId("account-menu-toggle"),
      );
      const difference = Math.abs(
        navigation.y + navigation.height / 2 - account.y - account.height / 2,
      );
      console.log("header-row", JSON.stringify({ width, difference }));
      await page.screenshot({
        path: testInfo.outputPath(`header-${width}.png`),
      });
      expect.soft(difference, `width=${width}`).toBeLessThan(2);
      expect
        .soft(await getRootOverflow(page), `width=${width}`)
        .toBeLessThanOrEqual(0);
    }
  });
  test("全画面でナビゲーション・テーマ・ログアウトが画面内で操作でき、本文がヘッダーの下にある", async ({
    page,
  }) => {
    for (const viewport of [NARROW, DESKTOP]) {
      await page.setViewportSize(viewport);
      for (const name of PAGE_NAMES) {
        await openPage(page, name);
        await expectHeaderActionsReachable(page, name);
        const header = page.locator("header");
        for (const [item, label] of [
          ["tasks", "タスク"],
          ["timers", "タイマー"],
          ["translate", "翻訳"],
          ["calories", "カロリー"],
        ] as const) {
          if (item !== name) {
            await expect(
              header.getByRole("link", { name: label }),
            ).toBeVisible();
          }
        }
        await expect(header.getByTestId("account-menu-toggle")).toBeVisible();
        await expect(
          header.getByRole("button", { name: "テーマ切替" }),
        ).toBeVisible();
        const headerBox = await requireBoundingBox(page.locator("header"));
        const bodyBox = await requireBoundingBox(
          page.locator("header + *").first(),
        );
        expect(bodyBox.y, name).toBeGreaterThanOrEqual(
          headerBox.y + headerBox.height - 1,
        );
        expect(await getRootOverflow(page), name).toBeLessThanOrEqual(0);
      }
    }
  });

  test("読み込み中の表示があってもヘッダーの操作が画面内で操作できる", async ({
    browser,
  }) => {
    const ctx = await browser.newContext(
      makeContextOptions({ serviceWorkers: "block", viewport: NARROW }),
    );
    try {
      const page = await ctx.newPage();
      for (const name of ["tasks", "timers", "calories"] as const) {
        let release: () => void = () => {};
        const blocked = new Promise<void>((resolve) => {
          release = resolve;
        });
        const handler = async (route: Route) => {
          await blocked;
          await route.continue();
        };
        await page.route("**/api/trpc/**", handler);
        await page.goto(name === "tasks" ? "/" : `/${name}`);
        await expect(page.locator("header"), name).toContainText(
          "読み込み中...",
        );
        await expectHeaderActionsReachable(page, name);
        release();
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await expect(page.locator("header"), name).not.toContainText(
          "読み込み中...",
        );
      }
    } finally {
      await ctx.close();
    }
  });

  test("タスク画面の検索と表示切替がどの状態でも画面内で操作できる", async ({
    page,
  }) => {
    await page.setViewportSize(NARROW);
    await openPage(page, "tasks");
    const header = page.locator("header");
    const search = header.getByTestId("search-input");
    const showType = header.locator("select");

    await expectReachable(page, showType);
    await expectHeaderActionsReachable(page, "tasks");

    await search.focus();
    await expect(search).toBeFocused();
    await expectReachable(page, showType);
    await expectReachable(page, header.getByTestId("theme-toggle"));
    await expectReachable(page, search);
    await search.fill("狭い画面の検索");
    await expect(search).toHaveValue("狭い画面の検索");
    await expectHeaderActionsReachable(page, "tasks");

    await search.fill("");
    await expect(search).toHaveValue("");
    await expectHeaderActionsReachable(page, "tasks");

    for (const value of ["archived", "all", "active"]) {
      await showType.selectOption(value);
      await expect(showType).toHaveValue(value);
      await expectHeaderActionsReachable(page, "tasks");
    }
  });
});

test.describe("狭い画面の長い名前", () => {
  test("長い名前のタイマーでも名前の全文と操作が画面内にある", async ({
    page,
  }) => {
    await page.setViewportSize(NARROW);
    await openPage(page, "timers");
    const timers = [
      { name: longName("countdown"), ephemeral: false, alarm: false },
      { name: longName("alarm"), ephemeral: false, alarm: true },
      { name: longName("eph-countdown"), ephemeral: true, alarm: false },
      { name: longName("eph-alarm"), ephemeral: true, alarm: true },
      {
        name: `https://example.com/${uniqueTestName("url")}/${"a".repeat(60)}`,
        ephemeral: false,
        alarm: false,
      },
      {
        name: `日本語の通常の名前_${uniqueTestName("ja")}`,
        ephemeral: false,
        alarm: false,
      },
      { name: uniqueTestName("s"), ephemeral: false, alarm: false },
    ];
    const created: Locator[] = [];
    try {
      for (const timer of timers) {
        await page
          .getByTestId(
            timer.ephemeral ? "timer-add-ephemeral-btn" : "timer-add-btn",
          )
          .click();
        await page.getByTestId("timer-name-input").fill(timer.name);
        if (timer.alarm) {
          await page.getByTestId("timer-mode-alarm").click();
          await page.getByTestId("timer-target-time-input").fill("23:59");
        } else {
          await page.getByTestId("timer-base-time-input").fill("00:30:00");
        }
        await Promise.all([
          page.waitForResponse((res) => res.url().includes("/api/trpc")),
          page.getByTestId("timer-submit-btn").click(),
        ]);
        const card = page
          .getByTestId("timer-card")
          .filter({ hasText: timer.name });
        await expect(card).toBeVisible({ timeout: 10_000 });
        created.push(card);
      }

      for (const viewport of [NARROW, DESKTOP]) {
        await page.setViewportSize(viewport);
        await expectReachable(page, page.getByTestId("timer-add-btn"));
        await expectReachable(
          page,
          page.getByTestId("timer-add-ephemeral-btn"),
        );
        for (const card of created) {
          await expectFullName(card.getByTestId("timer-name"), card);
          await expectReachable(page, card.getByTestId("timer-edit-btn"));
          await expectReachable(page, card.getByTestId("timer-delete-btn"));
        }
        const scrollArea = page.getByTestId("page-scroll-area");
        const horizontalOverflow = await scrollArea.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        );
        expect(horizontalOverflow).toBeLessThanOrEqual(0);
      }
    } finally {
      await page.setViewportSize(DESKTOP);
      for (const card of created) {
        await card.getByTestId("timer-delete-btn").click();
        const confirm = page
          .locator('[role="dialog"] button:has-text("削除")')
          .last();
        if (await confirm.isVisible()) await confirm.click();
        await expect(card).toBeHidden({ timeout: 10_000 });
      }
    }
  });

  test("長い名前のリストを選択しても見出しの戻る・非表示が画面内にある", async ({
    page,
    browser,
  }) => {
    const listName = longName("list");
    await page.setViewportSize(DESKTOP);
    await openPage(page, "tasks");
    try {
      await createListFromPage(page, listName);
      await page.setViewportSize(NARROW);
      const heading = page.getByRole("heading", {
        name: listName,
        exact: true,
      });
      await expectFullName(heading, heading.locator("../.."));
      await expectReachable(
        page,
        page.getByRole("button", { name: "リスト一覧に戻る" }),
      );
      await expectReachable(page, page.getByRole("button", { name: "非表示" }));
    } finally {
      await cleanupTestList(browser, listName);
      await page.setViewportSize(DESKTOP);
      await openPage(page, "tasks");
      await expect(
        page.getByTestId("list-item").filter({ hasText: listName }),
      ).toHaveCount(0);
    }
  });
});
