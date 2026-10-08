# 画面状態と共有モジュール

## TanStack Query 楽観的更新

楽観追加・更新するリストの`{#each}` keyには`id`を直接渡さず、仮IDから実IDへ書き換わっても変わらない`_key`を渡す。
Svelteはkey値の変化でコンポーネントインスタンスを再生成するため、`id`直接渡しはサーバー応答で実IDに置き換わったタイミングでメニュー開閉等の`$state`を初期化する。

`_key`はAPIの応答へ含めず、クライアントキャッシュで付与する。
`app/src/lib/types.ts`は`RouterOutputs`から導く画面側の型と、この楽観的更新用の型を定義する。

## サーバー・クライアント共有モジュール

`#lib/*`は正式なworkspaceパッケージである`app/package.json`の`imports`で定義する。
共有モジュールには`#lib/<path>.<ext>`を使い、既存の`$lib/*`参照も同形式へ置換する。
静的import、動的import、Vitestのmock指定には実体の拡張子を含める（`#lib/text-split.ts`、`#lib/client/ui/toast-store.svelte.ts`、`#lib/components/ui/Toast.svelte`など）。
`$app/*`はSvelteKitが提供するモジュールであり、`#lib/*`とは別に扱う。

サーバー・クライアント両方から参照する純粋関数は`#lib`直下に置く。
サーバー固有モジュール（`#lib/server/api/common.ts`等）からはre-exportのみとし、
片側に再実装するとロジックが乖離する原因になる。
サーバー・クライアント両方参照の対象外は次の実装群とする。
クライアント側専用（`.svelte.ts`のrune状態管理等）と、サーバー側が異なる実装を持つもの（`base64.ts`の`Buffer.from`版等）。

代表例: タスクテキスト分割の`splitTitle` / `splitNotes`は`#lib/text-split.ts`で定義する。
`#lib/server/api/common.ts`はre-exportのみ。

## ルーティング命名規約

ファイル・ディレクトリ名が`.`または`_`で始まる場合、SvelteKitはこれらの名前を持つパスをprivate扱いしルート対象から除外する。
公開する必要があれば`[x+<hex>]`エスケープ構文でディレクトリ名を表現する（例: `/.well-known/foo`は`src/routes/[x+2e]well-known/foo/+server.ts`）。

## ESLintルール対応

### svelte/no-navigation-without-resolve

内部リンク用の`<a href="/...">`・`goto("/...")`は`$app/paths`の`resolve()`経由で書く。
`<!-- svelte-ignore -->`HTMLコメントは`svelte/no-navigation-without-resolve`ルールには作用しないため、`resolve()`を利用できない場合は`<button type="button" onclick>`等のbutton要素へ置換する。

## rune使用時のファイル拡張子

rune（`$state`・`$effect`等）を使うユーティリティは`.svelte.ts`拡張子で作成する。
プレーンな`.ts`ではSvelteコンパイラがrune構文を解釈しない。
runeを使うcontrollerとストアは、各ドメインの配置に合わせて`.svelte.ts`へ置く。
クライアント専用モジュールは`app/src/lib/client/`へ置き、共有の純粋関数は`app/src/lib/`へ置く。

## D&D 並び替えユーティリティ

並び替え可能なリストには共通D&Dユーティリティを利用する。
状態・操作関数の仕様は共通D&Dモジュールのexportを参照し、各コンポーネントで再実装しない。
Pointer Events APIへ統一することで、マウス・タッチ・ペンの全入力をブラウザ標準の単一APIで扱える。
