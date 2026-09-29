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

### 依存更新後の追随作業

`make update`は`pnpm update --latest`により`package.json`の指定範囲を超えて更新する。
稼働中の開発サーバーが更新前のモジュールを保持したままだとE2Eが失敗するため、`make update`は依存更新後に`app`を再起動し、疎通を確認してから検証する。
`RUN_NODE`相当のコンテナーで`pnpm add`などを実行して手動で依存を入れ替えた場合も、E2Eの前に`make restart-app`、`make healthcheck`の順に実行する。
実行後は次の3点を確認する。

TypeScriptの版を6系に留める。
`typescript-eslint`がTypeScript 7を未サポートであり、
`svelte-check`もTypeScript 7では6系との併存インストールと専用フラグを要求するためである。
7系へ上がった場合は`pnpm add -D 'typescript@^6.0.3'`で戻す。
両ツールがTypeScript 7へ対応した時点で本運用を解除する。
対応状況は次の2点で判定する。

- `typescript-eslint`: 対応issue（<https://github.com/typescript-eslint/typescript-eslint/issues/10940>）がcloseされていること
- `svelte-check`: `node_modules/svelte-check/bin/ts-version-check.js`がTypeScript 7の単独構成で例外を送出しないこと

Playwrightのイメージ版を揃える。
`@playwright/test`が更新された場合は、`compose.yaml`の`playwright`サービスが指す
`mcr.microsoft.com/playwright`のタグを同じ版へ更新する。
イメージ同梱のブラウザバイナリはパッケージの版ごとに配置が変わるため、
一致しないと`make test-e2e`がブラウザ起動時に失敗する。

`pnpm`の警告を確認する。
`make update`は終了コード0で終わる場合も、非推奨の推移依存とpeer dependencyの不整合を警告として報告する。
終了コードだけでは、警告を伴わない更新が成立したかを判定できない。

非推奨の推移依存は`pnpm why <パッケージ名>`で、その依存を引き込む直接依存を特定する。
特定した直接依存について、更新、据え置き、上流の対応待ちのいずれとするかを判定して記録する。
peer dependencyの不整合は`pnpm peers check`で内容を確定する。
このコマンドは不整合が残る間、終了コード1を返す。

依存更新の完了条件は、警告が0件であること、または各警告へ根拠のある処置が対応していることとする。

## サプライチェーン攻撃対策

npm / PyPIレジストリへの悪意あるパッケージ公開に対し、次の方針を採用する。

- npmパッケージ: `pnpm-workspace.yaml`の`minimumReleaseAge: 1440`で公開から1日未満のインストールを禁止する
- PyPIパッケージ: `pyproject.toml`の`[tool.uv]`節`exclude-newer = "1 day"`で公開から1日未満のインストールを禁止する
- `pnpm install`は`--frozen-lockfile`を明示してロックファイル乖離時の再resolveを禁止する
- GitHub Actionsの`uses:`はコミットSHAとバージョンコメントで固定する（`.github/workflows/`配下全ファイル）

依存更新は`make update`を使う。

推移的依存（直接インストールしていない依存の依存）の脆弱性は、上記の自動更新対策だけでは解消されない場合がある。
脆弱性はDependabotアラートと`.github/workflows/audit.yaml`の定期監査で検知し、
`pnpm-workspace.yaml`の`overrides`で安全なバージョンへ引き上げて対処する。

GitHubリポジトリ設定のDependabot security updates（自動修正PRの作成）は無効にしている。
Dependabotのアップデーターが本リポジトリのpnpmロックファイル環境では推移的依存を
安全なバージョンへ引き上げられず、自動修正の試行が繰り返し`security_update_not_possible`で
失敗していたためである。

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
`__drizzle_migrations`に先行適用したマイグレーションが記録されず、再適用で重複エラーになる。
実スキーマに先行適用したマイグレーションの変更が反映済みであることを確認したうえで、
`__drizzle_migrations`へ記録行を1行挿入して整合させる。
`hash`には先行適用したマイグレーションSQLファイル全文のsha256を、`created_at`には
`drizzle/migrations/meta/_journal.json`にある同じマイグレーションのエントリの`when`値を設定する。

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

バックアップ先: `${DATA_DIR}/backups/YYYYMMDD_HHMMSS/`。
DBダンプと、存在する`.encrypt_key`・`.secret_key`・`.mcp_clients.json`を同じ世代へ保存する。
MCP登録ファイルが無い場合も成功する。存在するファイルの保存に失敗した場合は、未完成の世代を残さずエラー終了する。
何も指定しなければ直近5世代を保持する（`BACKUP_KEEP`で変更可能）。
DBコンテナが停止中の場合はエラー終了する。初回デプロイなどDBがない状態では`SKIP_DB_DUMP=1`でスキップできるが、その世代にはSQLが入らない。

### リストア

復旧先のリポジトリルートで、`.env`と`web/ssl`を用意する。これらはバックアップに含まれない。
`.env`の`DATA_DIR`を復旧先の絶対パスへ設定し、次の例の`DATA_DIR`にも同じ値を指定する。
`COMPOSE_PROFILES`には`.env`の`COMPOSE_PROFILE`と同じ値を指定する。
SQLのある完成世代を選ぶ。以下の操作は復旧先の`glatasks`データベースを入れ替えるため、現在のデータを残す場合は先に別の場所へ退避する。

```bash
export DATA_DIR=/復旧先のデータディレクトリ
export COMPOSE_PROFILES=production
BACKUP="$DATA_DIR/backups/YYYYMMDD_HHMMSS"
test -s "$BACKUP/glatasks.sql"
docker compose stop app
docker compose up -d db
docker compose exec -T db mariadb -uroot -pglatasks -e 'DROP DATABASE IF EXISTS glatasks; CREATE DATABASE glatasks CHARACTER SET utf8mb4'
docker compose exec -T db mariadb -uglatasks -pglatasks glatasks < "$BACKUP/glatasks.sql"
mkdir -p "$DATA_DIR"
for name in .encrypt_key .secret_key .mcp_clients.json; do
    if test -f "$BACKUP/$name"; then
        cp -p "$BACKUP/$name" "$DATA_DIR/$name"
    else
        rm -f "$DATA_DIR/$name"
    fi
done
docker compose up -d app
make healthcheck
```

鍵とMCP登録情報はDBコンテナではなくアプリの`DATA_DIR`から読み込まれるため、ファイルを戻してからアプリを起動する。
復旧後にブラウザーでタスクと添付ファイルを開いて内容を確認し、登録済みのMCPクライアントを再接続して登録情報を確認する。
MCP未使用の世代では`.mcp_clients.json`がなく、復旧先に以前の登録ファイルを残さない。

## リリース手順

事前に`gh`コマンドをインストールして`gh auth login`でログインしておく。次のいずれかを実行。

```bash
gh workflow run release.yaml --field="bump=PATCH"
gh workflow run release.yaml --field="bump=MINOR"
gh workflow run release.yaml --field="bump=MAJOR"
```

進捗は<https://github.com/ak110/GLATasks/actions>で確認できる。
