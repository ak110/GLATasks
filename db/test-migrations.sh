#!/usr/bin/env bash
set -euo pipefail
: "${DB_CREDENTIAL:?MakefileのDB_CREDENTIALを環境変数に指定してください}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$script_dir")"
test_root="$(mktemp -d)"
container=""
cleanup() {
    local status=$?
    trap - EXIT
    if [[ -n "$container" ]]; then
        docker rm -f "$container" || status=1
    fi
    rm -rf -- "$test_root" || status=1
    exit "$status"
}
trap cleanup EXIT

sql() {
    docker exec -i -e "MYSQL_PWD=$DB_CREDENTIAL" "$container" \
        mariadb -uroot --default-character-set=utf8mb4 --batch --skip-column-names "$@"
}

container="$(docker run --detach --rm --init --network none \
    --tmpfs /var/lib/mysql:rw,size=512m \
    --env "MARIADB_ROOT_PASSWORD=$DB_CREDENTIAL" mariadb:lts)"
ready=false
for ((attempt = 0; attempt < 60; attempt++)); do
    if sql -e 'SELECT 1' >"$test_root/ready.stdout" 2>"$test_root/ready.stderr"; then
        ready=true
        break
    fi
    sleep 1
done
if [[ "$ready" != true ]]; then
    cat "$test_root/ready.stderr" >&2
    docker logs "$container" >&2
    echo "隔離DBが起動しませんでした。Dockerのログを確認してください" >&2
    exit 1
fi
sql -e 'CREATE DATABASE fresh CHARACTER SET utf8mb4; CREATE DATABASE legacy CHARACTER SET utf8mb4;'
for database in fresh legacy; do
    for migration in "$repo_root"/drizzle/migrations/*.sql; do
        if [[ "$(basename "$migration")" == 0018_* ]]; then
            break
        fi
        sql "$database" <"$migration"
    done
done

sql legacy <<'SQL'
ALTER TABLE `list` DROP INDEX user_id_idx, ADD INDEX user_id (user_id), ADD CONSTRAINT list_ibfk_1 FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `task` DROP INDEX list_id_idx, ADD INDEX list_id (list_id), ADD CONSTRAINT task_ibfk_1 FOREIGN KEY (list_id) REFERENCES `list`(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
SQL

for database in fresh legacy; do
    sql "$database" <<'SQL'
SET FOREIGN_KEY_CHECKS = 0;
INSERT INTO `user` (id, user, pass_hash, joined, preferences) VALUES
 (1, 'valid', 'dummy', UTC_TIMESTAMP(), '{"mode":"alarm","ring_seconds":20,"ringSeconds":10,"base_seconds":300,"adjust_minutes":5,"calorie_goal_kcal":1800}'),
 (2, 'invalid', 'dummy', UTC_TIMESTAMP(), '{invalid');
INSERT INTO `list` (id, user_id, title, last_updated) VALUES
 (1, 1, 'valid', UTC_TIMESTAMP()), (10, 999, 'orphan', UTC_TIMESTAMP());
INSERT INTO `task` (id, list_id, text, created, updated) VALUES
 (1, 1, 'valid', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
 (10, 999, 'orphan', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
 (11, 10, 'orphan ancestor', UTC_TIMESTAMP(), UTC_TIMESTAMP());
INSERT INTO `attachment` (id, task_id, filename, mime_type, size, data, created) VALUES
 (1, 1, 'valid', 'text/plain', 1, X'61', UTC_TIMESTAMP()),
 (10, 999, 'orphan', 'text/plain', 1, X'61', UTC_TIMESTAMP()),
 (11, 10, 'orphan ancestor', 'text/plain', 1, X'61', UTC_TIMESTAMP()),
 (12, 11, 'orphan ancestor', 'text/plain', 1, X'61', UTC_TIMESTAMP());
INSERT INTO `schedule` (id, list_id, title, rrule, created, updated) VALUES
 (1, 1, 'valid', 'RRULE:FREQ=DAILY', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
 (10, 999, 'orphan', 'RRULE:FREQ=DAILY', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
 (11, 10, 'orphan ancestor', 'RRULE:FREQ=DAILY', UTC_TIMESTAMP(), UTC_TIMESTAMP());
INSERT INTO `timer` (id, user_id, name, base_seconds, remaining_seconds, created, updated) VALUES
 (1, 1, 'valid', 60, 60, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
 (10, 999, 'orphan', 60, 60, UTC_TIMESTAMP(), UTC_TIMESTAMP());
SET FOREIGN_KEY_CHECKS = 1;
SQL
    # 最新migration自体の再実行も確認する（履歴管理による実行済み判定と独立）。
    for ((repeat = 0; repeat < 2; repeat++)); do
        for migration in "$repo_root"/drizzle/migrations/0018_*.sql; do
            sql "$database" <"$migration"
        done
    done
    for table in list task attachment schedule timer; do
        [[ "$(sql "$database" -e "SELECT COUNT(*), MIN(id), MAX(id) FROM \`$table\`")" == $'1\t1\t1' ]]
    done
    [[ "$(sql "$database" -e "SELECT JSON_VALUE(preferences, '$.ringSeconds'), JSON_VALUE(preferences, '$.baseSeconds'), JSON_VALUE(preferences, '$.adjustMinutes'), JSON_VALUE(preferences, '$.calorieGoalKcal'), JSON_VALUE(preferences, '$.mode'), JSON_CONTAINS_PATH(preferences, 'one', '$.ring_seconds', '$.base_seconds', '$.adjust_minutes', '$.calorie_goal_kcal') FROM user WHERE id = 1")" == $'10\t300\t5\t1800\talarm\t0' ]]
    [[ "$(sql "$database" -e 'SELECT preferences FROM user WHERE id = 2')" == '{invalid' ]]
    sql "$database" -e 'SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX' >"$test_root/$database-indexes.tsv"
    sql "$database" -e 'SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA = DATABASE() ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION' >"$test_root/$database-fks.tsv"
    if sql "$database" -e "DELETE FROM \`list\` WHERE id = 1"; then
        echo "RESTRICTが親の削除を拒否しませんでした。外部キー定義を確認してください" >&2
        exit 1
    fi
    if sql "$database" -e "INSERT INTO \`list\` (user_id, title, last_updated) VALUES (999, 'invalid', UTC_TIMESTAMP())"; then
        echo "外部キーが親の無い行の追加を拒否しませんでした。外部キー定義を確認してください" >&2
        exit 1
    fi
done
cmp -- "$test_root/fresh-indexes.tsv" "$test_root/legacy-indexes.tsv"
cmp -- "$test_root/fresh-fks.tsv" "$test_root/legacy-fks.tsv"
cat "$test_root/fresh-indexes.tsv" "$test_root/fresh-fks.tsv"
echo "旧DB・新規DBの定義一致、孤児除去、設定移行、再適用の試験が成功しました"
