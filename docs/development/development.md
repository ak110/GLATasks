# 開発手順

## 開発環境の構築手順

### 必要環境

- LinuxまたはmacOS
- Docker / Docker Compose
- uv
- Node.js

### セットアップ手順

すべての`make`コマンドはプロジェクトルートから実行する
（`app/`へ移動して実行すると`${PWD}`がずれてMakefile内のパス解決が誤動作する）。

1. 本リポジトリをclone
2. `.env-example`を`.env`にコピーして環境変数を設定

   ```bash
   cp .env-example .env
   ```

   `COMPOSE_PROFILE`・`DATA_DIR`・`UID`・`GID`を環境に合わせて編集する

3. 開発環境のセットアップを実行

   ```bash
   make setup
   ```

4. 起動

   ```bash
   make deploy
   ```

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `make format` | 整形 + 軽量lint + 自動修正 |
| `make test` | 全チェック実行（コミット前の必須検証） |
| `make test-e2e` | e2eテスト（Playwright）単独実行 |
| `make update` | 依存更新 |

e2eテスト（`make test-e2e`）は開発環境（`make deploy`）が起動している必要がある。

## サプライチェーン攻撃対策

npm / PyPIレジストリへの悪意あるパッケージ公開に対し、次の方針を採用する。

- npmパッケージ: `pnpm-workspace.yaml`の`minimumReleaseAge: 1440`で公開から1日未満のインストールを禁止する
- PyPIパッケージ: `pyproject.toml`の`[tool.uv]`節`exclude-newer = "1 day"`で公開から1日未満のインストールを禁止する
- `pnpm install`は`--frozen-lockfile`を明示してロックファイル乖離時の再resolveを禁止する
- GitHub Actionsの`uses:`はコミットSHAとバージョンコメントで固定する（`.github/workflows/`配下全ファイル）

依存更新は`make update`を使う。

推移的依存（直接インストールしていない依存の依存）の脆弱性は、上記の自動更新対策だけでは解消されない場合がある。
`pnpm-workspace.yaml`の`overrides`で安全なバージョンへ引き上げて対処し、`.github/workflows/audit.yaml`の
定期監査で再出現を検知する。

## Docker構成

サービス構成・環境変数は`compose.yaml` / `.env`を参照。
プロファイルは`production`（既定推奨）と`development`の2種類がある。

## DBマイグレーション運用

### 自動適用

`make deploy`（`docker compose up`）の起動時にマイグレーションが自動適用される。
稼働中のappを止めずに即座にマイグレーションを反映したい場合は`make migrate`を実行する。

### マイグレーションファイルの追加

新規スキーマ変更は必ず`pnpm run db:generate`経由で生成する。
`drizzle/migrations/meta/_journal.json`の`when`値（UNIXミリ秒）は直前エントリより大きくなければならない。
別ブランチで生成したmigrationのmergeで順序が逆転する場合は、新しい側の`when`を再生成してからcommitする。

既存行の値の読み替え・初期値の設定が必要な場合は、生成されたマイグレーションファイルへ値変換のSQLを書き足す。
`pnpm run db:generate`はスキーマ定義の差分からDDLのみを生成し、既存行の値をどう埋めるかを表現できないためである。
先例として`0003_sort_order_and_status.sql`（既存カラムの廃止に伴う値の読み替え）・`0004_add_timer_expired.sql`（新設カラムへの初期値の設定）が手書きの変換SQLを含む。

### 履歴整合のリカバリー

DBが半端な状態になった場合は`make sql`から`__drizzle_migrations`テーブルと実DB状態を整合させる。
整合手順を実行する前に必ず`make backup`を取得する。

典型例として、`make start`時に`migrate-dev`がexit 1で失敗し
`ALTER TABLE ... ADD ... Duplicate column name`が出る場合がある。
`drizzle-kit push`でスキーマを先行適用すると実スキーマは最新だが
`__drizzle_migrations`に当該マイグレーションが記録されず、再適用で重複エラーになる。
実スキーマが当該マイグレーション到達済みであることを確認したうえで、
`__drizzle_migrations`へ記録行を1行挿入して整合させる。
`hash`は当該マイグレーションSQLファイル全文のsha256、`created_at`は
`drizzle/migrations/meta/_journal.json`の当該エントリの`when`値を用いる。

## CI/CD

masterへのpushおよびPR時に`ci.yaml`が自動実行される（`.github/workflows/ci.yaml`参照）。
masterへのpushで`docs/`配下に変更があれば`docs.yaml`ワークフローが自動実行され、
GitHub Pagesへデプロイされる。
依存の脆弱性監査は`audit.yaml`が毎日06:00 UTC（JST 15:00）に定期実行し、
検出結果をGitHub Code Scanningへアップロードする（`.github/workflows/audit.yaml`参照）。

## ドキュメントサイト運用

```bash
make docs
```

`http://localhost:5173/GLATasks/`でプレビューできる。

## バックアップとリストア

### バックアップ

```bash
make backup
```

バックアップ先: `${DATA_DIR}/backups/YYYYMMDD_HHMMSS/`（DBダンプ + キーファイル）。
既定で直近5世代を保持する（`BACKUP_KEEP`環境変数で変更可能）。
DBコンテナが停止中の場合はエラー終了する。初回デプロイなどDBがない状態では`SKIP_DB_DUMP=1`でスキップ可能。

### リストア

`${DATA_DIR}/backups/YYYYMMDD_HHMMSS/`配下のSQLとキーファイルをDBコンテナへリストア後、
`make restart-app`を実行する。

## リリース手順

事前に`gh`コマンドをインストールして`gh auth login`でログインしておく。次のいずれかを実行。

```bash
gh workflow run release.yaml --field="bump=PATCH"
gh workflow run release.yaml --field="bump=MINOR"
gh workflow run release.yaml --field="bump=MAJOR"
```

進捗は<https://github.com/ak110/GLATasks/actions>で確認できる。
