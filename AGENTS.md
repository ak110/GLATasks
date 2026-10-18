# AGENTS.md: glatasks

タスク管理・タイマー・アラーム・翻訳・カロリーを統合したWeb/PWAアプリ。
SvelteKit、tRPC、Drizzleで構築し、Docker Composeで運用する。

## 開発手順

セットアップ、コマンド、依存更新とDB運用は[開発手順](docs/development/development.md)を参照。
全ターゲットは`make help`で確認する。

- コミット前は`uvx --exclude-newer-package pyfltr=false pyfltr run`で検証する
- 単体実行も`pyfltr run <path>`を使い、修正後は失敗したコマンドへ限定して再実行する
- バックアップを変更した場合は`make test-backup`を実行する
- DBアクセスを変更した場合は`make test-db`を実行する。通常のpyfltrとCIのtest jobはDBテストをスキップし、test-dbはnode project全体をDBへ接続して実行する
- test-dbは実行のたびに作成し直す試験専用のデータベース（`glatasks_test`）へ接続するため、開発用のデータと稼働中のアプリの定期処理に影響しない。node projectはUTCと本番と同じ`TZ=Asia/Tokyo`の両方で実行する
- 画面と個別E2Eの変更は対応するテストを`make test-e2e E2E_GREP="パターン"`で実行する。全体E2EはCIのproduction環境で実行する
- 対象を限定できない認証、SSE、共有fixture、全画面の初期化、Playwright設定を変更した場合は`make test-e2e`で全体E2Eを実行する
- 開発環境が停止している場合は`make start`と`make healthcheck`で起動と疎通を確認してからテストを行う

## アーキテクチャの参照先

責務、通知、認証、難読化、DB、日時の設計は[アーキテクチャ](docs/development/architecture.md)を参照。

## 実装上の不変条件・コーディング規約

### ツールチェイン

整形はPrettierとSvelte・Tailwindのプラグイン、lintはESLintとtypescript-eslint・eslint-plugin-svelteを使う。
`svelte-check`は`pyproject.toml`のcustom-commandsでpyfltrへ統合されている。
SvelteのマークアップとTailwindのクラス順を同じ整形処理で保つため、この組み合わせを維持する。

### 共有スキーマとデータ

- `app/src/lib/schemas.ts`はクライアント、サーバー、Vite変換を経ないPlaywrightから読み込まれる。CJSだけの依存を使うスキーマはserver専用ファイルへ分け、Viteの`ssr.noExternal`も設定する
- CJSの分離例と制約は`app/src/lib/server/schedule-schemas.ts`の冒頭コメントを参照
- ユーザー設定のスキーマを狭める場合やJSON内のキーを変更する場合は、同じマイグレーションで既存設定を移行する。safeParseが失敗すると設定全体が空として扱われるためである
- text系の容量はUTF-8のバイト長でDB列の上限を検証する。Zodの文字数だけで上限を判断しない
- base64による約4/3倍の膨張後もHTTP本文の上限へ収まることを確認する。`MAX_TASK_TEXT_BYTES`と暗号化処理を参照

## サブエージェント・スキル連携

- Svelte、TypeScript、CSS、tRPC、画面状態、Vitestを編集する場合は`sveltekit`を起動し、作業に該当する資料を読む
- 手続きの追加、スキーマの拡張、新しい場所からの呼び出し、表示種別の意味の変更は`add-trpc-procedure`を起動する
- `app/tests/`の編集とE2Eの診断・再実行は`e2etest`を起動する
- tRPC、入力スキーマ、DB、operations、SSE、再取得対象を変更した後は、変更ファイルと意図を渡して`trpc-zod-contract-reviewer`へレビューを依頼する

## 注意点

ライブラリの仕様は対象版の公式資料で確認する。
ブラウザー内蔵AIはPlaywrightのChromiumに存在しないため、E2Eでは`page.addInitScript`でスタブする。
DBスキーマ生成が列の追加と改名を問う場合は対話端末を割り当てて応答し、生成SQLを検収する。

Docker ComposeとDockerを使う`make`は主作業ツリーで実行する。
worktreeは`.env`を持たず、複製すると公開ポートとDBの保存先が稼働中の環境と衝突する。
worktreeでは`pnpm install --frozen-lockfile`後にアプリの型を生成し、対象のpyfltrと文書ビルドを実行する。
型生成の方法とtsconfigの構成は[開発環境の構築手順](docs/development/development.md#開発環境の構築手順)を参照。
E2Eとバックアップテストは主作業ツリーへ統合してから実行する。
