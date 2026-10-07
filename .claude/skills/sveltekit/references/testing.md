# Vitestのテスト環境

## Vitest テスト環境

設定の実体は`app/vitest.config.ts`に置き、ルートの`vitest.config.ts`から再exportする。
`test.projects`で`node`と`dom`の2プロジェクトへ分割する。
DOM環境を要するテストは`dom`プロジェクトに置き、Node環境のテストへ影響を与えない構成を維持する。

テストファイルの命名規則:

- Svelteコンポーネントのテスト: `*.svelte.test.ts`（`dom`プロジェクトで実行）
- その他のDOM環境テスト: `*.dom.test.ts`（`dom`プロジェクトで実行）
- Node環境テスト: `*.test.ts`（`node`プロジェクトで実行）

### `onMount`を含むユーティリティのテスト戦略

Svelteの`onMount`はコンポーネントの初期化スコープ外では動作しない。
`onMount`を内部で呼ぶユーティリティモジュールをそのままテストすると、
Node環境では`onMount`内のコールバックが起動しない。

対策としてユーティリティを2層に分離する。

- コア処理を独立した関数として切り出す（戻り値はcleanup関数）
- `onMount`ラッパーは「コア関数の呼び出し＋戻り値をonMountのcleanupに渡す」薄い実装に留める

テストはコア関数を直接呼び出し、戻り値のcleanup関数で解除する。
これによりNode環境（`*.test.ts`）で`onMount`の制約を回避できる。

例: `app/src/lib/client/sse/sse-subscribe.ts`の`setupSseSubscriptions`（コア）と`subscribeOnMount`（ラッパー）。
