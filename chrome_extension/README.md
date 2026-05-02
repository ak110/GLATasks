# Save To GLATasks Chrome拡張機能

現在のページのタイトルとURLをGLATasksに保存するためのChrome拡張機能。

エンドユーザー向けのインストール手順・使い方は
[docs/guide/chrome-extension.md](../docs/guide/chrome-extension.md)を参照。
本READMEは拡張機能を改修・配布するための開発者向け情報を扱う。

## テンプレート構成

`templates/`配下のテンプレートに接続先ドメインを差し込んで`dist/`へ生成する構成を採用している。
固定ドメインでビルドすることで、利用環境ごとに別ビルドを配布できるようにしている。

生成物のURLパターン:

```text
https://<GLATASKS_DOMAIN>/share/ingest?title={title}&url={url}
```

`GLATASKS_DOMAIN`はビルド時に指定する。既定値は`https://glatasks.tqzh.tk`。

## ビルド手順

`chrome_extension/templates/`配下から拡張機能ファイルを生成する。
生成物は`chrome_extension/dist/`に出力される（git管理外）。

```sh
# デフォルトドメインでビルドする
make build-extension

# 別ドメインを指定してビルドする
make build-extension GLATASKS_DOMAIN=https://example.com
```

## ファイル構成

- `templates/manifest.json` — 拡張機能の設定ファイル（テンプレート）
- `templates/background.js` — 右クリックメニューを管理するサービスワーカー（テンプレート）
- `templates/popup.js` — ポップアップの動作を制御するスクリプト（テンプレート）
- `popup.html` — 拡張機能アイコンクリック時のポップアップUI
- `dist/` — ビルド生成物（`make build-extension`で出力。git管理外）

## 動作環境

- Chrome Manifest V3対応
- 必要な権限:
  - `activeTab` — 現在のタブの情報を取得
  - `contextMenus` — 右クリックメニューの追加
  - `tabs` — 新しいタブの作成
