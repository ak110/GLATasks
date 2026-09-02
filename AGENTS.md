# CLAUDE.md: glatasks

タスク管理・カウントダウンタイマー・アラームを統合したWeb/PWAアプリ。
SvelteKit + tRPC + Drizzleで構築し、Docker Composeで運用する。

## 開発手順

よく使う`make`コマンド:

- `make test-e2e`（E2Eテスト）
- `make test-backup`（バックアップのリストアと検証）
- `make deploy`（ビルド・停止・起動を順に実行）

全ターゲットの一覧は`make help`で確認できる。

- コミット前の検証方法: `uvx pyfltr run`
  - テストコードの単体実行なども極力`uvx pyfltr run <path>`を使う（直接呼び出さない）
  - 修正後の再実行時は`--commands=eslint,prettier`等で限定して実行する（最終検証はCIに委ねる前提）
    - 利用可能なコマンドは`pyproject.toml`の`[tool.pyfltr]`設定とJS/TS連携で有効になるもの。
      例: `eslint`・`prettier`・`oxlint`・`vitest`・カスタムコマンドの`svelte-check`
  - バックアップ/E2E系に変更を加えた場合は`make test-backup test-e2e`も実行する
  - Docker Compose環境は通常は開発マシン上で常時稼働しており`make test`（backup/e2eテスト含む）を実行できる
    - 停止している場合は`make start`で起動し、疎通を確認してからテストを実行する
      （疎通確認コマンド:
      `docker compose --profile=development exec app curl --fail http://localhost:3000/healthcheck`）
  - エージェント実行を示す環境変数がある環境では`run`がJSON Lines出力を既定で採用するため、
    診断結果をそのまま解釈できる。環境制約による指定ではない

## 実装上の不変条件・コーディング規約

### ツールチェイン

整形・lintはPrettierとESLintを採用する。
Prettierには`prettier-plugin-svelte`と`prettier-plugin-tailwindcss`を併用する。
ESLint側は`typescript-eslint`と`eslint-plugin-svelte`を組み合わせる。
Biomeへの移行は次の阻害要因により見送っている。

- Svelteマークアップ非対応。
  Biomeは`.svelte`のマークアップ部分のフォーマットに対応していない
  （現在は`prettier-plugin-svelte`が全体を統一的に処理する）
- Tailwind CSSクラスソート非対応。
  `prettier-plugin-tailwindcss`に相当する機能がBiomeに存在しない
  （当該機能はプロジェクト全体で使用している）

`svelte-check`はpyfltrの`custom-commands`機能で統合されている。
`uvx pyfltr run`から自動実行され、設定は`pyproject.toml`の
`[tool.pyfltr.custom-commands.svelte-check]`に置く。

## 注意点

- 本プロジェクトはSvelte 5、Tailwind v4、tRPC v11、Vite 8など比較的新しいメジャーバージョンを使用している。
  ライブラリ仕様を確認する際はcontext7 MCPなどで最新版のドキュメントを参照する
- 開発環境はDocker Composeで動作する。ホストから`localhost:3000`に直接アクセスできない場合は次のいずれかを使う
  - nginx経由: `curl -k https://localhost:38180/healthcheck`
  - appコンテナ経由: `docker compose --profile=development exec app curl --fail http://localhost:3000/healthcheck`
  - `docker compose --profile=development exec web curl -fLk https://localhost/`
  - `make healthcheck`はホスト直接 → コンテナ経由の順にフォールバックする
- 現在の`COMPOSE_PROFILE`を確認したいときは`make -p 2>/dev/null | grep -m1 '^COMPOSE_PROFILE '`で判別できる
  （`.env`を直接読み取れないことがあるため）。
  プロファイル指定は`COMPOSE_PROFILES`環境変数へ一括export済みであり、
  個別ターゲットのドライラン出力にはプロファイル値が現れない
- 特定のe2eテストだけを実行したい場合、`make test-e2e E2E_GREP="パターン"`で対象を限定できる
- ブラウザ内蔵AI API（`Translator`・`LanguageDetector`・`LanguageModel`）はPlaywright同梱のChromiumに存在しない。
  これらに依存する画面のe2eテストは`page.addInitScript`でグローバルをスタブしてから検証する
- 新規依存を追加する`pnpm add`はプロジェクトルートから実行する。
  `app/package.json`はルート`package.json`へのシンボリックリンクであり、
  `app/`配下から実行すると`pnpm-lock.yaml`に不正な`app:` importerセクションが生成され
  `--frozen-lockfile`検証が失敗する
- 依存パッケージの版を切り替えて問題を切り分ける場合は、切り替えのたびに
  `rm -rf node_modules && pnpm install`でクリーンインストールしてから検証する。
  `pnpm add`で版を切り替えても切り替え前の版が`node_modules/.pnpm`配下へ残り、
  型チェックが複数版の型定義を拾って実在しない失敗を報告する
  - 版を指定する場合はキャレット記法（`vitest@^4.1.10`）ではなく完全一致（`vitest@4.1.10`）で指定する。
    キャレット記法は範囲内の最新版へ解決するため、意図した版が入らない
- `app/src/lib/schemas.ts`はクライアント・サーバー双方から読み込まれる。
  Vite変換を経ない`app/tests/`配下のPlaywrightテストからも直接importされる。
  - CJSのみ提供の外部依存（`rrule`等）を追加する場合は
    `app/src/lib/server/`配下のserver専用ファイルへスキーマを分離する
    （既存パターンとその制約詳細は`app/src/lib/server/schedule-schemas.ts`冒頭コメントを参照）
  - 併せて`app/vite.config.ts`に`ssr.noExternal: ["該当パッケージ"]`を追加する
- 利用者設定（`user.preferences`）はJSON文字列を単一カラムへ保持し、
  `UserPreferencesSchema`の`safeParse`が失敗すると設定全体を空として扱う
  （`app/src/lib/server/api/users.ts`）。
  既存値が不正になる方向へスキーマを狭める場合は、同じマイグレーションで既存値を新しい制約へ適合させる。
  移行しないと当該利用者の全設定が既定値へ戻る。
  JSON内の数値は`JSON_SET(preferences, '$.key', CEILING(JSON_VALUE(preferences, '$.key')))`で更新できる
  （MariaDB 12.3.2で動作を確認した）
- DBスキーマを変更する`pnpm run db:generate`（`drizzle-kit generate`）は、列の新規追加か既存列の改名かを判別できない場合に対話プロンプトを表示する。
  対話端末を持たない実行では当該プロンプトの表示時点で例外終了するため、
  `script -qec "pnpm run db:generate" /dev/null`のように疑似端末を割り当てたうえで
  列の追加か改名かの問いに応答し、生成されたマイグレーションファイルの内容を確認して手直しする
- Docker Compose環境と`make`ターゲットは主作業ツリー（`git worktree list`の先頭に表示される作業ツリー）で実行する。
  git worktreeからは実行しない。worktreeにはgit管理外の`.env`が無いため`make`が
  `COMPOSE_PROFILE が定義されていません`で即座に終了し、`.env`を複製した場合も
  Composeのプロジェクト名がworktreeのディレクトリ名になるため、`web`の公開ポート38180と
  `${DATA_DIR}`配下のMariaDBデータディレクトリが主作業ツリーで稼働中の環境と衝突する
  （プロジェクト名は`docker compose config --format=json`の`name`で確認できる）。
  worktree内では`pnpm install --frozen-lockfile`のうえ`uvx pyfltr run <path>`までを実行し、
  E2Eとバックアップテストは主作業ツリーへ統合してから実行する
