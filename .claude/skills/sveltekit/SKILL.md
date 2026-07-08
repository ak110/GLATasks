---
name: sveltekit
description: >-
  GLATasks の SvelteKit コーディングスタイルと規約リファレンス。
  Svelte コンポーネント（`.svelte`）・TypeScript（`.ts`）・CSS（`.css`）を編集するとき、
  またはダークモード対応・ダイアログ操作・tRPC 実装・D&D 並び替え・Vitest 設定を扱うときに呼び出す。
---

# SvelteKit コーディングスタイル

## Tailwind CSS の規約

- ボーダー色は `border-gray-200` を基本とする（デフォルトの `border` は黒が強すぎるため）
- e2eテストのセレクタにはCSSクラスではなく `data-testid` 属性を使用する
- クリック可能な要素（`<label>`、`<button>`、`<a>`、`<input type="checkbox">` など）には `cursor-pointer` を付与する
- テキスト・絵文字ボタンには `rounded` + パディング + `hover:bg-*` を付与する
  - 通常背景: `rounded p-1 hover:bg-gray-100`（アイコン）/ `rounded px-3 py-1.5 hover:bg-*`（テキスト付き）
  - ダークヘッダー内: `hover:bg-gray-700`
- ヘッダー: `sticky top-0 z-10 h-12 bg-gray-800` 固定。共通コンポーネント `Header.svelte` を使用する
  - ナビリンク: `cursor-pointer rounded text-sm text-gray-300 hover:bg-gray-700 hover:text-white`
  - アクティブナビ: `text-sm font-semibold text-gray-200`（リンクなし）
- コンテンツ領域のアクションボタン: `cursor-pointer rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200`
- ダイアログの共通パターン: ヘッダーにタイトル+✕閉じるボタン、キャンセルボタンは使わない
  - 確認・入力ダイアログはこのルールの適用除外（後述のダイアログ運用ルール参照）
- タグバッジの色は`app/src/lib/tag-palette.ts`に集約し、Tailwindクラスを直接ハードコードしない
  - 色覚バリアフリー配色（Okabe-Ito系）を淡色化した8色パレットから`getTagColorClass()`経由で取得する

## ダークモードの色マッピング

Tailwind CSS v4の `@custom-variant dark` を使用。`<html>` に `.dark` クラスを付与して切り替え。

### 設計原則

- 背景色: ライト/ダーク双方で4段階の階層（ヘッダー→ページ→カード→ボタン）を保つ
- テキスト・ボーダー: grayスケールを反転しつつWCAG AA基準4.5:1のコントラスト比を維持する
- アクセントカラー（blue/red系）: ダークモードでは900に透明度を掛けて強調度を段階制御する

### 背景色

| ライトモード  | ダークモード          | 用途                                   |
| ------------- | --------------------- | -------------------------------------- |
| `bg-gray-800` | `dark:bg-gray-950`    | ヘッダー（最も手前のレイヤー）         |
| `bg-gray-50`  | `dark:bg-gray-900`    | ページ全体の背景（最も奥のレイヤー）   |
| `bg-white`    | `dark:bg-gray-800`    | カード・ダイアログ・サイドバーの背景   |
| `bg-gray-100` | `dark:bg-gray-700`    | ボタン背景・入力フォーム背景           |
| `bg-blue-50`  | `dark:bg-blue-900/30` | 選択状態・ハイライト（リスト選択など） |
| `bg-blue-100` | `dark:bg-blue-900/40` | 強調ボタン背景（タスク追加など）       |

### テキスト色

| ライトモード    | ダークモード         | 用途                                         |
| --------------- | -------------------- | -------------------------------------------- |
| `text-gray-800` | `dark:text-gray-100` | メインテキスト（見出し・タスク本文）         |
| `text-gray-700` | `dark:text-gray-200` | フォームラベル・準主要テキスト               |
| `text-gray-600` | `dark:text-gray-300` | ボタンテキスト・補助説明文                   |
| `text-gray-500` | `dark:text-gray-400` | アイコンボタン・メモ・プレースホルダー       |
| `text-gray-400` | `dark:text-gray-500` | ドラッグハンドル・「読み込み中」等の淡い要素 |
| `text-blue-600` | `dark:text-blue-400` | リンク・アクション強調テキスト               |
| `text-red-600`  | `dark:text-red-400`  | 削除・危険アクション                         |

### ボーダー色

| ライトモード      | ダークモード           | 用途                             |
| ----------------- | ---------------------- | -------------------------------- |
| `border-gray-200` | `dark:border-gray-700` | 標準の区切り線・カード枠         |
| `border-gray-300` | `dark:border-gray-600` | 入力フォーム・ドロップダウン枠線 |

