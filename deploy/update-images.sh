#!/usr/bin/env bash
# 引数で指定したサービスのイメージを取得し、稼働中のコンテナと異なるイメージになったサービスだけを作り直す。
# DBのイメージが変わる場合は、作り直し（MARIADB_AUTO_UPGRADEによるDBの更新）の前にバックアップを取る。
# Composeのプロファイル指定（COMPOSE_PROFILES）をMakefileから受け取るため、`make update-images`から実行する。
set -euo pipefail

services=("$@")
docker compose pull --quiet "${services[@]}"

outdated=()
for service in "${services[@]}"; do
    container="$(docker compose ps --quiet "$service")"
    # 停止中のサービスは起動しない
    if [[ -z "$container" ]]; then
        continue
    fi
    read -r image running_id < <(docker inspect --format '{{.Config.Image}} {{.Image}}' "$container")
    if [[ "$(docker image inspect --format '{{.Id}}' "$image")" != "$running_id" ]]; then
        outdated+=("$service")
    fi
done

if ((${#outdated[@]} == 0)); then
    echo "update-images: 稼働中の${services[*]}は取得済みの最新イメージで動いています"
    exit 0
fi
echo "update-images: イメージが更新されたため作り直します: ${outdated[*]}"

if [[ " ${outdated[*]} " == *" db "* ]]; then
    make backup
fi
docker compose up -d --no-deps "${outdated[@]}"
docker image prune --force
