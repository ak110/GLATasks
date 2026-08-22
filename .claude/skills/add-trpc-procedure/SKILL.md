---
# 編集者向け同期手順: 本スキル本文にschemas.tsの命名規約
# （`*Schema`・`*InputSchema`等の総称パターン・代表例列挙・命名慣行など）を一般化して
# 記述または改訂する場合は、事前に
# `grep -oE 'export const [A-Za-z]+Schema' app/src/lib/schemas.ts` 等でexport実態を確認し、
# 実際の命名分布と一致した表現に整える。
name: add-trpc-procedure
description: >-
  GLATasks に新しい tRPC procedure を追加するとき、
  または既存ドメインのスキーマへフィールドを追加するとき、
  もしくは既存 tRPC procedure を新規箇所（新規UIコンポーネント・新規ライブラリ関数など）から呼び出すときの定型チェックリスト。
  画面状態（表示範囲・表示種別など）の意味論を変更するときも対象とする。
  Zod スキーマ → ルーター登録 → 難読化ミドルウェア → SSE 通知 → クライアント側 invalidate → テスト、
  および既存 procedure 呼び出し時の入力スキーマ引数キー整合の漏れを防ぐ。
  ユーザーが "tRPC procedure 追加" や "/add-trpc-procedure" を実行したとき、
  もしくは新しい router エントリを書く前・既存スキーマを拡張する前・既存 procedure を新規箇所から呼び出す前・
  画面状態（表示範囲・表示種別など）の意味論を変更する前に呼び出す。
---

# tRPC Procedure 追加手順 (GLATasks)

新しいtRPC procedureを追加するときは、以下のチェックリストをTaskCreateに展開してから着手する。
項目に漏れがあると、難読化漏れ、SSE通知漏れ、クライアント側の再取得漏れ、型不一致などの致命的なバグを招きやすい。

## チェックリスト

### 1. 入出力スキーマの設計

- `app/src/lib/schemas.ts` にZodスキーマを追加する。既存スキーマ (`UpdateListSchema.pick(...)` 等) で再利用できる場合は優先する
- 数値パラメータは `z.coerce.number()` か、呼び出し側で `Number()` 変換するかの方針を明示する（文字列混入を防ぐため）
- 市民時刻を扱う場合は `tz_offset_minutes: z.number()` を必ず含める（既存のタイマー系スキーマを参照）
- 型推論用の型エクスポート (`export type FooInput = z.infer<typeof FooSchema>`) は必要な場合のみ追加する
- 取得系procedureが画面状態（表示範囲・表示種別など）を入力に取る場合、同種データを返す既存の全取得経路（tRPC・MCP）へ
  当該入力が伝播しているか確認する

### 2. DB 層の実装

- `app/src/lib/server/api/{ドメイン}.ts`（`lists.ts`・`tasks.ts`・`timers.ts`・`users.ts`等）に
  DB操作関数を追加する。Drizzle ORMを使用する
- `app/src/lib/server/schema.ts`のテーブル定義と整合すること
- `app/src/lib/server/schema.ts`のテーブル定義を変更した場合はマイグレーションファイルを生成する。
  手順は`docs/development/development.md`「DBマイグレーション運用」節を参照する
- 日時はUTCで保存、`sort_order`は1000刻み
- エラーは`api/{ドメイン}.ts`内で機械可読な識別子を送出し、`trpc.ts`の`API_ERRORS`側でUI文言へ変換する
- create系mutationでサーバー生成IDをクライアントへ返す場合は
  `db.insert(...).values(...).$returningId()`を使う（drizzle-orm/mysql慣用パターン）
- api層関数のシグネチャ規約:
  - 新規関数は原則`userId`を第1位置引数に取る
  - 例外: `attachments`は全関数、`timers`は`createTimer`のみオブジェクト引数パターン

### 3. tRPC ルーター登録

`app/src/lib/server/trpc.ts` の `appRouter` にprocedureを追加する:

- procedure種別選択（`encryptedProcedure`・`publicProcedure`使い分け）・
  `eventMutationHandler`共通builder使用方針は`sveltekit`スキルのtRPC実装規約節をSSOTとする
- SSEイベント種別一覧は`docs/development/architecture.md`の`## リアルタイム同期（SSE）`節を参照する
- 影響ドメインが複数なら複数のSSEイベントを送る（`lists.merge`を参照）
- 新しい機械可読エラー識別子を導入した場合は`API_ERRORS`にマッピング追加
- ミドルウェアを追加または改修する場合、下流のprocedureが送出した例外を捕捉するには、
  `try/catch` ではなく `await next()` の戻り値の `result.ok` を判定する
  （tRPC v11の `next()` は例外を再送出せず `{ok: false, error}` で返すため）
  - 詳細は `docs/development/architecture.md` の「tRPCミドルウェア設計」節を参照する
