# CLAUDE.md: glatasks

## 開発手順

- `make update`: 依存更新 + pinactアクション更新 + 全テスト実行
  - `make update-actions`: GitHub Actionsのハッシュピン更新のみ（mise経由でpinact実行）
- コミット前の検証方法: `uvx pyfltr run --output-format=jsonl | tail -30`
  - ドキュメントなどのみの変更の場合は省略可（pre-commitで実行されるため）
  - バックアップ/E2E系に変更を入れた場合は`make test-backup test-e2e`も実行する。
  - 注意: 本プロジェクトのDocker Compose環境は開発マシン上で常時稼働している
    - `make test`（backup/e2eテスト含む）は問題なく実行可能
    - 上記で`uvx pyfltr run`を使うのはJSON Lines出力で診断結果を効率的に解釈するためであり、環境制約によるものではない

## 注意点

- vitestのenvironmentは `node`（`vitest.config.ts` @ repo root）。DOM API（`EventSource`, `localStorage` 等）を使うコードを
  テストするときは `globalThis` のプロパティにモック実装を代入する
- 現在の `COMPOSE_PROFILE` を確認したいときは `make -n deploy` のドライラン出力で判別できる（`.env` を直接読めないことがある）
- 本リポジトリはSvelte 5、Tailwind v4、tRPC v11、Vite 8など比較的新しいメジャーバージョンを使用している

## 関連ドキュメント

- @README.md
- @docs/development/architecture.md
- @docs/development/development.md
