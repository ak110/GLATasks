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
- ブラウザ内蔵AIによる翻訳ページ（入力停止後に自動翻訳。Chrome 138以降のデスクトップ版とブラウザ内蔵モデルが必要）
- タスクへのファイル添付（画像はサムネイル表示・クリックで原寸ポップアップ・クリップボード貼付に対応、
  非画像は📎アイコン表示・クリックでダウンロード）
- タスクの実行中状態と完了状態の切り替え
- TODO区分による通知バッジ表示
- 定期TODOスケジュール
- SSEによる複数端末・タブ間のリアルタイム同期
- PWA対応（オフライン画面から接続回復時に自動復帰）、Chrome拡張・Android共有からのタスク追加
- 品目別カロリーの記録と直近24時間・7日間平均・28日間平均の表示（1日当たりの目標値との比較、CSVインポート・エクスポート）

## 前提条件

本アプリはセルフホスト型であり、Docker Composeが動作する環境が必要となる。
セットアップ手順やシステム要件の詳細は[はじめに](https://ak110.github.io/GLATasks/guide/getting-started)を参照。

## MCPサーバー

LLMクライアント（Claude Desktop・Claude Code・MCP Inspector等）から
GLATasksをリモート操作するためのModel Context Protocolサーバーを内蔵する。
Streamable HTTPトランスポートとOAuth 2.1認証で動作する。

接続情報:

- エンドポイント: `https://<デプロイ先ホスト>/mcp`
- 認可サーバー: 同一オリジン（`/.well-known/oauth-authorization-server` で公開）
- Dynamic Client Registration（RFC 7591）に対応するため、対応クライアントは
  上記URLを設定するだけで利用できる

利用手順:

1. MCPクライアントの設定で「リモートMCPサーバー」として `/mcp` のURLを登録する
2. クライアントが自動でOAuth認可フローを開始し、ブラウザでGLATasksのログイン画面が開く
3. GLATasksにログインし「許可」を押す
4. クライアントがアクセストークンを取得し、以降のMCPリクエストで利用する

提供ツール（24件）:

- `lists.*`: list / create / rename / delete / archive / unarchive / clear / merge
- `tasks.*`: list / listActive / create / update / search / reorder
- `timers.*`: list / create / update / delete / start / pause / reset / adjust / setTime / stop / reorder
- `users.*`: getPreferences / updatePreferences

各ツールの入力スキーマはMCPクライアント側で自動取得できる。

## ドキュメント

- <https://ak110.github.io/GLATasks/guide/getting-started> — はじめに（セルフホスト手順）
- [docs/development/development.md](docs/development/development.md) — 開発者向け情報