- 認証コンテキストと所有権確認:
  - resolverで`ctx.userId`を取得し、api層関数へ渡す
  - リソースIDに対する所有権は所有権の確認関数で検証する。
    既存の`getOwnedList(listId, userId)`等は`(<リソースID>, userId)`順の既存パターンで、
    `### 2. DB 層の実装`のシグネチャ規約（`userId`第1位置）とは別カテゴリとして扱う

### 4. クライアント側の反映

- 新しいprocedureは `trpc.<domain>.<name>.mutate(...) / .query(...)` として呼び出す。
  呼び出し箇所は `app/src/routes/**/*.svelte` や `app/src/lib/components/**/*.svelte` に置く
- `$layout.svelte` / SSEハンドラで当該イベント種別を購読しており、TanStack Queryの `invalidateQueries` が動くかを確認する
- 新ドメインを増やす場合はSSEイベント一覧とハンドラを更新する
- 難読化はtRPCクライアントが自動で行うため、呼び出し側の明示的な暗号化処理は不要

### 5. MCP tool定義への波及

- 既存ドメインに新規フィールドを追加した場合、
  `app/src/lib/server/mcp/server.ts`の同ドメイン`registerTool`ハンドラーが
  新規フィールドを転送しているかを確認する
- 現状MCP tool定義があるドメイン: `lists`・`tasks`・`timers`・`users`

### 6. 公開ドキュメント追従

- 利用者向け機能を追加する場合は`README.md`「## 特徴」節と
  `docs/guide/getting-started.md`「## 主な機能」節への追記を計画対象へ含める
- 新規SSEイベント種別・新規DBテーブル・DB設計方針の例外を導入する場合は
  `docs/development/architecture.md`の該当節に追記する。
  対象節は`## リアルタイム同期（SSE）`・`## DB 設計方針`などが該当する

### 7. テスト追加

- ユニットテスト: `app/src/**/*.test.ts` に追加（近傍の既存テストを雛形にする）
  - 非決定値（現在時刻・乱数）は固定値を注入する
  - 市民時刻を扱うprocedureは固定 `tz_offset_minutes` でケースを書く
  - `encryptedProcedure` を `createCaller` で呼ぶルーターテストでは、
    `vi.mock('$lib/server/crypto')`・`vi.mock('$lib/server/sse')`・
    `vi.mock('$lib/server/api')` をセットで書く
    - `getEncryptKey`が`DATABASE_URL`を要求する連鎖と副作用をすべて遮断する目的
    - 雛形は `app/src/lib/server/trpc.test.ts` を参照する
- e2eテスト: ユーザーフローに絡む場合は `app/tests/` にPlaywrightテストを追加
  - `page.goto` + `waitForResponse(res => res.url().includes("/api/trpc"))` パターンを使う（development.md参照）
  - `main button:has-text("...")` のようにセレクタをスコープする

### 8. 検証

- `uvx pyfltr run` をルートから実行
- 開発環境で `make healthcheck` が通ることを確認
- `trpc-zod-contract-reviewer` エージェントに差分レビューを依頼する (`.claude/agents/trpc-zod-contract-reviewer.md`)

## 既存procedure呼び出し時の確認

既存procedureを新規箇所から呼び出す場合、入力スキーマの引数キー名を
`app/src/lib/schemas.ts`の対応するスキーマ定義で必ず参照する。
schemas.tsの命名規約は`<Verb><Domain>Schema`を基本とする（例: `CreateTaskSchema`・`StartTimerSchema`）。
一部に`InputSchema`接尾辞を用いる（例: `DownloadAttachmentInputSchema`）。
既存呼び出し例（`app/src/lib/attachment-download.ts`の
`trpc.attachments.download.query({ attachmentId })`等）と一致確認する。

型迂回箇所（`as any`・`@ts-ignore`、および`vi.mock()`のモックファクトリで
戻り値の型情報を失った状態の呼び出し等）では、引数キー不整合をTypeScript型検査で
自動検出できない。
当該箇所は`app/src/lib/schemas.ts`の対応するスキーマ定義と引数キーが一致しているかを目視確認する。

## 参考ファイル

- `app/src/lib/server/trpc.ts`（ルーター本体・ミドルウェア）
- `app/src/lib/schemas.ts`（Zodスキーマ定義）
- `app/src/lib/server/schema.ts`（Drizzleテーブル定義）
- `app/src/lib/server/api/{ドメイン}.ts`（DB操作関数。`api.ts`は呼び出し側向けの再エクスポートバレル）
- `app/src/lib/server/sse.ts`（SSE送信）
- `app/src/lib/trpc.ts`（クライアント側tRPCクライアント）
- `docs/development/architecture.md`（SSE・時刻同期・認証・tRPCミドルウェア・DB設計）
- `docs/development/development.md`（テスト・開発環境の注意点）
- `.claude/skills/sveltekit/SKILL.md`（tRPC実装規約とアーキテクチャ前提）
- `.claude/skills/e2etest/SKILL.md`（Playwrightテスト実装の注意点）
