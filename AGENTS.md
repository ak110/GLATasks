# AGENTS.md: glatasks

タスク管理・カウントダウンタイマー・アラームを統合したWeb/PWAアプリ。
SvelteKit + tRPC + Drizzleで構築し、Docker Composeで運用する。

## 開発手順

よく使う`make`コマンド:

- `make test-e2e`（E2Eテスト）
- `make test-backup`（バックアップのリストアと検証）
- `make deploy`（ビルド・停止・起動を順に実行）

全ターゲットの一覧は`make help`で確認できる。

- コミット前の検証方法: `uvx --exclude-newer-package pyfltr=false pyfltr run`
  - テストコードの単体実行なども極力`uvx --exclude-newer-package pyfltr=false pyfltr run <path>`を使う（直接呼び出さない）
  - 修正後の再実行時は`--commands=eslint,prettier`等で限定して実行する（最終検証はCIに委ねる前提）
    - 利用可能なコマンドは`pyproject.toml`の`[tool.pyfltr]`設定とJS/TS連携で有効になるもの。
      例: `eslint`・`prettier`・`oxlint`・`vitest`・カスタムコマンドの`svelte-check`
  - バックアップ機能を変更した場合は`make test-backup`も実行する
  - 画面又は個別のE2E仕様を変更した場合は、変更した定義とその直接消費側に対応するspecだけを
    `make test-e2e E2E_GREP="パターン"`で実行する。
    全体E2EはCIのintegration jobがproduction環境で実行するため、近接E2Eの成功後に同じローカル環境で全体E2Eを重ねない
  - 影響するspecの集合を変更箇所から限定できない共有基盤を変更した場合は、`make test-e2e`で全体E2Eを実行する。
    Playwrightの共有fixture、全画面に共通する初期化、認証、SSE制御、Playwrightの実行設定などが該当する
  - Docker Compose環境は通常は開発マシン上で常時稼働しており`make test`（backup/e2eテスト含む）を実行できる
    - 停止している場合は`make start`で起動し、疎通を確認してからテストを実行する
      （疎通確認コマンド: `make healthcheck`）
  - エージェント実行を示す環境変数がある環境では`run`がオプションなしでJSON Lines形式で出力するため、
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
`uvx --exclude-newer-package pyfltr=false pyfltr run`から自動実行され、設定は`pyproject.toml`の
`[tool.pyfltr.custom-commands.svelte-check]`に置く。

## 注意点

- 本プロジェクトはSvelte 5、Tailwind v4、tRPC v11、Vite 8など比較的新しいメジャーバージョンを使用している。
  ライブラリ仕様を確認する際はcontext7 MCPなどで最新版のドキュメントを参照する
- 開発環境はDocker Composeで動作する。ホストから`localhost:3000`に直接アクセスできない場合は次のいずれかを使う
  - nginx経由: `curl -k https://localhost:38180/healthcheck`
  - appコンテナ経由: `docker compose --profile=development exec app curl --fail http://localhost:3000/healthcheck`
  - `docker compose --profile=development exec web curl -fLk https://localhost/`
  - 起動後の疎通確認には`make healthcheck`を使う。ホスト直接 → コンテナ経由の順で最大30回試行し、成功時に終了する
    - 試行間隔は2秒、各HTTP要求の上限は2秒とする。最後の試行後は待機せず、全試行が失敗した場合は非0で終了する
- 現在の`COMPOSE_PROFILE`を確認したいときは`make -p 2>/dev/null | grep -m1 '^COMPOSE_PROFILE '`で判別できる
  （`.env`を直接読み取れないことがあるため）。
  プロファイル指定は`COMPOSE_PROFILES`環境変数へ一括export済みであり、
  個別ターゲットのドライラン出力にはプロファイル値が現れない
- 特定のe2eテストだけを実行したい場合、`make test-e2e E2E_GREP="パターン"`で対象を限定できる
- ブラウザ内蔵AI API（`Translator`・`LanguageDetector`・`LanguageModel`）はPlaywright同梱のChromiumに存在しない。
  これらに依存する画面のe2eテストは`page.addInitScript`でグローバルをスタブしてから検証する
