# 開発手順

本リポジトリの開発で必要となるツールチェイン・コマンド・ワークフローを説明する。
コーディング規約や設計判断はClaude Code向け資料に集約しているため、
本書からは外部開発者向けの手順情報のみを扱う。

## 開発環境の構築手順

### 必要環境

- LinuxまたはmacOS
- Docker / Docker Compose
- [uv](https://docs.astral.sh/uv/)（pyfltr・pre-commitなどPython製ツールの実行に使用）
- Node.js（pnpmは`corepack`経由で取得するため事前インストール不要）

### セットアップ手順

すべての`make`コマンドはプロジェクトルートから実行する
（`app/`へ移動して実行すると`${PWD}`がずれてMakefile内のパス解決が誤動作する）。

1. 本リポジトリをcloneする
2. uvをインストールする

   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

3. `.env-example`を`.env`にコピーして環境変数を設定する

   ```bash
   cp .env-example .env
   ```

   `COMPOSE_PROFILE`・`DATA_DIR`・`UID`・`GID`を環境に合わせて編集する

4. 開発環境のセットアップを実行する

   ```bash
   make setup
   ```

   pre-commitフックをインストールし、`.gitmessage`を`commit.template`へ登録する

5. 起動する

   ```bash
   make deploy
   ```

## 開発コマンド

`make help`でも一覧を確認できる。

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

コミット前のチェックは`make test`で実行する。`make format`は日常的な整形・lint用途に使う。

e2eテスト（Playwright）は`make test-e2e`で実行する。
`app/tests/`配下のテストをnginx経由のHTTPS（port 38180）で動作させるため、開発環境が起動している必要がある。
テストユーザーは`app/tests/global-setup.ts`で初回自動作成される。

`waitForSelector`はSSRで描画されるため即返るが、`onMount`のAPI呼び出しはまだ完了していない。
SSE接続が常時開いているため`waitUntil: "networkidle"`は利用できない。
次のtRPCレスポンス待ちパターンで初期ロードを待つ。

```typescript
await Promise.all([
  page.goto("/"),
  page.waitForResponse((res) => res.url().includes("/api/trpc")),
]);
```

## サプライチェーン攻撃対策

npm / PyPIレジストリへの悪意あるパッケージ公開に対する防御として、次の方針を採用する。

- `pnpm-workspace.yaml`の`minimumReleaseAge: 1440`（1日 = 1440分）で
  公開から1日未満のnpmパッケージのインストールを禁止する。`pnpm dlx`にも適用される（pnpm 10.18以降）
- `uv.toml`の`exclude-newer = "1 day"`でPyPIに公開されてから1日未満のパッケージのインストールを禁止する。
  `uvx`（`uv tool run`）にも適用される
- `.pre-commit-config.yaml`の`additional_dependencies`はpnpmを介さないため、
  `@latest`を使わずバージョンを固定する
- CI・Docker・`make`から呼ばれる`pnpm install`は`--frozen-lockfile`を明示する。
  ロックファイル乖離時の再resolveを禁止して二重防御を構成する

依存更新時は`make update`から呼ばれる`pnpm update --latest`を使う
（`pnpm update`は`--frozen-lockfile`の影響対象外のため開発フローを阻害しない）。
緊急で公開直後のパッケージが必要な場合は`pnpm-workspace.yaml`の`minimumReleaseAgeExclude`に追加する。

## Docker構成

サービス構成・環境変数は`compose.yaml` / `.env`を参照。
プロファイルは`production`（既定推奨）と`development`を切り替えて使用する。

## CI/CD

masterへのpushおよびPR時に`ci.yaml`が自動実行される（`.github/workflows/ci.yaml`参照）。

- `test` job: lint・型チェック・ユニットテスト・svelte-checkをpyfltr経由で一括実行する
- `integration` job: Docker Composeを起動してバックアップテストとPlaywright e2eテストを実行する

masterへのpushで`docs/`配下に変更があれば`docs.yaml`ワークフローが自動実行され、
GitHub Pagesへデプロイされる。

## ドキュメントサイト運用

[VitePress](https://vitepress.dev/)を使用する。
`docs/`ディレクトリ直下のMarkdownファイルがページ、`docs/.vitepress/config.ts`でサイト設定を管理する。

ローカルプレビュー:

```bash
make docs
```

`http://localhost:5173/GLATasks/`でプレビューできる。

## バックアップとリストア

### バックアップ

デプロイ前にDBダンプとキーファイルのバックアップを取得する。
CIデプロイ（`deploy.yaml`）では`make deploy`の前に自動実行される。

```bash
make backup
```

バックアップ先: `${DATA_DIR}/backups/YYYYMMDD_HHMMSS/`（DBダンプ + キーファイル）。
既定で直近5世代を保持する。`BACKUP_KEEP`環境変数で変更可能。

```bash
BACKUP_KEEP=10 make backup
```

DBコンテナが停止中の場合はエラー終了する。
初回デプロイなどDBがない状態では`SKIP_DB_DUMP=1`でスキップ可能。

```bash
SKIP_DB_DUMP=1 make backup
```

### リストア

```bash
# DB 復元
docker compose exec -T db mariadb -uglatasks -pglatasks glatasks < ${DATA_DIR}/backups/YYYYMMDD_HHMMSS/glatasks.sql

# キーファイル復元
cp -p ${DATA_DIR}/backups/YYYYMMDD_HHMMSS/.encrypt_key ${DATA_DIR}/
cp -p ${DATA_DIR}/backups/YYYYMMDD_HHMMSS/.secret_key ${DATA_DIR}/

# app 再起動（キーファイルを反映）
make restart-app
```

## リリース手順

事前に`gh`コマンドをインストールして`gh auth login`でログインしておき、次のいずれかを実行する。

```bash
gh workflow run release.yaml --field="bump=PATCH"
gh workflow run release.yaml --field="bump=MINOR"
gh workflow run release.yaml --field="bump=MAJOR"
```

`release.yaml`はmasterの`ci.yaml`成功を確認したうえでバージョンタグとリリースを作成し、
`deploy.yaml`を起動する。
`deploy.yaml`はDockerイメージをGHCRへプッシュしてから、
SSHでサーバーに`make sync && make backup && make deploy`を実行する。

進捗は<https://github.com/ak110/GLATasks/actions>で確認できる。
