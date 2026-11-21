#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 3 ]]; then
  echo "使い方: run.sh <対象のcommit> <絶対パスの新規証拠ディレクトリ> <task-create|task-edit|timer|auth>" >&2
  exit 2
fi
[[ "$(git rev-parse --show-toplevel)" == "$PWD" ]]
[[ "$(git rev-parse --absolute-git-dir)" == "$(git rev-parse --path-format=absolute --git-common-dir)" ]]
[[ "$1" == "$(git rev-parse HEAD)" && -z "$(git status --porcelain)" ]]
# Playwright とホストの双方が読める bind mount 内に置く。
[[ "$PWD" =~ ^/[a-zA-Z0-9_./-]+$ ]]
[[ "$2" =~ ^"$PWD"/\.cache/verify-[a-zA-Z0-9_-]+$ ]]
case "$3" in
  task-create) pattern='タスクを追加すると一覧に表示される' ;;
  task-edit) pattern='編集ダイアログでテキストを変更できる' ;;
  timer) pattern='タイマーを開始・一時停止できる' ;;
  auth) pattern='正しい資格情報でログインすると / へリダイレクト' ;;
  *) exit 2 ;;
esac

mkdir -p "$PWD/.cache"
[[ ! -L "$PWD/.cache" ]]
mkdir -- "$2"
export VERIFY_COMMIT=$1
GID=$(id -g)
export UID GID
unset MAKEFLAGS MFLAGS MAKEFILES GNUMAKEFLAGS
export CI=
# Compose の interpolation にも .env の値でなく試験専用の設定を渡す。
export COMPOSE_PROFILE=development DB_CREDENTIAL=glatasks
status=0
make test-e2e CI= COMPOSE_PROFILE=development DB_CREDENTIAL=glatasks E2E_VERIFY=1 \
  E2E_GREP="$pattern" E2E_STORAGE_STATE="$2/user.json" E2E_OUTPUT_DIR="$2/playwright" \
  E2E_FAILURE_LOG="$2/failure.log" 2>&1 | tee "$2/run.log" || status=$?
test -s "$2/run.log"
exit "$status"
