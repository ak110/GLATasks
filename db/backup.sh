#!/usr/bin/env bash
set -euo pipefail

: "${DATA_DIR:?DATA_DIRを指定してください}"
: "${BACKUP_KEEP:?BACKUP_KEEPを指定してください}"

if [[ ! "$BACKUP_KEEP" =~ ^[0-9]+$ ]]; then
    echo "BACKUP_KEEPには0以上の整数を指定してください: $BACKUP_KEEP" >&2
    exit 1
fi
keep=$((10#$BACKUP_KEEP))

backup_root="$DATA_DIR/backups"
mkdir -p -- "$backup_root"
staging="$(mktemp -d "$backup_root/.incomplete.XXXXXXXX")"
cleanup() {
    if [[ -n "$staging" ]]; then
        rm -rf -- "$staging"
    fi
}
trap cleanup EXIT

if [[ "${SKIP_DB_DUMP:-}" == 1 ]]; then
    echo "SKIP_DB_DUMP=1: DBダンプをスキップします"
else
    db_container="${BACKUP_DB_CONTAINER:-}"
    if [[ -z "$db_container" ]]; then
        db_container="$(docker compose ps -q db)"
    fi
    if [[ -z "$db_container" ]] ||
        [[ "$(docker inspect --format '{{.State.Running}}' "$db_container")" != true ]]; then
        echo "DBコンテナが起動していません" >&2
        exit 1
    fi
    docker exec -i -e MYSQL_PWD=glatasks "$db_container" \
        mariadb-dump -uglatasks --single-transaction --routines --triggers glatasks \
        > "$staging/glatasks.sql"
    echo "DBダンプが完了しました"
fi

for filename in .encrypt_key .secret_key .mcp_clients.json; do
    source_path="$DATA_DIR/$filename"
    if [[ -e "$source_path" || -L "$source_path" ]]; then
        cp -p -- "$source_path" "$staging/$filename"
    fi
done

generation="$(date +%Y%m%d_%H%M%S)"
destination="$backup_root/$generation"
if [[ -e "$destination" || -L "$destination" ]]; then
    echo "同じ時刻のバックアップが既に存在します: $destination" >&2
    exit 1
fi
mv -- "$staging" "$destination"
staging=""
echo "バックアップが完了しました: $destination"

# 完成世代だけを古い順に削除する。生成中の隠しディレクトリは対象外。
shopt -s nullglob
generations=("$backup_root"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9])
remove_count=$((${#generations[@]} - keep))
for ((index = 0; index < remove_count; index++)); do
    rm -r -- "${generations[index]}"
done
echo "古いバックアップを削除しました（保持: $BACKUP_KEEP 世代）"
