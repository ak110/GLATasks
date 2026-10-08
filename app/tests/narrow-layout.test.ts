/**
 * @fileoverview 狭い画面で長い名前と共通ヘッダーの操作が画面内に収まることの回帰テスト
 */

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

/** 分割できる位置を持たない長い名前を返す */
function longName(prefix: string): string {
  return `${uniqueTestName(prefix)}_${"W".repeat(60)}`;
}

/**
 * 要素が表示幅の内側にあり、中心点のヒット判定が自身を返し、操作要素ならフォーカスできることを確かめる。
 * スクロール領域の内側の要素は先に表示位置へスクロールする。
 * 現在の画面を示すナビゲーション項目のような操作でない要素は`focusable: false`で渡す。
 */
async function expectReachable(
  page: Page,
  target: Locator,
  { focusable = true }: { focusable?: boolean } = {},
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  // 横方向のスクロールで操作を表示位置へ移した場合は、操作が行の幅を超えた位置にある
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

/** 名前の全文が要素の幅に収まり、名前を含む行やカードも横幅を超えないことを確かめる */
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
  await expectReachable(
    page,
    header.locator('form[action="/auth/logout"] button'),
  );
}

test.describe("狭い画面の共通ヘッダー", () => {
  test("全画面でナビゲーション・テーマ・ログアウトが画面内で操作でき、本文がヘッダーの下にある", async ({
    page,
  }) => {
    for (const viewport of [NARROW, DESKTOP]) {
      await page.setViewportSize(viewport);
      for (const name of PAGE_NAMES) {
        await openPage(page, name);
        await expectHeaderActionsReachable(page, name);
        // 狭い画面でラベルを隠しても、遷移先とログアウトを名前で識別できる
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
        await expect(
          header.getByRole("button", { name: "ログアウト" }),
        ).toBeVisible();
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
    // サービスワーカー経由の要求はpage.routeで止められないため、この検証では無効にする
    const ctx = await browser.newContext(
      makeContextOptions({ serviceWorkers: "block", viewport: NARROW }),
    );
    try {
      const page = await ctx.newPage();
      for (const name of ["tasks", "timers", "calories"] as const) {
        // tRPCの応答を保留し、読み込み中の表示がヘッダーへ並ぶ状態にする
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

    // 非フォーカス
    await expectReachable(page, showType);
    await expectHeaderActionsReachable(page, "tasks");

    // フォーカス中（入力欄が広がる）と入力後
    await search.focus();
    await expect(search).toBeFocused();
    await expectReachable(page, showType);
    await expectReachable(page, header.getByTestId("theme-toggle"));
    await expectReachable(page, search);
    await search.fill("狭い画面の検索");
    await expect(search).toHaveValue("狭い画面の検索");
    await expectHeaderActionsReachable(page, "tasks");

    // 解除
    await search.fill("");
    await expect(search).toHaveValue("");
    await expectHeaderActionsReachable(page, "tasks");

    // 表示切替の各選択肢
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
    // 狭い画面では作成直後にそのリストが選択されて一覧が隠れるため、作成と選択は広い画面で行う
    await page.setViewportSize(DESKTOP);
    await openPage(page, "tasks");
    try {
      await createListFromPage(page, listName);
      await page.setViewportSize(NARROW);
      const heading = page.getByRole("heading", {
        name: listName,
        exact: true,
      });
      // 見出しの親は戻るボタンと名前の組、その親が非表示ボタンを含む行
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
