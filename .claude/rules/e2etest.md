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
