#!/usr/bin/env bash
set -euo pipefail

phase=$1
shift
compose=("$@")
if [[ "$phase" == cleanup ]]; then
  label="label=com.docker.compose.project=${PWD##*/}-e2e"
  containers=$(docker ps -aq --filter "$label")
  networks=$(docker network ls -q --filter "$label")
  volumes=$(docker volume ls -q --filter "$label")
  printf '残留コンテナー: %s\n残留ネットワーク: %s\n残留ボリューム: %s\n' \
    "${containers:-なし}" "${networks:-なし}" "${volumes:-なし}"
  [[ -z "$containers$networks$volumes" && ! -e "$PWD/.cache/e2e-data" ]]
  exit
fi
app=$("${compose[@]}" ps -q app)
db=$("${compose[@]}" ps -q db)
web=$("${compose[@]}" ps -q web)
test -n "$app" && test -n "$db" && test -n "$web"

# 実行中サービスを調べる。env や全 inspect のダンプは資格情報を含む。
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$app")" = "${PWD##*/}-e2e"
test "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$web")" = 0
test "$(docker inspect --format '{{range $path, $opts := .HostConfig.Tmpfs}}{{println $path}}{{end}}' "$db" | grep -Fx /var/lib/mysql)" = /var/lib/mysql
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination .Source}}{{println .Source}}{{end}}{{end}}' "$app" | grep -Fx "$PWD/.cache/e2e-data")" = "$PWD/.cache/e2e-data"
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination .Source}}{{println .Source}}{{end}}{{end}}' "$app" | grep -Fx "$PWD")" = "$PWD"
test "$(git rev-parse HEAD)" = "$VERIFY_COMMIT"
test -z "$(git status --porcelain)"
mounted_commit=$("${compose[@]}" exec -T app git rev-parse HEAD)
test "$mounted_commit" = "$VERIFY_COMMIT"
printf '%s %s app=%s db=%s web=%s\n' "$phase" "$mounted_commit" "$app" "$db" "$web"

"${compose[@]}" exec -T app node --input-type=module --eval '
  const response = await fetch("http://localhost:3000/healthcheck");
  console.log("GET /healthcheck:", response.status);
  if (!response.ok) process.exitCode = 1;
'
counts=$("${compose[@]}" exec -T db sh -ec '
  MYSQL_PWD="$MARIADB_PASSWORD" mariadb --batch --skip-column-names -u "$MARIADB_USER" "$MARIADB_DATABASE" \
    -e "SELECT (SELECT COUNT(*) FROM user), (SELECT COUNT(*) FROM task), (SELECT COUNT(*) FROM timer)"
')
printf 'DB users/tasks/timers: %s\n' "$counts"
if [[ "$phase" == before ]]; then
  test "$counts" = $'0\t0\t0'
else
  "${compose[@]}" logs --no-color --timestamps app web db
fi
