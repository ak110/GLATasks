# アーキテクチャ

## スタック

| レイヤー         | 技術                  | 役割                                    |
| ---------------- | --------------------- | --------------------------------------- |
| アプリケーション | SvelteKit             | UI・ルーティング・SSR・API・DB アクセス |
| API              | tRPC v11              | 型安全な RPC（難読化ミドルウェア付き）  |
| バリデーション   | Zod                   | スキーマバリデーション                  |
| データ取得       | TanStack Svelte Query | クライアント側キャッシュ・状態管理      |
| ORM              | Drizzle ORM           | DB アクセス（型安全）                   |
| DB               | MariaDB               | データ永続化                            |
| リバースプロキシ | nginx                 | HTTPS 終端                              |
| CSS              | Tailwind CSS          | スタイリング                            |
| 難読化           | Web Crypto API        | ブラウザ ↔ SvelteKit 間 AES-GCM         |
| 認証             | JWT/HS256 (`jose`)    | Cookie セッション管理                   |

## アーキテクチャ図（Docker Compose 内部構成）

```mermaid
flowchart TB
    Browser["Chrome拡張 / ブラウザ"]
    Nginx["nginx（ポート 38180:443）"]
    SK["SvelteKit サーバー"]
    DB["MariaDB"]

    Browser -- "HTTPS + AES-GCM 難読化" --> Nginx
    Nginx -- "全リクエスト" --> SK
    SK -- "Drizzle ORM" --> DB
```

## 外部リバースプロキシ設定

Docker Composeの前段にLet's Encrypt証明書でHTTPS終端する外部nginxを配置する場合の設定。

```mermaid
flowchart LR
    Browser["ブラウザ"]
    ExtNginx["外部 nginx\n（Let's Encrypt）"]
    IntNginx["内部 nginx\n（自己署名 HTTPS, :38180）"]
    SK["SvelteKit"]

    Browser -- "HTTPS" --> ExtNginx
    ExtNginx -- "HTTPS（proxy_ssl_*）" --> IntNginx
    IntNginx --> SK
```

設定上の制約:

- `/api/events` と `/` の両方に `proxy_ssl_certificate` / `proxy_ssl_certificate_key` が必要（内部nginxが自己署名HTTPSのため）
- SSE用の `/api/events` には `proxy_buffering off` + `proxy_read_timeout 86400` +
  `proxy_http_version 1.1` + `Connection ''` が必須
- `X-Accel-Buffering: no` ヘッダーでnginxのレスポンスバッファも無効化する

設定例:

```nginx
upstream app_backend {
    server 127.0.0.1:38180;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # SSE エンドポイント（バッファリング無効化が必要）
    location /api/events {
        proxy_pass https://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_ssl_certificate     /path/to/glatasks/web/ssl/server.crt;
        proxy_ssl_certificate_key /path/to/glatasks/web/ssl/server.key;
        proxy_ssl_protocols TLSv1.3;
        proxy_redirect off;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
        add_header X-Accel-Buffering no;
    }

    # 通常リクエスト
    location / {
        proxy_pass https://app_backend;
        proxy_ssl_certificate     /path/to/glatasks/web/ssl/server.crt;
        proxy_ssl_certificate_key /path/to/glatasks/web/ssl/server.key;
        proxy_ssl_protocols TLSv1.3;
        proxy_redirect off;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

## リアルタイム同期（SSE）

mutation完了時にSSE (Server-Sent Events) で他タブ・他端末へ即座に通知する。

```mermaid
sequenceDiagram
    participant A as ブラウザ A
    participant S as SvelteKit
    participant B as ブラウザ B

    A->>S: tRPC mutation（タスク更新）
    S->>S: DB 更新
    S-->>A: SSE: tasks:updated
    S-->>B: SSE: tasks:updated
    A->>S: invalidateQueries → 再取得
    B->>S: invalidateQueries → 再取得
```

- エンドポイント: `GET /api/events`（Cookie認証）
- データは含めずイベント種別のみ送信（`lists:updated` / `tasks:updated` / `timers:updated`）
- クライアントはイベント受信時にTanStack Queryの `invalidateQueries` で該当データを再取得
- 再接続はブラウザの `EventSource` 自動再接続に委ねる
- nginx: `/api/events` に `proxy_buffering off` を設定（SSEがバッファされると配信遅延が発生するため）

## タイマー時刻同期

タイマーの残り時間をブラウザで正確に計算するため、サーバーとの時刻差（オフセット）を管理する。

### オフセット計算

tRPCレスポンスでRTT/2補正付きの精密なオフセットを計算する:

```text
offset = serverTime - (requestStart + requestEnd) / 2
```

### オフセット更新の流れ

```text
SSE connected (初回接続)  ──→ setServerOffset(暫定値)
tRPC response (1分間隔)   ──→ setServerOffset(RTT/2補正値)
tRPC response (SSEイベント後) → setServerOffset(RTT/2補正値)
SSE heartbeat (30秒ごと)  ──→ 接続維持のみ（オフセット更新なし）
```

SSEは片道通信のためRTTを測定できない。heartbeatのサーバー時刻でオフセットを上書きすると、
tRPCのRTT/2補正で得た精密値が片道遅延分だけズレた値に劣化するため、heartbeatは接続維持のみに使用する。

## 認証設計

CookieベースのJWT/HS256セッション。実装詳細は `hooks.server.ts` / `session.ts` を参照。

### CSRF 対策

多層防御を採用:

- SvelteKit組み込みの `checkOrigin` でform actionを保護
- `hooks.server.ts` で `Sec-Fetch-Site: cross-site` のミューテーションを `/api/*` でブロック（tRPCエンドポイントの保護）
- ログアウトをPOSTに限定（GETでのCSRFを防止）

### Chrome 拡張対応

Chrome拡張のポップアップ内iframeからのアクセスを許可する必要があるため、
Cookieに `sameSite: "none"` + `secure: true` を設定。
この設定はCSRF対策を弱めるため、上記の `Sec-Fetch-Site` チェックで補完している。

## DB 設計方針

テーブル定義は `app/src/lib/server/schema.ts` を参照。以下はコードから読み取りにくい設計判断:

- 日時カラムはすべてTIMESTAMP型でUTC保存。タイムゾーン変換はクライアント側で行い、
  サーバー・DB層ではタイムゾーンを意識しない設計
- 並び順は `sort_order` INTカラム（昇順、1000刻み）。刻み幅を大きくすることで、挿入時に周囲のレコードを更新せずに済む
- タイマーの残り時間はサーバー側で計算せず、`remaining_seconds` と `started_at` をクライアントに渡して
  ブラウザ側で計算する。これにより秒単位のリアルタイム表示をポーリングなしで実現する
- タイマーの `ephemeral` カラムは1回限りの使い切りタイマーを識別するフラグ。
  作成時のみ設定でき、`adjust` / `reset` / `setTime` などの操作で変更されない。
  クライアント側では満了到達時に削除ボタンを強調し、確認ダイアログを省略して削除できる体験に用いる
