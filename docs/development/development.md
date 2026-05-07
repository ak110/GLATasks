# 開発手順

## 開発環境の構築手順

### 必要環境

- LinuxまたはmacOS
- Docker / Docker Compose
- [uv](https://docs.astral.sh/uv/)（pyfltr・pre-commitなどPython製ツールの実行に使用）
- Node.js（pnpmは`corepack`経由で取得するため事前インストール不要）

### セットアップ手順

すべての`make`コマンドはプロジェクトルートから実行する
（`app/`へ移動して実行すると`${PWD}`がずれてMakefile内のパス解決が誤動作する）。

1. 本リポジトリをclone
2. uvをインストール

   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

3. `.env-example`を`.env`にコピーして環境変数を設定

   ```bash
   cp .env-example .env
   ```

   `COMPOSE_PROFILE`・`DATA_DIR`・`UID`・`GID`を環境に合わせて編集する

4. 開発環境のセットアップを実行

   ```bash
   make setup
   ```

   pre-commitフックをインストールし、`.gitmessage`をコミットテンプレートとして登録する

5. 起動

   ```bash
   make deploy
   ```

## DBマイグレーション運用

### 自動適用

appサービスは`migrate`サービス（開発プロファイルでは`migrate-dev`サービス）に
`service_completed_successfully`で依存している。
そのため`make deploy`（`docker compose up`）の起動時にマイグレーションが自動適用され、
別途`make migrate`を実行しなくても新規migrationが反映される。

`make migrate`は稼働中のappを止めずに即座にマイグレーションを反映したい場合に使う。

### マイグレーションファイルの追加

新規スキーマ変更は必ずdrizzle-kitの`pnpm run db:generate`経由で生成する。
`drizzle/migrations/meta/_journal.json`に追記される`when`値（UNIXミリ秒）は直前エントリより大きくなければならない。
drizzle-orm migratorは`__drizzle_migrations`テーブルに記録した最新の`created_at`より
大きい`when`を持つentryのみ適用するため、過去日時のentryはskipされて反映漏れになる。
別ブランチで生成したmigrationのmergeで順序が逆転する場合は、新しい側の`when`を再生成し直してからcommitする。

### 履歴整合のリカバリー

DBが手動修正等で半端な状態になり、マイグレーションが失敗または重複適用される場合は、
`make sql`（dbコンテナのmariadbクライアント）から次の手順で`__drizzle_migrations`テーブルと
実DB状態を整合させる。

1. 適用済みでない（未適用扱いに戻したい）migrationの記録を削除する

   ```sql
   DELETE FROM __drizzle_migrations WHERE created_at >= <対象when値>;
   ```

2. DB側の実スキーマが対象migrationを既に反映している場合は、
   `ALTER TABLE`等で当該migrationのSQLを巻き戻すか、逆に整合する状態に揃える
3. 再起動して自動適用に委ねる

整合手順を実行する前に必ず`make backup`を取得する。

## 開発コマンド

```bash
make format   # 整形 + 軽量lint + 自動修正（開発時の手動実行用）
make test     # 全チェック実行（これを通過すればコミット可能）
make update   # 依存更新
```

e2eテスト（Playwright）は`make test-e2e`で実行する。
`app/tests/`配下のテストをnginx経由のHTTPS（port 38180）で動作させるため、開発環境が起動している必要がある。
テストユーザーは`app/tests/global-setup.ts`で初回自動作成される。

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
プロファイルは`production`（既定推奨）と`development`の2種類がある。

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

事前に`gh`コマンドをインストールして`gh auth login`でログインしておく。次のいずれかを実行。

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
