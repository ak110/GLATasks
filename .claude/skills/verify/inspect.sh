#!/usr/bin/env bash
set -euo pipefail

phase=$1
shift
compose=("$@")
project="${PWD##*/}-e2e"
fail() {
  printf 'inspect.sh %s: %s\n次の操作: %s\n' "$phase" "$1" "$2" >&2
  exit 1
}
rerun="原因を直してから、新しい証拠ディレクトリ名で run.sh を再実行してください。"

if [[ "$phase" == cleanup ]]; then
  label="label=com.docker.compose.project=$project"
  containers=$(docker ps -aq --filter "$label")
  networks=$(docker network ls -q --filter "$label")
  volumes=$(docker volume ls -q --filter "$label")
  printf '残留コンテナー: %s\n残留ネットワーク: %s\n残留ボリューム: %s\n' \
    "${containers:-なし}" "${networks:-なし}" "${volumes:-なし}"
  [[ -z "$containers$networks$volumes" ]] ||
    fail "Composeプロジェクト $project の資源が残っています。" \
      "新しい証拠ディレクトリ名で run.sh を再実行すると、make test-e2e が排他の中で開始時に回収します。開発プロジェクトは止めないでください。"
  [[ ! -e "$PWD/.cache/e2e-data" ]] ||
    fail "専用データディレクトリ $PWD/.cache/e2e-data が残っています。" \
      "新しい証拠ディレクトリ名で run.sh を再実行すると、make test-e2e が排他の中で削除してから作り直します。"
  exit
fi

# コマンド置換の中の fail はサブシェルを終えるだけだが、set -e により代入の失敗で本体も止まる。
service_id() {
  "${compose[@]}" ps -q "$1" ||
    fail "docker compose ps -q $1 が失敗しました（直前の docker compose の出力を参照）。" \
      "dockerが稼働しているかと、Makefile の E2E_COMPOSE が読む設定を確認してください。$rerun"
}
app=$(service_id app)
db=$(service_id db)
web=$(service_id web)
[[ -n "$app" && -n "$db" && -n "$web" ]] ||
  fail "実行中のサービスが揃っていません（app=${app:-なし} db=${db:-なし} web=${web:-なし}）。" \
    "run.log の起動ログと、保存されていれば failure.log を確認してください。$rerun"

actual=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$app")
[[ "$actual" == "$project" ]] ||
  fail "appのComposeプロジェクトが $actual で、試験用の $project ではありません。" \
    "Makefile の E2E_PROJECT と E2E_COMPOSE を確認してください。$rerun"
actual=$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$web")
[[ "$actual" == 0 ]] ||
  fail "webに公開ポートが$actual件あり、稼働中の開発環境と衝突するおそれがあります。" \
    "compose.ci.yaml の web の ports: !reset [] を確認してください。$rerun"
docker inspect --format '{{range $path, $opts := .HostConfig.Tmpfs}}{{println $path}}{{end}}' "$db" |
  grep -Fqx /var/lib/mysql ||
  fail "dbの /var/lib/mysql がtmpfsではなく、開発用DBと分離されていません。" \
    "compose.e2e.yaml の db の tmpfs を確認してください。$rerun"
mounts=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination .Source}}{{println .Source}}{{end}}{{end}}' "$app")
for path in "$PWD/.cache/e2e-data" "$PWD"; do
  grep -Fqx "$path" <<<"$mounts" ||
    fail "appに $path が同じパスでマウントされていません（同じパスのマウント: ${mounts//$'\n'/ }）。" \
      "Makefile の E2E_DATA_DIR と compose.yaml の app の volumes を確認してください。$rerun"
done
actual=$(git rev-parse HEAD)
[[ "$actual" == "$VERIFY_COMMIT" && -z "$(git status --porcelain)" ]] ||
  fail "実行中に作業ツリーが変わりました（HEAD $actual、対象 $VERIFY_COMMIT）。" \
    "検証の実行中はチェックアウトとソースの編集をしないでください。$rerun"
mounted_commit=$("${compose[@]}" exec -T app git rev-parse HEAD)
[[ "$mounted_commit" == "$VERIFY_COMMIT" ]] ||
  fail "app内のcommitが $mounted_commit で、対象 $VERIFY_COMMIT と一致しません。" \
    "appが主作業ツリーをマウントしているか確認してください。$rerun"
printf '%s %s app=%s db=%s web=%s\n' "$phase" "$mounted_commit" "$app" "$db" "$web"

"${compose[@]}" exec -T app node --input-type=module --eval '
  const response = await fetch("http://localhost:3000/healthcheck");
  console.log("GET /healthcheck:", response.status);
  if (!response.ok) process.exitCode = 1;
' || fail "app の /healthcheck が成功を返しませんでした。" \
  "run.log のコンテナーログと、保存されていれば failure.log の app の起動ログを確認してください。$rerun"
counts=$("${compose[@]}" exec -T db sh -ec '
  MYSQL_PWD="$MARIADB_PASSWORD" mariadb --batch --skip-column-names -u "$MARIADB_USER" "$MARIADB_DATABASE" \
    -e "SELECT (SELECT COUNT(*) FROM user), (SELECT COUNT(*) FROM task), (SELECT COUNT(*) FROM timer)"
')
printf 'DB users/tasks/timers: %s\n' "$counts"
if [[ "$phase" == before ]]; then
  [[ "$counts" == $'0\t0\t0' ]] ||
    fail "操作前のDBが空ではありません（users/tasks/timers: $counts）。" \
      "compose.e2e.yaml の db の tmpfs と、Makefile の test-e2e-isolated の開始時の down --volumes を確認してください。$rerun"
else
  "${compose[@]}" logs --no-color --timestamps app web db
fi
