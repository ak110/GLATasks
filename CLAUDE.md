# CLAUDE.md: glatasks

タスク管理・カウントダウンタイマー・アラームを統合したWeb/PWAアプリ。
SvelteKit + tRPC + Drizzleで構築し、Docker Composeで運用する。
本ファイルはClaude Code向けにコーディング規約・設計判断・実装上の注意点を集約する。

## 開発手順

よく使う`make`コマンド:

- `make format` — コード編集後に実行する。整形 + 自動修正付きlint
- `make test` — コミット前に実行する。
  pre-commit + pyfltr（lint・型チェック・ユニットテスト・svelte-check）+ バックアップテスト + e2e
- `make deploy` — ビルド → 停止 → 起動

全ターゲットの一覧は`make help`で確認できる。

- コミット前の検証方法: `uvx pyfltr run-for-agent`
  - ドキュメントなどのみの変更の場合は省略可（pre-commitで実行されるため）
  - 修正後の再実行時は、対象ファイルや対象ツールを必要に応じて絞って実行する（最終検証はCIに委ねる前提）
    - 例: `uvx pyfltr run-for-agent --commands=eslint,prettier path/to/file.ts`
  - 利用可能なコマンドは`pyproject.toml`の`[tool.pyfltr]`設定とJS/TS連携で有効になるもの。
    例: `eslint`・`prettier`・`oxlint`・`vitest`・カスタムコマンドの`svelte-check`
  - バックアップ/E2E系に変更を加えた場合は`make test-backup test-e2e`も実行する
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

## 注意点

- 本リポジトリはSvelte 5、Tailwind v4、tRPC v11、Vite 8など比較的新しいメジャーバージョンを使用している。
  ライブラリ仕様を確認する際はcontext7 MCPなどで最新版のドキュメントを参照する
- 開発環境はDocker Composeで動作する。ホストから`localhost:3000`に直接アクセスできない場合は次のいずれかを使う
  - nginx経由: `curl -k https://localhost:38180/healthcheck`
  - appコンテナ経由: `docker compose exec app curl --fail http://localhost:3000/healthcheck`
  - `docker compose --profile=development exec web curl -fLk https://localhost/`
  - `make healthcheck`はホスト直接 → コンテナ経由の順にフォールバックする
- 現在の`COMPOSE_PROFILE`を確認したいときは`make -n deploy`のドライラン出力で判別できる。
  `.env`を直接読めないことがあるため
- 特定のe2eテストだけを実行したい場合、`make test-e2e`はフィルタ引数を受け付けない。
  `make -n test-e2e`でドライラン展開した`docker compose`コマンドを直接呼び、
  末尾の`pnpm run test:e2e`を`pnpm exec playwright test -g "パターン"`へ差し替える