- pnpmのコマンドは`add`・`exec`などのサブコマンドによらずリポジトリールートから起動し、
  `app/`配下をカレントディレクトリーにしない（`--dir app`での起動も同じ）。
  `app/package.json`はルート`package.json`へのシンボリックリンクであり、
  `pnpm-workspace.yaml`の`packages`には`app`が無いため、`app/`配下で起動したpnpmは`app`を独立したプロジェクトとして扱う。
  例えば`pnpm add`は`pnpm-lock.yaml`に不正な`app:` importerセクションを生成し、
  `--frozen-lockfile`検証が失敗する。
  `app`で実行ファイルを動かす場合は、ルートに導入済みの`node_modules/.bin`配下を直接呼ぶ
- 依存パッケージの版を切り替えて問題の原因を調べる場合は、切り替えのたびに
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
- `schemas.ts`のtext系フィールドへ大きめの容量上限を設計する場合は、DBカラム型の最大バイト数
  （`mediumtext`は16,777,215バイト）を超えないことをUTF-8バイト長（`TextEncoder`）で検証する。
  リクエスト・レスポンスの暗号化処理（`app/src/lib/server/crypto.ts`）はbase64展開で
  約4/3倍に膨張するため、この最終リクエストボディサイズが`compose.*.yaml`の
  `BODY_SIZE_LIMIT`へ収まることも確認する。
  Zodの`.max()`は文字数（UTF-16コード単位）を数えるため、日本語のような3バイト文字が
  多い本文では文字数ベースの上限だとバイト数の見積もりを誤る
  （`MAX_TASK_TEXT_BYTES`・`app/src/lib/schemas.ts`が実装例）
- DBスキーマを変更する`pnpm run db:generate`（`drizzle-kit generate`）は列の新規追加か既存列の改名かを判別できない場合に対話プロンプトを表示する。
  対話端末を持たない実行では当該プロンプトの表示時点で例外終了するため、
  `script -qec "pnpm run db:generate" /dev/null`のように疑似端末を割り当てたうえで
  列の追加か改名かの問いに応答し、生成されたマイグレーションファイルの内容を確認して手直しする
- Docker Compose環境と`make`ターゲットは主作業ツリー（`git worktree list`の先頭に表示される作業ツリー）で実行する。
  git worktreeからは実行しない。worktreeにはgit管理外の`.env`が無いため`make`が
  `COMPOSE_PROFILE が定義されていません`で即座に終了し、`.env`を複製した場合も
  Composeのプロジェクト名がworktreeのディレクトリ名になるため、`web`の公開ポート38180と
  `${DATA_DIR}`配下のMariaDBデータディレクトリが主作業ツリーで稼働中の環境と衝突する
  （プロジェクト名は`docker compose config --format=json`の`name`で確認できる）。
  worktree内では`pnpm install --frozen-lockfile`のうえ`uvx --exclude-newer-package pyfltr=false pyfltr run <path>`までを実行し、
  E2Eとバックアップテストは主作業ツリーへ統合してから実行する
- 新規に作成したgit worktreeでは、`pnpm install --frozen-lockfile`を実行する。
  その後に`app`ディレクトリーで`../node_modules/.bin/svelte-kit sync`を実行し、`app/.svelte-kit/tsconfig.json`を生成してから検証コマンドを実行する。
  `app/.svelte-kit`はgit管理外のため新しいworktreeには存在せず、生成前は`pnpm run test:unit`（`vitest run`）が`Tsconfig not found`と`[RESOLVE_ERROR] Could not resolve 'node:module'`で失敗する。
  `svelte-kit sync`はSvelteKitのルートである`app`で実行する。
  リポジトリールートで実行した場合はルート直下へ`.svelte-kit`を生成するため、`pnpm run test:unit`は失敗したままとなる。
  `app`でpnpm経由で`svelte-kit sync`を実行すると、前述のとおりpnpmが`app`を独立したプロジェクトとして扱って依存の導入を始め、
  `app/pnpm-lock.yaml`・`app/pnpm-workspace.yaml`・`app/node_modules`を生成したうえで`ERR_PNPM_IGNORED_BUILDS`で終了し、`svelte-kit sync`へ到達しない。
  誤ってこれらを生成した場合は3つとも削除する。
  `pnpm run check`（`svelte-check`）は自身が`svelte-kit sync`を実行するため、この生成を前提としない
