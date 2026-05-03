# Save To GLATasks Chrome拡張機能

現在のページのタイトルとURLをGLATasksに保存するためのChrome拡張機能。

エンドユーザー向けのインストール手順・使い方は
[docs/guide/chrome-extension.md](../docs/guide/chrome-extension.md)を参照。
本READMEは拡張機能を改修・配布するための開発者向け情報を扱う。

## 重要な設定

接続先ドメインは`background.js`・`popup.js`内に`https://glatasks.tqzh.tk`を直接記述している。
別ドメインへ向ける場合は両ファイルの該当箇所を直接編集する。

`manifest.json`に宣言している権限:

- `activeTab` — 現在のタブの情報を取得
- `contextMenus` — 右クリックメニューの追加
- `tabs` — 新しいタブの作成