### ホバー色

| ライトモード        | ダークモード                | 用途                                   |
| ------------------- | --------------------------- | -------------------------------------- |
| `hover:bg-gray-50`  | `dark:hover:bg-gray-700`    | タスク行のホバー                       |
| `hover:bg-gray-100` | `dark:hover:bg-gray-700`    | アイコンボタン・メニュー項目のホバー   |
| `hover:bg-gray-200` | `dark:hover:bg-gray-600`    | 強調ホバー（ドロップダウン項目など）   |
| `hover:bg-blue-100` | `dark:hover:bg-blue-900/50` | 青系ボタンのホバー                     |
| `hover:bg-blue-200` | `dark:hover:bg-blue-900/60` | 強調青系ボタンのホバー（タスク追加等） |
| `hover:bg-red-50`   | `dark:hover:bg-red-900/30`  | 削除ボタンのホバー                     |

## 確認・入力ダイアログ運用ルール

- `globalThis.confirm` / `globalThis.prompt` / `globalThis.alert` は使用禁止
  - 代わりに共通ダイアログコンポーネント（`ConfirmDialog`、`PromptDialog`）を使う
- 確認・入力ダイアログのコールバックpropsは `onCancel` / `onConfirm` / `onSubmit` を使用し、
  汎用ダイアログの `onClose` / `onSubmit` 命名とは意図的に分離する
  - キャンセルボタンを持つことは明示的に許容される（汎用ダイアログの「キャンセルボタンは使わない」
    ルールの適用除外）
- ネストするダイアログは外側より高いz-indexを使う
  - 例: 外側が `z-50` なら内側は `z-60`（`z-[60]`）にする
- `role="dialog"` を付けた要素には `tabindex="-1"` を併記し、
  WAI-ARIAのフォーカス受け取り要件に適合させる
  - タイトルが存在する場合は見出し要素に `id` を振り `aria-labelledby` で参照し、
    タイトルが無い場合は `aria-label` を併記する

## TanStack Query 楽観的更新

楽観追加・更新するリストの`{#each}` keyには`id`を直接渡さず、
仮IDから実IDへ書き換わっても変わらない安定フィールド（`_key`等）を渡す。
Svelteはkey値の変化でコンポーネントインスタンスを再生成するため、
`id`を直接keyに渡すと、サーバー応答で実IDに置き換わったタイミングでメニュー開閉等の`$state`が初期化される。

型定義は`app/src/lib/types.ts`の`TaskListItem._key`を参照する。
リスト側の使用例は`app/src/lib/components/tasks/TaskList.svelte`の`{#each tasks as task (task._key)}`にある。

## サーバー・クライアント共有モジュール

サーバー・クライアント両方から参照する純粋関数は`$lib`直下に置き、
サーバー固有モジュール（`$lib/server/api/common.ts`等）からはre-exportのみを行う。
片側に再実装するとロジック乖離の温床になる。

代表例: タスクテキスト分割の`splitTitle` / `splitNotes`は`$lib/text-split.ts`がSSOT。
`$lib/server/api/common.ts`はre-exportのみ。

## tRPC 実装規約

### アーキテクチャ前提（変更禁止の制約）

tRPC v11 + Zod v3経路全体の前提条件。
`add-trpc-procedure`スキルおよび`trpc-zod-contract-reviewer`エージェントはこの制約に従う。

- ルーター本体は現状`app/src/lib/server/trpc.ts`単一だが、
  将来`app/src/lib/server/routers/**/*.ts`配下に分割される可能性がある。
  Zodスキーマは`app/src/lib/schemas.ts`、DBスキーマは`app/src/lib/server/schema.ts`。
  ファイルが見当たらない場合は`Glob` / `Grep`で最新の配置を確認する
- 認証必須プロシージャは`protectedProcedure`、難読化必須プロシージャは`encryptedProcedure`を使う。
  `encryptedProcedure`は`protectedProcedure`に`withEncryption`を組み合わせたもの。
  `publicProcedure`は`auth.login` / `auth.register`以外では使用しない
- 難読化ミドルウェア`withEncryption`は`getRawInput()`で暗号文を復号し、戻り値を`{ encrypted: ... }`で包む。
  ミューテーション・クエリを問わず、ユーザーデータに触るプロシージャは必ず`encryptedProcedure`を使用する
- SSEイベントは`sendEvent(ctx.userId, "<domain>:updated", ctx.tabId)`で送信する。
  イベント名の一覧は`docs/development/architecture.md`の
  `## リアルタイム同期（SSE）`節を参照する。
  mutation完了後、return前に送信する
