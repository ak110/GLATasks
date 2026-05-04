---
paths:
  - "app/tests/**/*.ts"
# このルールはe2eテスト（app/tests/配下）を編集するときに自動ロードされる。
# SvelteKit特有のhydrationパターン・ダイアログ操作・マルチブラウザ同期テストの注意点を扱う。
---

# e2eテスト (Playwright)

## 基本方針

- テストファイルは`app/tests/`に配置する
- セレクタは`data-testid`属性を使用する（CSSクラスに依存しない）
- テストデータは`beforeAll` / `afterAll`で作成・削除し、
  テスト名に`Date.now()`を含めて一意にする

## 基本パターン

SvelteKitのhydration完了を待つには、次のtRPCレスポンス待ちパターンを使う。

`waitForSelector`はSSRで描画されるため即返るが、`onMount`のAPI呼び出しはまだ完了していない。
SSE接続が常時開いているため`waitUntil: "networkidle"`は使えない。

```typescript
await Promise.all([
  page.goto("/"),
  page.waitForResponse((res) => res.url().includes("/api/trpc")),
]);
```

セレクタの曖昧さに注意する。
`button:has-text("追加")`はサイドバーのリスト追加ボタンにも一致するため、
`main button:has-text("追加")`のようにスコープを限定する。

## 複数ブラウザ・マルチタブ

`browser.newContext()`を使う場合は`baseURL`を明示する（`page.goto("/")`が動くため）。

複数ブラウザ（多端末同期）のテスト:

```typescript
const ctx = await browser.newContext({
  storageState: "app/tests/.auth/user.json",
  ignoreHTTPSErrors: true,
  baseURL: process.env.BASE_URL ?? "https://localhost:38180",
});
```

上記`ctx`を2つ生成し、終了時は`finally`で`ctx.close()`する。

## SSE・ネットワーク制御

SSEイベントを受信しない状態を再現する場合は、
`await ctx.route("**/api/events", route => route.abort())`でSSEエンドポイントへの接続だけを遮断する。
`/api/trpc`は通るので削除等の通常操作は引き続き実行できる。

## UI操作

### ダイアログ操作の規約

確認・入力ダイアログは共通コンポーネント（`ConfirmDialog` / `PromptDialog`）に統一されている。
ネイティブの`window.confirm` / `window.prompt`は発火しない。
そのため、e2eテストではPlaywrightの`dialog`イベント経由（`page.once("dialog", ...)`）ではなく、
ダイアログ内のボタンを直接押下する。

- 確認（削除等）は`[role="dialog"]`スコープの`button:has-text("削除")`を`.last()`でclickする
- 入力（名前変更等）は`[role="dialog"]`スコープの`input[type="text"]`に`fill`してから、
  同スコープの`button:has-text("変更")`をclickして確定する

ネスト時に外側ダイアログのボタンを誤選択しないよう、`role="dialog"`スコープでlocatorを構築する。
複数候補がある場合は`.last()`で最前面のダイアログを取り出す。

### クリップボード操作

クリップボードを使うテストでは、操作前に権限を付与してから`navigator.clipboard.readText()`で検証する。

```typescript
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
await taskRow.locator('[data-testid="task-copy-btn"]').dispatchEvent("click");
await taskRow
  .locator('[data-testid="task-copy-menu"]')
  .waitFor({ timeout: 15000 });
await taskRow.locator('[data-testid="task-copy-all"]').dispatchEvent("click");
const copied = await page.evaluate(() => navigator.clipboard.readText());
expect(copied).toBe(`${title}\n\n${notes}`);
```

## モバイルテスト

`playwright.config.ts`の`mobile-chrome`プロジェクトはモバイルブレークポイントの回帰検知用。
`viewport`のみPixel 5サイズへoverrideする構成を採用している（完全なmobile emulationではない）。
実タッチ入力でのD&D動作確認はChrome DevToolsのデバイスエミュレーション等で手動検証する。

## 状態依存テストのリセット

ユーザー既定値（`users.preferences`等のサーバー側状態）に依存するテストは、
前回テスト失敗時の状態が残ると正しく動作しない。
本題の検証に入る前に冒頭で必ず初期状態へリセットしてから進める。
`afterEach`でのリセットだけではテスト失敗時に巻き戻らないため、冒頭での明示的リセットを優先する。

## 共通ヘルパーの利用

e2eテストでは共通ヘルパー（`app/tests/helpers/common.ts`）を利用する。
各テストファイルで`BASE_URL`やstorageStateパスを再定義しない。

公開シンボル一覧:

- `BASE_URL` — テスト対象のベースURL（環境変数`BASE_URL`優先、既定値`https://localhost:38180`）
- `STORAGE_STATE_PATH` — 認証状態ファイルの絶対パス（`import.meta.dirname`基準）
- `setupTestList(browser, listName)` — `beforeAll`からテスト用リストを作成する
- `cleanupTestList(browser, listName)` — `afterAll`からテスト用リストを削除する
