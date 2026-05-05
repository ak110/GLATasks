# はじめに

タスク管理とカウントダウンタイマーを統合したWebアプリ。自前のサーバーにデプロイして利用する。

## 主な機能

- 複数リストでのタスク管理とドラッグ&ドロップによるリスト間移動
- タスクに紐付くカウントダウンタイマー（カウントダウン・アラームの2モード）
- SSEによる複数端末・タブ間のリアルタイム同期
- PWA対応
- [Chrome拡張機能](/guide/chrome-extension)でWebページをワンクリック保存
- [Android共有メニュー](/guide/android-share)から直接タスク追加

## デプロイ

### 前提条件

- Docker / Docker Composeがインストールされたサーバー
- HTTPS環境（リバースプロキシ等）

### 手順

1. リポジトリをクローン

   ```bash
   git clone https://github.com/ak110/GLATasks.git
   cd GLATasks
   ```

2. `.env`を作成（`.env-example`を参考に）

   ```bash
   cp .env-example .env
   ```

   `DATA_DIR`にデータ保存先ディレクトリのパスを設定する（`COMPOSE_PROFILE`は`production`を推奨）

3. 起動

   ```bash
   make deploy
   ```

4. HTTPSでアクセスできるようリバースプロキシを設定
  （設定例は[アーキテクチャの外部リバースプロキシ設定](/development/architecture#外部リバースプロキシ設定)を参照）

5. ブラウザでアクセスし、ユーザー登録してログイン

### 停止

```bash
make stop
```

### 更新

最新版に更新する場合:

```bash
git pull
make deploy
```