- 日時はUTCに統一する。
  DB（TIMESTAMP）→ サーバー（Date）→ クライアント（ISO8601文字列）の変換は自動である。
  タイマー起動時刻のように「市民時刻」を扱う場合は、既存のタイマー系procedureを参考に
  `tz_offset_minutes`を入力スキーマに含める
- 数値はJSONボディで文字列として届くことがあるため、Zod側で`z.coerce.number()`もしくは
  `z.number()` + 上流での`Number()`変換のどちらか一方を明示的に採用する
- APIハンドラ（`app/src/lib/server/api/`配下）の関数引数は`Record<string, unknown>`を使わず、
  Zodスキーマから`z.infer`で得た型を引数に取る。Drizzleの型推論が正しく機能する形を維持する

### mutation の共通 builder

mutation完了後にSSEイベントを送信して`{ success: true }`を返すパターンは、
`eventMutationHandler`（共通builder）に集約する。
SSEイベント種別はbuilderのオプション引数として渡し、直接`sendEvent`を呼び出さない。

例外: 複数のSSEイベントを送信する場合、または固有の戻り値を返す必要がある場合は
builderを使わず手動で記述してよい（`lists.merge`のような複数ドメインをまたぐmutationを参照）。

### tRPC クライアントの戻り値型

tRPCの戻り値型は`AppRouter`から推論する。
`inferRouterOutputs<AppRouter>`から推論される`RouterOutputs`型を使い、
`as Promise<T>`等のキャストを書いた場合は型不整合の兆候として扱い、根本原因を調査する。

## ルーティング命名規約

ファイル・ディレクトリ名が`.`または`_`で始まる場合、SvelteKitは当該パスをprivate扱いしルート対象から除外する。
公開する必要があれば`[x+<hex>]`エスケープ構文でディレクトリ名を表現する（例: `/.well-known/foo`は`src/routes/[x+2e]well-known/foo/+server.ts`）。

## ESLintルール対応

### svelte/no-navigation-without-resolve

内部リンク用の`<a href="/...">`・`goto("/...")`は`$app/paths`の`resolve()`経由で書く。
`<!-- svelte-ignore -->`HTMLコメントは当該ルールには効かないため、`resolve()`が使えない場合は`<button type="button" onclick>`等のbutton要素へ置換する。

## rune使用時のファイル拡張子

rune（`$state`・`$effect`等）を使うユーティリティは`.svelte.ts`拡張子で作成する。
プレーンな`.ts`ではSvelteコンパイラがrune構文を解釈しない。
既存例は次のとおり。

- `$lib/dnd-reorder.svelte.ts`
- `$lib/toast-store.svelte.ts`
- `$lib/connection-recovery.svelte.ts`
- `$lib/image-attachment-utils.svelte.ts`

## D&D 並び替えユーティリティ

並び替え可能なリストには共通D&Dユーティリティ（`$lib/dnd-reorder.svelte.ts`）を利用する。
状態・操作関数の仕様は当該ファイルのexportを参照し、各コンポーネントで再実装しない。
Pointer Events APIへ統一することで、マウス・タッチ・ペンの全入力をブラウザ標準の単一APIで扱える。

## Vitest テスト環境

`vitest.config.ts`はリポジトリルート（`app/`配下ではない）に配置し、
`test.projects`で`node`と`dom`の2プロジェクトへ分割する。
DOM環境を要するテストは`dom`プロジェクトに置き、Node環境のテストへ影響を与えない構成を維持する。

テストファイルの命名規則:

- Svelteコンポーネントのテスト: `*.svelte.test.ts`（`dom`プロジェクトで実行）
- その他のDOM環境テスト: `*.dom.test.ts`（`dom`プロジェクトで実行）
- Node環境テスト: `*.test.ts`（`node`プロジェクトで実行）

### `onMount`を含むユーティリティのテスト戦略

Svelteの`onMount`はコンポーネントの初期化スコープ外では動作しない。
`onMount`を内部で呼ぶユーティリティモジュールをそのままテストすると、
Node環境では`onMount`内のコールバックが起動しない。

対策としてユーティリティを2層に分離する。

- コア処理を独立した関数として切り出す（戻り値はcleanup関数）
- `onMount`ラッパーは「コア関数の呼び出し＋戻り値をonMountのcleanupに渡す」薄い実装に留める

テストはコア関数を直接呼び出し、戻り値のcleanup関数で解除する。
これによりNode環境（`*.test.ts`）で`onMount`の制約を回避できる。

例: `app/src/lib/sse-subscribe.ts`の`setupSseSubscriptions`（コア）と`subscribeOnMount`（ラッパー）。
