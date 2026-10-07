# MCP連携

Model Context Protocol（MCP）に対応するクライアントからGLATasksを操作できる。
Streamable HTTPとOAuth認証を使用する。

## 接続

- エンドポイントは`https://<デプロイ先ホスト>/mcp`
- 認可サーバー情報は同一オリジンの`/.well-known/oauth-authorization-server`で公開する
- Dynamic Client Registrationに対応するクライアントは接続時に自動登録できる

1. クライアントへリモートMCPサーバーのURLを登録する
2. クライアントが開くブラウザーでGLATasksへログインする
3. 認可画面で接続内容を確認し、「許可」を押す
4. クライアントが取得したアクセストークンで操作する

「拒否」を押すと認可を中止する。
セッションの期限切れやサーバーの再起動後に接続できなくなった場合は、クライアントから再接続する。
操作の変更はブラウザーの画面にも反映される。

## 提供ツール

| ドメイン | 操作 |
| --- | --- |
| `lists.*` | list、create、rename、delete、archive、unarchive、clear、merge |
| `tasks.*` | list、listActive、create、update、search、reorder |
| `timers.*` | list、create、update、delete、start、pause、reset、adjust、setTime、stop、reorder |
| `calories.*` | summary、listRecords、listItems（参照のみ） |
| `users.*` | getPreferences、updatePreferences |

入力スキーマはクライアントが自動取得する。
入力と戻り値の項目名はcamelCaseを使う。
