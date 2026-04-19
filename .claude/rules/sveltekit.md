---
paths:
  - "**/*.svelte"
  - "**/*.ts"
  - "**/*.css"
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
- タグバッジの色は`app/src/lib/tag-palette.ts`に集約し、Tailwindクラスを直接ハードコードしない。
  色覚バリアフリー配色（Okabe-Ito系）を淡色化した8色パレットから`getTagColorClass()`経由で取得する

## ダークモードの色マッピング

Tailwind CSS v4の `@custom-variant dark` を使用。`<html>` に `.dark` クラスを付与して切り替え。

### 設計原則

- 背景色の階層構造: ダークモードではgray-950（ヘッダー）→ gray-900（ページ全体）→
  gray-800（カード・コンテンツ領域）→ gray-700（ボタン・入力フォーム）の4段階で奥行きを表現する。
  ライトモードのgray-800（ヘッダー）→ gray-50（ページ全体）→ white（カード）→ gray-100（ボタン）と同じ階層関係を維持する
- テキスト・ボーダーの明暗反転: grayスケールを概ね反転させるが、単純な数値反転ではない。
  背景色とのコントラスト比（WCAG AA基準4.5:1を目安）を維持するように調整している
- アクセントカラーの透明度制御: 青系（blue）や赤系（red）のアクセントカラーは、
  ダークモードでは濃い色（900）に透明度を掛けて使用する。
  透明度で強調度を段階的に制御する（/30: 選択状態 → /40: ボタン背景 → /50〜/60: ホバー状態）

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
