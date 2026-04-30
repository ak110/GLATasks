---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
---

# e2eテスト (Playwright)

- テストファイルは `app/tests/` に配置する
- セレクタは `data-testid` 属性を使用する（CSSクラスに依存しない）
- ページ遷移後のデータ取得完了待ちはtRPCレスポンス待ちパターンを使う:

  ```typescript
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((res) => res.url().includes("/api/trpc")),
  ]);
  ```

- SSE接続が常時開いているため `waitUntil: "networkidle"` は使えない
- テストデータは `beforeAll` / `afterAll` で作成・削除し、テスト名に `Date.now()` を含めて一意にする

## ダイアログ操作の規約

確認・入力ダイアログは共通コンポーネント（`ConfirmDialog` / `PromptDialog`）に統一されている。
ネイティブの `window.confirm` / `window.prompt` は発火しない。
そのため、e2eテストではPlaywrightの `dialog` イベント経由（`page.once("dialog", ...)`）ではなく、
ダイアログ内のボタンを直接押下する。

- 確認（削除等）は `[role="dialog"]` スコープの `button:has-text("削除")` を `.last()` でclickする
- 入力（名前変更等）は `[role="dialog"]` スコープの `input[type="text"]` に `fill` してから、
  同スコープの `button:has-text("変更")` をclickして確定する

ネスト時に外側ダイアログのボタンを誤選択しないよう、`role="dialog"` スコープでlocatorを構築する。
複数候補がある場合は `.last()` で最前面のダイアログを取り出す。

## モバイルブレークポイントのテスト

`playwright.config.ts` の `mobile-chrome` プロジェクトはモバイルブレークポイントの回帰検知用である。
完全なmobile emulation（`devices["Pixel 5"]` で `hasTouch: true` ・ `isMobile: true`）下を想定する。
この設定ではPlaywrightの `page.mouse` 経由で `setPointerCapture` を伴うPointer Eventsを
自動駆動した際にドラッグが安定して成立しない。
そのため、Desktop Chromeをベースに `viewport` のみPixel 5サイズへoverrideする構成を採用する。
実タッチ入力でのD&D動作確認はChrome DevToolsのデバイスエミュレーション等で手動検証する。

## 状態依存テストのリセット

ユーザー既定値（`users.preferences` 等のサーバー側状態）に依存するテストは、
前回テスト失敗時の状態が残ると壊れる。
本題の検証に入る前に冒頭で必ず初期状態へリセットしてから進める。
`afterEach` でのリセットだけではテスト失敗時に巻き戻らないため、冒頭での明示的リセットを優先する。

## 共通ヘルパーの利用

e2eテストでは共通ヘルパー（`app/tests/helpers/common.ts`）を利用する。
各テストファイルで `BASE_URL` やstorageStateパスを再定義しない。

公開シンボル一覧:

- `BASE_URL` — テスト対象のベースURL（環境変数 `BASE_URL` 優先、既定値 `https://localhost:38180`）
- `STORAGE_STATE_PATH` — 認証状態ファイルの絶対パス（`import.meta.dirname` 基準）
- `setupTestList(browser, listName)` — `beforeAll` からテスト用リストを作成する
- `cleanupTestList(browser, listName)` — `afterAll` からテスト用リストを削除する
