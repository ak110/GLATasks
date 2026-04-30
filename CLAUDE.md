# CLAUDE.md: glatasks

## 開発手順

### Makefileターゲット一覧

| ターゲット             | 概要                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `make format`          | コード整形 + 自動修正付きlint（`uvx pyfltr fast`）           |
| `make test`            | 全チェック実行（pyfltr + バックアップテスト + e2e）          |
| `make test-unit`       | Vitestのユニットテストを実行（node・dom両project）           |
| `make test-backup`     | バックアップ機能のテスト（Docker環境起動が必要）             |
| `make test-e2e`        | Playwrightによるe2eテスト（Docker環境起動が必要）            |
| `make deploy`          | ビルド → 停止 → 起動                                         |
| `make build`           | Dockerイメージのビルド                                       |
| `make start`           | Docker Composeでサービスを起動                               |
| `make stop`            | Docker Composeでサービスを停止                               |
| `make restart-app`     | appコンテナのみ再起動                                        |
| `make backup`          | DBダンプ + キーファイルのバックアップ                        |
| `make sync`            | git fetch/rebase + Docker pull                               |
| `make update`          | 依存更新 + pinactアクション更新 + 全テスト実行               |
| `make update-actions`  | GitHub Actionsのハッシュピン更新（mise経由でpinact実行）     |
| `make docs`            | VitePressドキュメントサイトのローカルプレビュー（port 5173） |
| `make migrate`         | DBマイグレーション実行                                       |
| `make db-studio`       | Drizzle Studio起動                                           |
| `make logs`            | 全サービスのログをフォロー                                   |
| `make shell`           | appコンテナのbashシェルに入る                                |
| `make node-shell`      | Node.jsコンテナのbashシェルに入る                            |
| `make healthcheck`     | ヘルスチェック確認                                           |
| `make ps`              | Docker Composeのサービス状態確認                             |
| `make build-extension` | Chrome拡張機能のビルド（テンプレートからdistを生成）         |

- リリース手順: [docs/development/development.md](docs/development/development.md) 参照
- コミット前の検証方法: `uvx pyfltr run-for-agent`
  - ドキュメントなどのみの変更の場合は省略可（pre-commitで実行されるため）
  - テストコードの単体実行なども極力 `uvx pyfltr run-for-agent <path>` を使う
  - 修正後の再実行時は、対象ファイルや対象ツールを必要に応じて絞って実行する（最終検証はCIに委ねる前提）
    - 例: `uvx pyfltr run-for-agent --commands=eslint,prettier path/to/file.ts`
    - 利用可能なコマンドは`pyproject.toml`の`[tool.pyfltr]`設定とJS/TS連携で有効になるもの（`eslint`・`prettier`・`oxlint`・`vitest`・カスタムコマンドの`svelte-check`など）
  - バックアップ/E2E系に変更を入れた場合は`make test-backup test-e2e`も実行する
  - 注意: 本プロジェクトのDocker Compose環境は開発マシン上で常時稼働している
    - `make test`（backup/e2eテスト含む）は問題なく実行可能
    - `uvx pyfltr run-for-agent`を使うのはJSON Lines出力で診断結果を効率的に解釈するためであり、環境制約によるものではない

## 注意点

- Vitestはプロジェクト分割構成（`vitest.config.ts` @ repo root）。
  `node` project（`*.test.ts`）と `dom` project（`*.svelte.test.ts` / `*.dom.test.ts`）を使い分ける。
  詳細は `.claude/rules/sveltekit.md` の「Vitestテスト環境」節を参照。
- 現在の `COMPOSE_PROFILE` を確認したいときは `make -n deploy` のドライラン出力で判別できる（`.env` を直接読めないことがある）
- 開発環境はdocker composeで動いているため、アクセスしたい場合は以下ようなコマンドを使用する
  - `docker compose --profile development exec web curl -fLk https://localhost/`
- 本リポジトリはSvelte 5、Tailwind v4、tRPC v11、Vite 8など比較的新しいメジャーバージョンを使用している

## API 実装規約

- APIハンドラ（`app/src/lib/server/api/` 配下）の関数引数は `Record<string, unknown>` を使わず、
  Zodスキーマから `z.infer` で得た型を引数に取る。Drizzleの型推論が正しく機能する形を維持する。
- 並び順（`sort_order`）の付与方針はドメインごとに異なる。新規作成時の挙動を追加・修正する際は
  既存仕様に合わせる。
  - タスク（`tasks.create`）: `sort_order = 既存最小値 - 1000` で先頭挿入
  - タイマー（`timers.create`）: `sort_order = 既存最大値 + 1000` で末尾追加
