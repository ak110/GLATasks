# アーキテクチャ

コードから直接読めない設計判断と外部の制約だけを記す。
構成とスキーマは`compose.yaml`と`app/src/lib/server/schema.ts`を参照する。

## サーバーと画面の責務

`app/src/lib/server/trpc.ts`、MCPのツール、共有フォームは入力と認証を扱い、ドメインのoperationsへ処理を渡す。
operationsはapi層のDB操作、戻り値、更新通知をまとめる。
スケジューラーによる変更もoperationsを通して通知する。
これによりtRPC、MCP、フォーム、定期処理の通知が一致する。
api層はDB操作と所有権の確認を担当する。
複数の書き込みで成立する操作は、同じトランザクション内で実行する。

APIの入力と戻り値はcamelCaseを使う。
DB列名とCSV列名は保存形式として個別に扱う。
値だけで判断できる制約は入力スキーマ（`schemas.ts`）で検証し、所有権、関連行の存在、保存済み値と組み合わせる制約はapi層で検証する。

### 再評価をまたいで保持するサーバー状態

開発サーバーはコード更新のたびに同じNode.jsプロセスでサーバーモジュールを再評価する。
接続や発行済みの値をモジュール変数に置くと、再評価前に始まった接続や要求が旧世代の表に残り、再評価後の処理から到達できなくなる。
周期タイマーも評価のたびに増える。
このため、世代を越えて保持する状態と周期タイマーは`app/src/lib/server/process-state.ts`の共通の所有機構で取得し、業務処理は各モジュールの最新の評価に置く。
新しい常駐状態や周期処理を加える場合も同じ機構で取得する。

## リアルタイム同期（SSE）

mutation完了時にSSEで他タブ・他端末へ通知する。

- エンドポイントは`GET /api/events`（Cookie認証）で、利用者データは含めずイベント種別と送出元のタブIDだけを送る
  （`lists:updated` / `tasks:updated` / `timers:updated` / `schedules:updated` /
  `users:preferences:updated` / `calories:updated` / `reset`）
- クライアントはイベント受信時にTanStack Queryの`invalidateQueries`で該当データを再取得する
- nginxは`/api/events`に`proxy_buffering off`を設定する。SSEがバッファされると配信が遅れるためである
- ブラウザーのネットワークタイマー減速などで接続がゾンビ化するため、`EventSource`の自動再接続だけに頼らず、受信途絶の監視と強制再接続、ポーリングによる再取得を併用する
- heartbeatは名前付きイベント（`event: heartbeat`）で送る。
  コメント行形式（`:\n\n`）では`EventSource`がイベントとして通知せず、受信途絶の監視が最終受信時刻を更新できない
- heartbeatのサーバー時刻ではタイマーの時刻オフセットを更新しない。
  SSEは片道通信でRTTを測れず、tRPC応答のRTT/2補正で得た値が片道遅延の分だけ劣化するためである

### 接続の不健全検出

SSEの受信途絶の監視とは独立に、`/healthcheck`への能動的な問い合わせで判定する（`app/src/lib/client/sse/connectivity-check.js`）。

- キャプティブポータルはステータス200で認証用HTMLを返すことがあるため、ステータスに加えて`Content-Type`と本文の`status`値まで確かめる
- `/healthcheck`はリダイレクトに従わずに取得する。認証画面は別オリジンやhttpへリダイレクトすることが多く、従うとCORSや混在コンテンツの拒否で通信エラーになる
- 通信断の間は再読み込みしない。画面の取得に失敗してService Workerのオフライン画面へ移り、表示中の画面を失うためである
  （AndroidのPWAで別アプリや画面オフから戻った直後など）。
  再読み込みと完全な画面遷移はESLint（`eslint.config.js`）で検出し、通信断でも実行してよい理由を抑止コメントに書いた箇所だけを許可する
- Service Workerは`/healthcheck`へのナビゲーションを横取りしない。
  通信が遮断された状態で別ウィンドウや非表示のiframeをオフライン画面へ置き換えると、ブラウザーや認証画面の案内が表示されないためである
- 別ウィンドウで認証画面を開く操作は、ポップアップの阻止を避けるため利用者のクリックでだけ行う
- オフライン画面は追加のスクリプトを取得できずキャッシュ対象を増やせないため、判定モジュールをViteの`?raw`でインライン展開する

## 運用監視

`GET /healthcheck`はHTTP応答の生存確認とブラウザーの接続回復に使う。
DB接続と定期処理の状態を監視する場合は`GET /healthcheck/ready`を使い、不健全ならHTTP 503と状態ごとの確認先（`next_action`）を返す。
DBが不健全な場合はDBの稼働状況を、定期処理が不健全な場合はアプリの`[scheduler]`ログを確認する。
運用監視による障害検知とコンテナーの生存確認を分け、DB障害だけでアプリの再起動を繰り返さない。

