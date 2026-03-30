---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
---

# TypeScriptテストコード記述スタイル

## ユニットテスト (Vitest)

- テストファイルは対象モジュールと同じディレクトリに `*.test.ts` として配置する
- `describe` は原則1階層、ネストは2階層まで
- 類似パターンの網羅には `it.each()` を活用する
- テストデータ生成ヘルパー (`makeXxx(overrides)`) で本質的でないセットアップを共通化する
- 時間依存のテストは `vi.useFakeTimers()` で制御し、実時間の `sleep` を避ける
- モックは外部I/O・ブラウザAPIなど制御不能な依存のみに限定し、実コードを最大限通す
  - `vi.stubGlobal()`: ブラウザAPI (localStorage, AudioContext 等)
  - `vi.fn()`: コールバックや依存注入
  - `vi.spyOn()`: 既存メソッドの呼び出し追跡
- `afterEach` で `vi.restoreAllMocks()` / `vi.useRealTimers()` を確実に呼ぶ

## e2eテスト (Playwright)

- テストファイルは `app/tests/` に配置する
- セレクタは `data-testid` 属性を使用する (CSSクラスに依存しない)
- ページ遷移後のデータ取得完了待ちは tRPC レスポンス待ちパターンを使う:

  ```typescript
  await Promise.all([
    page.goto("/"),
    page.waitForResponse((res) => res.url().includes("/api/trpc")),
  ]);
  ```

- SSE接続が常時開いているため `waitUntil: "networkidle"` は使えない
- テストデータは `beforeAll` / `afterAll` で作成・削除し、テスト名に `Date.now()` を含めて一意にする
