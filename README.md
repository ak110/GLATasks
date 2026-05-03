# GLATasks

[![CI][ci-badge]][ci-url]
[![Deploy][deploy-badge]][deploy-url]

[ci-badge]: https://github.com/ak110/GLATasks/actions/workflows/ci.yaml/badge.svg
[ci-url]: https://github.com/ak110/GLATasks/actions/workflows/ci.yaml
[deploy-badge]: https://github.com/ak110/GLATasks/actions/workflows/deploy.yaml/badge.svg
[deploy-url]: https://github.com/ak110/GLATasks/actions/workflows/deploy.yaml

タスク管理・カウントダウンタイマー・アラームを統合したWeb/PWAアプリ。

## 特徴

- 複数リストでのタスク管理とドラッグ&ドロップによるリスト間移動
- タスクに紐付くカウントダウンタイマー
- SSEによる複数端末・タブ間のリアルタイム同期
- PWA対応、Chrome拡張・Android共有からのタスク追加

## 前提条件

本アプリはセルフホスト型であり、Docker Composeが動作する環境が必要となる。
セットアップ手順やシステム要件の詳細は[はじめに](https://ak110.github.io/GLATasks/guide/getting-started)を参照。

## ドキュメント

- <https://ak110.github.io/GLATasks/guide/getting-started> — はじめに（セルフホスト手順）
- [docs/development/development.md](docs/development/development.md) — 開発者向け情報
