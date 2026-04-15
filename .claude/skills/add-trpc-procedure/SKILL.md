---
name: add-trpc-procedure
description: GLATasks に新しい tRPC procedure を追加するときの定型チェックリスト。Zod スキーマ → ルーター登録 → 難読化ミドルウェア → SSE 通知 → クライアント側 invalidate → テストの漏れを防ぐ。ユーザーが "tRPC procedure 追加" や "/add-trpc-procedure" を実行したとき、もしくは新しい router エントリを書く前に呼び出す。
---

# tRPC Procedure 追加手順 (GLATasks)

新しいtRPC procedureを追加するときは、以下のチェックリストをTaskCreateに展開してから着手する。項目に漏れがあると、難読化漏れ、SSE通知漏れ、クライアント側の再取得漏れ、型不一致などの致命的なバグを招きやすい。

## チェックリスト

### 1. 入出力スキーマの設計

- `app/src/lib/schemas.ts` にZodスキーマを追加する。既存スキーマ (`UpdateListSchema.pick(...)` 等) で再利用できる場合は優先する
- 数値パラメータは `z.coerce.number()` か、呼び出し側で `Number()` 変換する方針を明示する（JSONボディから文字列が混入するのを防ぐため）
- 市民時刻を扱う場合は `tz_offset_minutes: z.number()` を必ず含める（既存のタイマー系スキーマを参照）
- 型推論用の型エクスポート (`export type FooInput = z.infer<typeof FooSchema>`) は必要な場合のみ追加する

### 2. DB 層の実装

- `app/src/lib/server/api.ts` 等にDB操作関数を追加する。Drizzle ORMを使用
- `app/src/lib/server/schema.ts` のテーブル定義と整合すること
- 日時はUTCで保存、`sort_order` は1000刻み
- エラーは `api.ts` 内で機械可読な識別子を投げ、`trpc.ts` の `API_ERRORS` 側でUI文言へ変換する

### 3. tRPC ルーター登録

`app/src/lib/server/trpc.ts` の `appRouter` にprocedureを追加する:

- 原則として `encryptedProcedure` を使用する（認証 + APIエラー変換 + 難読化）
- `publicProcedure` は `auth.login` / `auth.register` のような未認証前提のものに限る
- mutation完了後、`sendEvent(ctx.userId, "<domain>:updated", ctx.tabId)` をreturn前に呼ぶ
- イベント種別は `lists:updated` / `tasks:updated` / `timers:updated` の3種のみ。影響ドメインが複数なら複数送る（`lists.merge` を参照）
- 新しい機械可読エラー識別子を導入した場合は `API_ERRORS` にマッピング追加

### 4. クライアント側の反映

- 新しいprocedureは `trpc.<domain>.<name>.mutate(...) / .query(...)` として呼び出す。
  呼び出し箇所は `app/src/routes/**/*.svelte` や `app/src/lib/components/**/*.svelte` に置く
- `$layout.svelte` / SSEハンドラで当該イベント種別を購読しており、TanStack Queryの `invalidateQueries` が動くかを確認する
- 新ドメインを増やす場合はSSEイベント一覧とハンドラを更新する
- 難読化はtRPCクライアントが自動で行うため、呼び出し側の明示的な暗号化処理は不要

### 5. テスト追加

- ユニットテスト: `app/src/**/*.test.ts` に追加（近傍の既存テストを雛形にする）
  - 非決定値（現在時刻・乱数）は固定値を注入する
  - 市民時刻を扱うprocedureは固定 `tz_offset_minutes` でケースを書く
- e2eテスト: ユーザーフローに絡む場合は `app/tests/` にPlaywrightテストを追加
  - `page.goto` + `waitForResponse(res => res.url().includes("/api/trpc"))` パターンを使う（development.md参照）
  - `main button:has-text("...")` のようにセレクタをスコープする

### 6. 検証

- `uvx pyfltr run --output-format=jsonl` をルートから実行
- 開発環境で `make healthcheck` が通ることを確認
- `trpc-zod-contract-reviewer` エージェントに差分レビューを依頼する (`.claude/agents/trpc-zod-contract-reviewer.md`)

### 7. コミット

- 変更内容が既存の未プッシュコミットの延長ならamendを検討、そうでなければ新規コミット
- コミット前に `git status ; git log --oneline --decorate -5` で状態確認

## 参考ファイル

- `app/src/lib/server/trpc.ts` — ルーター本体・ミドルウェア
- `app/src/lib/schemas.ts` — Zodスキーマ定義
- `app/src/lib/server/schema.ts` — Drizzleテーブル定義
- `app/src/lib/server/api.ts` — DB操作関数
- `app/src/lib/server/sse.ts` — SSE送信
- `app/src/lib/trpc.ts` — クライアント側tRPCクライアント
- `docs/src/content/docs/development/architecture.md` — SSE / 時刻同期 / 難読化設計
- `docs/src/content/docs/development/development.md` — テスト・開発環境の注意点
