# カスタム指示 (プロジェクト固有)

## 開発手順

- `make format`: 整形 + 軽量lint + 自動修正（開発時の手動実行用）
- `make test`: 全チェック実行（これが通ればコミット可能）
- `make update`: 依存更新 + 全テスト実行
  - `make update-actions`: GitHub Actionsのハッシュピン更新のみ（mise経由でpinact実行）
- Markdownファイルのformat/lintの実行方法: `uvx pre-commit run --files <file>`
- vitest の environment は `node`（`vitest.config.ts` @ repo root）。DOM API（`EventSource`, `localStorage` 等）を使うコードをテストするときは `globalThis` のプロパティにモック実装を代入する
- 現在の `COMPOSE_PROFILE` を確認したいときは `make -n deploy` のドライラン出力で判別できる（`.env` を直接読めないことがある）

## 外部ライブラリ仕様の確認

- SvelteKit / Svelte 5 (runes) / Tailwind CSS v4 / tRPC v11 / Drizzle ORM / TanStack Query / Vitest 4 / Vite 8 / TypeScript 6 など、本リポジトリで使用するライブラリの API・設定・移行手順を参照する場合は `context7` MCP (`mcp__plugin_context7_context7__resolve-library-id` → `mcp__plugin_context7_context7__query-docs`) を優先する
- 本リポジトリは Claude の学習データより新しいメジャーバージョン (Svelte 5、Tailwind v4、tRPC v11、Vite 8 など) に追従するため、知識のスナップショットではなく最新ドキュメントを確認する

## 関連ドキュメント

- @README.md
- @docs/src/content/docs/development/architecture.md
- @docs/src/content/docs/development/development.md
