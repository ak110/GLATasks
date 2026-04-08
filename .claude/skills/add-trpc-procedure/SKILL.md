---
name: add-trpc-procedure
description: GLATasks に新しい tRPC procedure を追加するときの定型チェックリスト。Zod スキーマ → ルーター登録 → 難読化ミドルウェア → SSE 通知 → クライアント側 invalidate → テストの漏れを防ぐ。ユーザーが "tRPC procedure 追加" や "/add-trpc-procedure" を実行したとき、もしくは新しい router エントリを書く前に呼び出す。
---

# tRPC Procedure 追加手順 (GLATasks)

新しい tRPC procedure を追加するときは、以下のチェックリストを TaskCreate に展開してから着手する。項目に漏れがあると、難読化漏れ、SSE 通知漏れ、クライアント側の再取得漏れ、型不一致などの致命的なバグを招きやすい。

## チェックリスト

### 1. 入出力スキーマの設計

- `app/src/lib/schemas.ts` に Zod スキーマを追加する。既存スキーマ (`UpdateListSchema.pick(...)` 等) で再利用できる場合は優先する
- 数値パラメータは `z.coerce.number()` か、呼び出し側で `Number()` 変換する方針を明示する (JSON ボディから文字列が混入するのを防ぐため)
- 市民時刻を扱う場合は `tz_offset_minutes: z.number()` を必ず含める (既存のタイマー系スキーマを参照)
- 型推論用の型エクスポート (`export type FooInput = z.infer<typeof FooSchema>`) は必要な場合のみ追加する

### 2. DB 層の実装

- `app/src/lib/server/api.ts` 等に DB 操作関数を追加する。Drizzle ORM を使用
- `app/src/lib/server/schema.ts` のテーブル定義と整合すること
- 日時は UTC で保存、`sort_order` は 1000 刻み
- エラーは `api.ts` 内で機械可読な識別子を投げ、`trpc.ts` の `API_ERRORS` 側で UI 文言へ変換する

### 3. tRPC ルーター登録

`app/src/lib/server/trpc.ts` の `appRouter` に procedure を追加する:

- 原則として `encryptedProcedure` を使用する (認証 + API エラー変換 + 難読化)
- `publicProcedure` は `auth.login` / `auth.register` のような未認証前提のものに限る
- mutation 完了後、`sendEvent(ctx.userId, "<domain>:updated", ctx.tabId)` を return 前に呼ぶ
- イベント種別は `lists:updated` / `tasks:updated` / `timers:updated` の3種のみ。影響ドメインが複数なら複数送る (`lists.merge` を参照)
- 新しい機械可読エラー識別子を導入した場合は `API_ERRORS` にマッピング追加

### 4. クライアント側の反映

- `app/src/routes/**/*.svelte` や `app/src/lib/components/**/*.svelte` で新しい procedure を `trpc.<domain>.<name>.mutate(...) / .query(...)` として呼び出す
- `$layout.svelte` / SSE ハンドラで当該イベント種別を購読しており、TanStack Query の `invalidateQueries` が動くかを確認する。新ドメインを増やす場合は SSE イベント一覧とハンドラを更新する
- 難読化は tRPC クライアントが自動で行うため、呼び出し側の明示的な暗号化処理は不要

### 5. テスト追加

- ユニットテスト: `app/src/**/*.test.ts` に追加 (近傍の既存テストを雛形にする)
  - 非決定値 (現在時刻・乱数) は固定値を注入する
  - 市民時刻を扱う procedure は固定 `tz_offset_minutes` でケースを書く
- e2e テスト: ユーザーフローに絡む場合は `app/tests/` に Playwright テストを追加
  - `page.goto` + `waitForResponse(res => res.url().includes("/api/trpc"))` パターンを使う (development.md 参照)
  - `main button:has-text("...")` のようにセレクタをスコープする

### 6. 検証

- `make format` → `make test` をルートから実行 (`app/` に cd しない。Makefile のパス解決が整合しなくなる)
- 開発環境で `make healthcheck` が通ることを確認
- `trpc-zod-contract-reviewer` エージェントに差分レビューを依頼する (`.claude/agents/trpc-zod-contract-reviewer.md`)

### 7. コミット

- 変更内容が既存の未プッシュコミットの延長なら amend を検討、そうでなければ新規コミット
- コミット前に `git status ; git log --oneline --decorate -5` で状態確認

## 参考ファイル

- `app/src/lib/server/trpc.ts` — ルーター本体・ミドルウェア
- `app/src/lib/schemas.ts` — Zod スキーマ定義
- `app/src/lib/server/schema.ts` — Drizzle テーブル定義
- `app/src/lib/server/api.ts` — DB 操作関数
- `app/src/lib/server/sse.ts` — SSE 送信
- `app/src/lib/trpc.ts` — クライアント側 tRPC クライアント
- `docs/src/content/docs/development/architecture.md` — SSE / 時刻同期 / 難読化設計
- `docs/src/content/docs/development/development.md` — テスト・開発環境の注意点
