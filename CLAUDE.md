# CLAUDE.md: glatasks

タスク管理・カウントダウンタイマー・アラームを統合したWeb/PWAアプリ。
SvelteKit + tRPC + Drizzleで構築し、Docker Composeで運用する。
本ファイルはClaude Code向けにコーディング規約・設計判断・実装上の注意点を集約する。
人間の開発者向けの情報は[docs/development/development.md](docs/development/development.md)を参照。

## 開発手順

よく使う`make`コマンド:

- `make format` — コード編集後に実行する。整形 + 自動修正付きlint
- `make test` — コミット前に実行する。
  pre-commit + pyfltr（lint・型チェック・ユニットテスト・svelte-check）+ バックアップテスト + e2e
- `make deploy` — ビルド → 停止 → 起動

全ターゲットの一覧は[docs/development/development.md](docs/development/development.md)の「開発コマンド」を参照。

コミット前の追加検証は`uvx pyfltr run-for-agent`を使う。

- ドキュメントなどのみの変更の場合は省略可。pre-commitで実行されるため
- テストコードの単体実行なども極力`uvx pyfltr run-for-agent <path>`を使う
- 修正後の再実行時は対象ファイルや対象ツールを必要に応じて絞って実行する（最終検証はCIに委ねる前提）。
  例: `uvx pyfltr run-for-agent --commands=eslint,prettier path/to/file.ts`
- 利用可能なコマンドは`pyproject.toml`の`[tool.pyfltr]`設定とJS/TS連携で有効になるもの。
  例: `eslint`・`prettier`・`oxlint`・`vitest`・カスタムコマンドの`svelte-check`
- バックアップ/E2E系に変更を入れた場合は`make test-backup test-e2e`も実行する
- 注意: 本プロジェクトのDocker Compose環境は開発マシン上で常時稼働している。
  `make test`（backup/e2eテスト含む）は問題なく実行可能。
  `uvx pyfltr run-for-agent`を使うのはJSON Lines出力で診断結果を効率的に解釈するためであり、
  環境制約によるものではない

## 実装上の不変条件・コーディング規約

### ツールチェイン

整形・lintはPrettierとESLintを採用する。
Prettierには`prettier-plugin-svelte`と`prettier-plugin-tailwindcss`を併用する。
ESLint側は`typescript-eslint`と`eslint-plugin-svelte`を組み合わせる。
Biomeへの移行は次の阻害要因により見送っている。

- Svelteマークアップ非対応 — Biomeは`.svelte`のマークアップ部分のフォーマットに対応していない。
  現在は`prettier-plugin-svelte`が全体を統一的に処理する
- Tailwind CSSクラスソート非対応 — `prettier-plugin-tailwindcss`に相当する機能がBiomeに存在しない。
  当該機能はプロジェクト全体で使用している

`svelte-check`はpyfltrの`custom-commands`機能で統合されている。
`uvx pyfltr run`から自動実行され、設定は`pyproject.toml`の
`[tool.pyfltr.custom-commands.svelte-check]`に置く。

### サプライチェーン対策

npm / PyPIレジストリへの悪意あるパッケージ公開に対する防御として、次の方針を採用する。

- `pnpm-workspace.yaml`の`minimumReleaseAge: 1440`（1日 = 1440分）で
  公開から1日未満のnpmパッケージのインストールを禁止する。`pnpm dlx`にも適用される（pnpm 10.18以降）
- `uv.toml`の`exclude-newer = "1 day"`でPyPIに公開されてから1日未満のパッケージのインストールを禁止する。
  `uvx`（`uv tool run`）にも適用される
- `.pre-commit-config.yaml`の`additional_dependencies`はpnpmを介さないため、
  `@latest`を使わずバージョンを固定する
- CI・Docker・`make`から呼ばれる`pnpm install`は`--frozen-lockfile`を明示する。
  ロックファイル乖離時の再resolveを禁止して二重防御を構成する。
  対象は`Dockerfile`・`compose.yaml`系・`Makefile`・GitHub Actionsの該当ステップ

依存更新時は`make update`から呼ばれる`pnpm update --latest`を使う
（`pnpm update`は`--frozen-lockfile`の影響を受けないため開発フローを阻害しない）。
緊急で公開直後のパッケージが必要な場合は`pnpm-workspace.yaml`の`minimumReleaseAgeExclude`に追加する。

### テスト設計思想

`make format`と`make test`の2パターンを基本とする。

- `make format` — 軽量な整形 + lint。コード編集後に日常的に実行する用途。
  pre-commit hooks（prettier・eslint --fix・markdownlint・textlint）+ `pyfltr fast`を実行する
- `make test` — 全テスト。コミット前に実行する用途。
  pre-commit → `pyfltr run`（lint・型チェック・ユニットテスト・svelte-check）
  → バックアップテスト → e2eテスト
- CI（`ci.yaml`）— `test` jobで`pyfltr ci`を実行する。
  `integration` jobでDocker Composeを起動してバックアップテストとe2eテストを実行する

### 並び順方針

`sort_order`の付与方針はドメインごとに異なる。新規作成時の挙動を追加・修正する際は既存仕様に合わせる。

- タスク（`tasks.create`）: `sort_order = 既存最小値 - 1000` で先頭挿入
- タイマー（`timers.create`）: `sort_order = 既存最大値 + 1000` で末尾追加

### 実装規約

- APIハンドラ（`app/src/lib/server/api/`配下）の関数引数は`Record<string, unknown>`を使わず、
  Zodスキーマから`z.infer`で得た型を引数に取る。Drizzleの型推論が正しく機能する形を維持する
- JSONボディから受け取る数値は文字列の場合があるため`Number()`で明示変換する。
  `"5" !== 5`の型不一致を防ぐ
- 日時は全レイヤーでUTC統一。
  DB（TIMESTAMP型）→ サーバー（Dateオブジェクト）→ クライアント（ISO8601文字列）の変換は自動で行われるため、
  タイムゾーンを意識するコードは不要
- Vitestはプロジェクト分割構成（`vitest.config.ts` @ repo root）。
  `node` project（`*.test.ts`）と`dom` project（`*.svelte.test.ts` / `*.dom.test.ts`）を使い分ける
- tRPC実装規約（mutation共通builder・戻り値型・アーキテクチャ前提）は
  自動ロード対象のルールとして個別ファイルに集約している

## 注意点

- 本リポジトリはSvelte 5、Tailwind v4、tRPC v11、Vite 8など比較的新しいメジャーバージョンを使用している。
  ライブラリ仕様を確認する際はcontext7 MCPなどで最新版のドキュメントを参照する
- 開発環境はDocker Composeで動作する。ホストから`localhost:3000`に直接アクセスできない場合は次のいずれかを使う
  - nginx経由: `curl -k https://localhost:38180/healthcheck`
  - appコンテナ経由: `docker compose exec app curl --fail http://localhost:3000/healthcheck`
  - `docker compose --profile development exec web curl -fLk https://localhost/`
  - `make healthcheck`はホスト直接 → コンテナ経由の順にフォールバックする
- 現在の`COMPOSE_PROFILE`を確認したいときは`make -n deploy`のドライラン出力で判別できる。
  `.env`を直接読めないことがあるため