## 定期処理スケジューラー

- 発火機構は単一プロセスを前提とし、複数プロセスワーカー間の発火競合は考慮しない
- fill-forwardは1回の走査で30件を上限とし、上限の範囲内で重複発火を許容する。上限を超えた発火予定は生成しない
- `rrule`は`tzid`を指定すると、プロセスの時刻帯の壁時計の時刻をUTCの成分に持つ日時で境界を受け取り結果を返す。
  本番イメージは`TZ=Asia/Tokyo`、開発用のappと試験のコンテナーはUTCで動くため、`make test-db`はnode projectを両方の時刻帯で実行する

## 認証設計

### CSRF 対策

Chrome拡張のポップアップ内iframeでログイン状態を使うため、セッションCookieは`SameSite=None`・`Secure`である。
このCookieは他サイト経由の通信にも付くため、補償として次の不変条件をCookieが届く全ルートに対して持つ。

- Cookie認証の更新要求は同一オリジンからだけ受け付ける。
  `hooks.server.ts`の`handle`が、パスを問わず`Sec-Fetch-Site`が`same-site`・`cross-site`の要求を403にする
- 除外はセッションCookieを読まないルートだけとし、`auth-routes.ts`の`COOKIELESS_MUTATION_PATHS`に置く
- 画面は許可した埋め込み元以外から埋め込めない。
  Chrome拡張が開く画面だけは`frame-ancestors 'self' chrome-extension:`とし、`X-Frame-Options`を付けない

SvelteKitが組み込みで行うOriginヘッダーの判定は、リバースプロキシ経由の利用でブラウザーのOriginとアプリの認識するオリジンが一致しないため無効にしている（`vite.config.ts`の`trustedOrigins: ["*"]`）。
`Sec-Fetch-Site`はブラウザーが自分の見ているオリジン同士で判定するため、プロキシ経由でも同じ画面からの送信は`same-origin`になる。
E2Eの`app/tests/csrf-framing.test.ts`が全ルートについて不変条件を確かめ、フレームワークの版更新や`handle`の構成変更で保護が外れた場合も検出する。

### セッションCookie名

未指定時は`__Host-gla-session`とする。
本番（aws.tqzh.tk）はサーバー上の`.env`の`SESSION_COOKIE_NAME`で従来の名前`gla-session`を指定して運用する（端末ごとの再ログインと移行処理を避けるため）。

## 通信の難読化

HTTPSを通信の保護に使い、AES-GCMはtRPCの本文を追加で難読化する。
対象はmutationの要求本文と、`encryptedProcedure`の全手続きの応答である。
クエリーの入力はGETのURLに含まれるため、検索語などは平文となる。
クライアント側の暗号化に失敗した場合は平文の入力で送信し、サーバーもその入力を受け付ける。
アクセス制御はセッションと所有権の確認が担当する。

## tRPCミドルウェア設計

tRPC v11の`next()`は下流の例外を再送出せず`{ok: false, error}`で返すため、ミドルウェアでは`try/catch`ではなく`await next()`の戻り値の`result.ok`で判定する。

## DB 設計方針

- MariaDB（12.3系）は`innodb_snapshot_isolation=ON`で、既定の分離レベルはREPEATABLE READである。
  transactionの最初の読み取りで作られた読み取りビューの後に、別の接続が同じ行を更新してcommitすると、
  その行の削除・更新は`ER_CHECKREAD`（1020）で失敗する。
  読み取りビューの一貫性を要しない読み取り後の削除・更新はREAD COMMITTEDにする
- 日時カラムはTIMESTAMP型でUTC保存し、APIではISO8601文字列で返す
- MariaDBは`ON UPDATE CASCADE`の外部キー列をCHECK制約に使えないため、カロリー記録の品目IDと一時項目名のどちらか一方だけを持つ不変条件は書き込み側で守る
- 親列は`ON DELETE RESTRICT`・`ON UPDATE RESTRICT`の外部キーで関連を保ち、親を削除する処理は子を先に削除する。
  削除対象が無い場合や他のユーザーの行の場合は変更せず成功する

### バイナリ保存と `max_allowed_packet`

drizzle-orm mysql2ドライバーの`db.transaction`は内部でテキストプロトコルを使い、
`Buffer`パラメーターを16進数リテラルへ変換して送るため、実バイト数の約2倍のSQLテキストがサーバーへ送られる。
`db/my.cnf`の`max_allowed_packet`は想定するバイナリサイズの3倍以上に設定する（添付ファイル上限10 MiBに対し現行値は`64M`）。
新しいBLOB系カラムを追加する場合は同基準で再点検する。
