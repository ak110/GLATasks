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

## 共通ヘルパーの利用

e2eテストでは共通ヘルパー（`app/tests/helpers/common.ts`）を利用する。
各テストファイルで `BASE_URL` やstorageStateパスを再定義しない。

公開シンボル一覧:

- `BASE_URL` — テスト対象のベースURL（環境変数 `BASE_URL` 優先、既定値 `https://localhost:38180`）
- `STORAGE_STATE_PATH` — 認証状態ファイルの絶対パス（`import.meta.dirname` 基準）
- `setupTestList(browser, listName)` — `beforeAll` からテスト用リストを作成する
- `cleanupTestList(browser, listName)` — `afterAll` からテスト用リストを削除する
