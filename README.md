# GLATasks

タスク管理・カウントダウンタイマー・アラームを統合したWeb/PWAアプリ。

[![CI][ci-badge]][ci-url]
[![Deploy][deploy-badge]][deploy-url]

[ci-badge]: https://github.com/ak110/GLATasks/actions/workflows/ci.yaml/badge.svg
[ci-url]: https://github.com/ak110/GLATasks/actions/workflows/ci.yaml
[deploy-badge]: https://github.com/ak110/GLATasks/actions/workflows/deploy.yaml/badge.svg
[deploy-url]: https://github.com/ak110/GLATasks/actions/workflows/deploy.yaml

## 特徴

- 複数リストでのタスク管理とドラッグ&ドロップによる並び替え（リスト間移動はリスト一覧と並べて表示できる画面幅のみ）
- カウントダウン・アラームの2モードのタイマー（一時タイマーは追加直後に開始）
- ブラウザ内蔵AIによる翻訳ページ（入力停止後に自動翻訳。Chrome 138以降のデスクトップ版とブラウザ内蔵モデルが必要）
- タスクへのファイル添付（画像はサムネイル表示・クリックで原寸ポップアップ・クリップボード貼付に対応、
  非画像は📎アイコン表示・クリックでダウンロード）
- タスクの実行中状態と完了状態の切り替え
- TODO区分による通知バッジ表示
- 定期TODOスケジュール
- SSEによる複数端末・タブ間のリアルタイム同期
- PWA対応（オフライン画面から接続回復時に自動復帰）、Chrome拡張・Android共有からのタスク追加
- MCPクライアントからのリモート操作（OAuth認証）
- 品目別カロリーの記録（品目に登録しない一時項目も可）と1日当たりペース・7日間平均・28日間平均の表示（1日当たりの目標値との比較、目標内に収めた日の達成状況と今日の摂取可能量、毎日の自動記録、期間を指定した一括記録・一括削除、CSVインポート・エクスポート）

## 前提条件

本アプリはセルフホスト型であり、Docker Composeが動作する環境が必要となる。
セットアップ手順やシステム要件の詳細は[はじめに](https://ak110.github.io/GLATasks/guide/getting-started)を参照。

## インストール

```bash
git clone https://github.com/ak110/GLATasks.git
cd GLATasks
cp .env-example .env
```

## 設定

`.env`の`DATA_DIR`をデータ保存先の絶対パスへ設定し、`COMPOSE_PROFILE`に`production`を指定する。
HTTPS公開の手順は[はじめに](https://ak110.github.io/GLATasks/guide/getting-started)を参照。

## 使い方

```bash
make deploy
```

公開したURLをブラウザーで開き、ユーザー登録してログインする。
機能ごとの操作は次のガイドを参照。

- [タスクとリスト](docs/guide/tasks.md)
- [タイマーとアラーム](docs/guide/timers.md)
- [定期TODO](docs/guide/schedules.md)
- [翻訳](docs/guide/translate.md)
- [カロリー](docs/guide/calories.md)
- [MCP連携](docs/guide/mcp.md)

## ドキュメント

- [はじめに](https://ak110.github.io/GLATasks/guide/getting-started)（セルフホスト手順）
- [開発手順](docs/development/development.md)
- [アーキテクチャ](docs/development/architecture.md)
