#!/usr/bin/env bash
set -euo pipefail
umask 077

usage="使い方: run.sh <対象のcommit> <絶対パスの新規証拠ディレクトリ> <task-create|task-edit|timer|auth>"
fail() {
  printf 'run.sh: %s\n次の操作: %s\n' "$1" "$2" >&2
  exit 2
}

if [[ $# != 3 ]]; then
  fail "引数が$#個です。" "$usage"
fi
[[ "$(git rev-parse --show-toplevel)" == "$PWD" ]] ||
  fail "カレントディレクトリ $PWD がGit作業ツリーの最上位ではありません。" \
    "主作業ツリーの最上位へ移動してから実行してください。"
[[ "$(git rev-parse --absolute-git-dir)" == "$(git rev-parse --path-format=absolute --git-common-dir)" ]] ||
  fail "$PWD は追加のworktreeです。試験用のComposeは主作業ツリーでだけ起動します。" \
    "変更を主作業ツリーへ統合し、主作業ツリーで実行してください。"
head=$(git rev-parse HEAD)
[[ "$1" == "$head" ]] ||
  fail "対象のcommit $1 がHEAD $head と一致しません。" \
    "第1引数に \"\$(git rev-parse HEAD)\" を渡すか、対象のcommitをチェックアウトしてください。"
[[ -z "$(git status --porcelain)" ]] ||
  fail "作業ツリーに未commitの変更か未追跡のファイルがあります（git status --short で確認できます）。" \
    "検証する変更をcommitし、作業ツリーの差分を無くしてから実行してください。"
# 作業ツリーのパスはMakeの変数とComposeの--envへ引用符なしで渡るため、空白や記号を含むと分割・展開される。
[[ "$PWD" =~ ^/[a-zA-Z0-9_./-]+$ ]] ||
  fail "主作業ツリーのパス $PWD に英数字・「_」「.」「/」「-」以外の文字があります。" \
    "これらの文字だけから成るパスへ主作業ツリーを置いてください。"
# 証拠はPlaywrightのコンテナーとホストの双方が読めるbind mount内（gitignore済みの.cache直下）に置く。
# .cache直下には test-e2e が毎回削除する e2e-data などがあるため、verify- 接頭辞でそれらと名前を分ける。
[[ "$2" =~ ^"$PWD"/\.cache/verify-[a-zA-Z0-9_-]+$ ]] ||
  fail "証拠ディレクトリ $2 が「$PWD/.cache/verify-<英数字・_・->」の形ではありません。" \
    "\"\$PWD/.cache/verify-01\" のように、.cache直下で verify- から始まる未使用の名前を渡してください。"
case "$3" in
  task-create) pattern='タスクを追加すると一覧に表示される' ;;
  task-edit) pattern='編集ダイアログでテキストを変更できる' ;;
  timer) pattern='タイマーを開始・一時停止できる' ;;
  auth) pattern='正しい資格情報でログインすると / へリダイレクト' ;;
  *) fail "機能 $3 は対象外です。" "task-create、task-edit、timer、auth のいずれかを渡してください。" ;;
esac

mkdir -p "$PWD/.cache"
[[ ! -L "$PWD/.cache" ]] ||
  fail "$PWD/.cache がシンボリックリンクのため、証拠がbind mountの外へ書かれるおそれがあります。" \
    "リンクを実ディレクトリへ置き換えてから実行してください。"
[[ ! -e "$2" ]] ||
  fail "証拠ディレクトリ $2 は既に存在します。" "verify-02 のような未使用の名前を渡してください。"
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
[[ -s "$2/run.log" ]] ||
  fail "make test-e2e の出力が $2/run.log に残っていません。" \
    "make と docker を実行できるか確かめ、新しい証拠ディレクトリで再実行してください。"
exit "$status"
