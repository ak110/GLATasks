#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$script_dir")"
test_root="$(mktemp -d)"
source_container=""
restore_container=""

cleanup() {
    status=$?
    trap - EXIT
    for container in "$source_container" "$restore_container"; do
        if [[ -n "$container" ]]; then
            docker rm -f "$container" || status=1
        fi
    done
    rm -rf -- "$test_root" || status=1
    exit "$status"
}
trap cleanup EXIT

start_database() {
    docker run --detach --rm --init --network none \
        --tmpfs /var/lib/mysql:rw,size=512m \
        --env MARIADB_ROOT_PASSWORD=glatasks \
        --env MARIADB_DATABASE=glatasks \
        --env MARIADB_USER=glatasks \
        --env MARIADB_PASSWORD=glatasks \
        mariadb:lts
}

wait_for_database() {
    local container="$1"
    local attempt
    for ((attempt = 0; attempt < 60; attempt++)); do
        if docker exec -e MYSQL_PWD=glatasks "$container" \
            mariadb -uglatasks glatasks --batch --skip-column-names -e 'SELECT 1' \
            > "$test_root/mariadb-wait.log" 2>&1; then
            return
        fi
        sleep 1
    done
    cat "$test_root/mariadb-wait.log" >&2
    docker logs "$container" >&2
    echo "隔離DBが起動しませんでした" >&2
    return 1
}

backup() {
    make -C "$repo_root" backup \
        "DATA_DIR=$data_dir" "BACKUP_DB_CONTAINER=$source_container" \
        BACKUP_KEEP=2 "$@"
}

restore_dump() {
    docker exec -i -e MYSQL_PWD=glatasks "$restore_container" \
        mariadb -uglatasks --default-character-set=utf8mb4 glatasks < "$1"
}

verify_restored() {
    local actual
    actual="$(docker exec -e MYSQL_PWD=glatasks "$restore_container" \
        mariadb -uglatasks --default-character-set=utf8mb4 \
        --batch --skip-column-names glatasks \
        -e 'SELECT u.user, l.title, t.text, HEX(a.data) FROM `user` AS u JOIN `list` AS l ON l.user_id = u.id JOIN `task` AS t ON t.list_id = l.id JOIN `attachment` AS a ON a.task_id = t.id')"
    [[ "$actual" == $'利用者\t買い物\t牛乳を買う\t00010200FF' ]]
}

echo "隔離したダンプ元DBと復元先DBを起動します"
source_container="$(start_database)"
restore_container="$(start_database)"
wait_for_database "$source_container"
wait_for_database "$restore_container"

docker exec -i -e MYSQL_PWD=glatasks "$source_container" \
    mariadb -uglatasks --default-character-set=utf8mb4 glatasks <<'SQL'
CREATE TABLE `user` (id INT PRIMARY KEY, user VARCHAR(80) NOT NULL) CHARACTER SET utf8mb4;
CREATE TABLE `list` (id INT PRIMARY KEY, user_id INT NOT NULL, title VARCHAR(255) NOT NULL, FOREIGN KEY (user_id) REFERENCES `user`(id)) CHARACTER SET utf8mb4;
CREATE TABLE `task` (id INT PRIMARY KEY, list_id INT NOT NULL, text MEDIUMTEXT NOT NULL, FOREIGN KEY (list_id) REFERENCES `list`(id)) CHARACTER SET utf8mb4;
CREATE TABLE `attachment` (id INT PRIMARY KEY, task_id INT NOT NULL, data MEDIUMBLOB NOT NULL, FOREIGN KEY (task_id) REFERENCES `task`(id));
INSERT INTO `user` VALUES (1, '利用者');
INSERT INTO `list` VALUES (2, 1, '買い物');
INSERT INTO `task` VALUES (3, 2, '牛乳を買う');
INSERT INTO `attachment` VALUES (4, 3, X'00010200FF');
SQL

data_dir="$test_root/data"
restore_dir="$test_root/restored"
mkdir -p -- "$data_dir" "$restore_dir"
printf '暗号鍵\000検証' > "$data_dir/.encrypt_key"
printf '署名鍵\377検証' > "$data_dir/.secret_key"
printf '[{"client_id":"test-client","client_id_issued_at":1,"redirect_uris":["https://example.invalid/callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"response_types":["code"]}]\n' \
    > "$data_dir/.mcp_clients.json"

echo "実バックアップのSQLとファイルを空の復元先へ戻します"
backup
shopt -s nullglob
generations=("$data_dir"/backups/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9])
[[ "${#generations[@]}" == 1 ]]
first_backup="${generations[0]}"
restore_dump "$first_backup/glatasks.sql"
verify_restored
for filename in .encrypt_key .secret_key .mcp_clients.json; do
    cp -p -- "$first_backup/$filename" "$restore_dir/$filename"
    cmp -- "$data_dir/$filename" "$restore_dir/$filename"
done

echo "復元エラーとデータ不一致を検出します"
printf 'INVALID STATEMENT;\n' > "$test_root/invalid.sql"
if restore_dump "$test_root/invalid.sql"; then
    echo "不正なSQLの取り込みが成功扱いになりました" >&2
    exit 1
fi
docker exec -e MYSQL_PWD=glatasks "$restore_container" \
    mariadb -uglatasks glatasks -e "UPDATE task SET text = '不一致' WHERE id = 3"
if verify_restored; then
    echo "復元後のデータ不一致を検出できませんでした" >&2
    exit 1
fi

echo "存在する保存対象の失敗時に完成世代を保持します"
mv -- "$data_dir/.mcp_clients.json" "$test_root/mcp-clients.json"
mkdir -- "$data_dir/.mcp_clients.json"
if backup; then
    echo "存在する保存対象のコピー失敗が成功扱いになりました" >&2
    exit 1
fi
[[ -f "$first_backup/glatasks.sql" ]]
[[ -f "$first_backup/.mcp_clients.json" ]]
incomplete=("$data_dir"/backups/.incomplete.*)
[[ "${#incomplete[@]}" == 0 ]]
rmdir -- "$data_dir/.mcp_clients.json"

echo "MCP未使用時と世代管理を検証します"
sleep 1
backup
generations=("$data_dir"/backups/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9])
[[ "${#generations[@]}" == 2 ]]
[[ ! -e "${generations[1]}/.mcp_clients.json" ]]
mv -- "$test_root/mcp-clients.json" "$data_dir/.mcp_clients.json"
sleep 1
backup
generations=("$data_dir"/backups/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9])
[[ "${#generations[@]}" == 2 ]]
[[ ! -e "$first_backup" ]]
[[ -f "${generations[1]}/.mcp_clients.json" ]]

echo "ダンプ失敗で既存の完成世代を残します"
docker exec -e MYSQL_PWD=glatasks "$source_container" \
    mariadb -uroot -e 'DROP DATABASE glatasks'
if backup; then
    echo "ダンプ失敗が成功扱いになりました" >&2
    exit 1
fi
remaining=("$data_dir"/backups/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9])
[[ "${#remaining[@]}" == 2 ]]
[[ "${remaining[*]}" == "${generations[*]}" ]]
incomplete=("$data_dir"/backups/.incomplete.*)
[[ "${#incomplete[@]}" == 0 ]]

echo "全バックアップ試験が成功しました"
