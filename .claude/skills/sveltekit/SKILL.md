---
name: sveltekit
description: >-
  GLATasksのSvelteKit実装規約を読む。
  Svelteコンポーネント（`.svelte`）、TypeScript（`.ts`）、CSS（`.css`）を編集するとき、
  またはダークモード、ダイアログ、tRPC、D&D、Vitest設定を扱うときに呼び出す。
---

# SvelteKitの実装規約

GLATasksの実装で使う知識を提供する。
最初に作業へ該当する読込表の資料を全文読む。
手続きの追加は`add-trpc-procedure`、Playwrightの実装と診断は`e2etest`が担当する。

## 読込表

各条件が成立したら、その操作の前に対応する資料を全文読む。
条件は作業の途中でも判定する。

| 時点または条件                                                       | 全文読む資料                                   |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| 画面のスタイル、Tailwind、ダークモードを編集する前                   | [references/style.md](references/style.md)     |
| ダイアログ、メニュー、バナー、添付表示を編集する前                   | [references/dialogs.md](references/dialogs.md) |
| tRPC、operations、api、入出力スキーマ、SSEを編集する前               | [references/trpc.md](references/trpc.md)       |
| 画面状態、共有モジュール、ルーティング、rune、D&Dを編集する前        | [references/client.md](references/client.md)   |
| Vitestの設定、DOMテスト、onMountを含むモジュールのテストを編集する前 | [references/testing.md](references/testing.md) |
