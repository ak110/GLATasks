include .env
ifndef COMPOSE_PROFILE
$(error COMPOSE_PROFILE が定義されていません。.envへCOMPOSE_PROFILE=development（開発）かCOMPOSE_PROFILE=production（本番）を書いてから再実行してください)
endif

# 個別ターゲットでの `--profile=$(COMPOSE_PROFILE)` 手書き重複を避けるため、
# Docker Composeが公式に解釈する環境変数へ一括指定する。
COMPOSE_EXTRA_PROFILES ?=
export COMPOSE_PROFILES = $(COMPOSE_PROFILE)$(if $(COMPOSE_EXTRA_PROFILES),$(comma)$(COMPOSE_EXTRA_PROFILES))
comma := ,
DB_CREDENTIAL ?= glatasks
export DB_CREDENTIAL

RUN_ARGS += --user=$(shell id --user):$(shell id --group) --ulimit="core=0"

export DOCKER_BUILDKIT=1

# pnpm実行用の共通コマンド（プロジェクトルートで実行）
# サプライチェーン攻撃対策として `pnpm install --frozen-lockfile` で
# 再resolveを禁止し、`pnpm-lock.yaml` をそのまま使う。
RUN_NODE = docker run $(2) \
    --env=HOME=${PWD}/.cache \
	--env=COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
	--env=DB_CREDENTIAL \
	--volume=${PWD}:${PWD} \
	--workdir=${PWD} \
	$(RUN_ARGS) \
	node:lts \
	bash -xc '\
        npm install --global --prefix="${PWD}/.cache/corepack" --before="$$(date -u -d yesterday +%Y-%m-%dT%H:%M:%SZ)" corepack &&\
        export PATH="${PWD}/.cache/corepack/bin:$$PATH" &&\
        corepack enable pnpm &&\
		pnpm install --frozen-lockfile &&\
		$(1)\
	'

help:
	@cat Makefile

# prekはworkspace rootから再帰的に配下の`.pre-commit-config.yaml`を探索するため、
# `--config`で対象を本リポジトリの設定ファイルへ限定する。
# `--overwrite`は、pre-commit時代に導入済みのgitフックが残る環境で
# レガシーフックとの二重実行状態（migration mode）へ陥るのを避けるため付与する
setup:  # 開発環境のセットアップ
	uvx prek --config=.pre-commit-config.yaml install --overwrite
	git config --local commit.template .gitmessage

sync:  # 最新化と各種更新
# node:ltsは開発用ターゲット（RUN_NODE）とdevelopmentのmigrate-devだけが使う。
# 本番・stagingのDeployでは使わず、取得が本番サーバーのディスク容量不足の発生箇所になったため、開発環境だけで取得する。
ifeq ($(COMPOSE_PROFILE), development)
	docker pull node:lts
endif
	git fetch --prune
	git rebase
	git show --oneline --no-patch
	git status --verbose

BACKUP_KEEP ?= 5

backup:  # デプロイ前バックアップ（DB・鍵・MCP登録情報）
	@DATA_DIR="$(DATA_DIR)" BACKUP_KEEP="$(BACKUP_KEEP)" \
		SKIP_DB_DUMP="$(SKIP_DB_DUMP)" BACKUP_DB_CONTAINER="$(BACKUP_DB_CONTAINER)" \
		bash db/backup.sh

deploy:
	$(MAKE) build
	$(MAKE) stop
	$(MAKE) start

build:
	docker compose pull
ifeq ($(COMPOSE_PROFILE), development)
	docker compose --progress=plain build --pull
endif

start:
	docker compose up -d

stop:
	docker compose down

restart-app:
	docker compose restart app

logs:
	docker compose logs -ft

ps:
	docker compose ps

# 本番のappイメージ（slim）はcurlを持たないため、コンテナ内の確認は稼働に必須のNodeのfetchで行う。
# signalは応答本文の受信までを2秒の上限の対象にする。
healthcheck:
	@attempt=1; \
	while [ "$$attempt" -le 30 ]; do \
		if curl --fail --silent --show-error --max-time 2 http://localhost:3000/healthcheck 2>/dev/null; then \
			exit 0; \
		fi; \
		if docker compose exec -T app node --input-type=module --eval="const res = await fetch('http://localhost:3000/healthcheck', {signal: AbortSignal.timeout(2000)}); const body = await res.text(); if (!res.ok) { console.error('HTTP ' + res.status); process.exit(1); } console.log(body);"; then \
			exit 0; \
		fi; \
		if [ "$$attempt" -lt 30 ]; then \
			echo "healthcheck: 応答待ちのため2秒後に再試行します（残り$$((30 - attempt))回）" >&2; \
			sleep 2; \
		fi; \
		attempt=$$((attempt + 1)); \
	done; \
	echo "healthcheck: 30回試行してもappの/healthcheckが成功しませんでした。make psでappの稼働を、make logs-appで起動時のエラーを確認してください" >&2; \
	exit 1

start-app:
	docker compose down app
	docker compose up -d app

logs-app:
	docker compose logs -ft app

# SQLの値に`$`や`"`を含む複雑な問い合わせは、Make・シェルの二重展開で意図しない結果になるため、
# `docker compose exec db mariadb`へ接続情報とSQLファイルを渡して直接呼び出すこと
sql:  # DBへの問い合わせ（対話用途。SQL=... 指定時は非対話で1回だけ実行する）
	docker compose exec $(if $(SQL),-T) db mariadb --user="$(DB_CREDENTIAL)" --password="$(DB_CREDENTIAL)" --database=glatasks $(if $(SQL),-e "$(SQL)")

shell:
	docker compose exec app bash

node-shell:
	$(call RUN_NODE, bash, --rm --interactive --tty)

# 依存更新後はSvelteKit生成物（app/.svelte-kit）も再生成する。
# SvelteKit・Viteのメジャー更新が含まれる場合、古い生成物が新バージョンの公開モジュール群と
# 整合せずdev SSRが500を返すため、削除してsyncで再生成する。
update:
	$(call RUN_NODE, corepack use pnpm@latest && pnpm update --latest --recursive && pnpm store prune && rm -rf app/.svelte-kit && pnpm run sync, --rm)
	$(MAKE) update-actions
	$(MAKE) restart-app
	$(MAKE) healthcheck

# GitHub Actionsのアクションをハッシュピンで最新化（mise未導入時はスキップ）
update-actions:
	@command -v mise >/dev/null 2>&1 || { echo "mise未検出のため、GitHub Actionsのピン更新をスキップしました。他の更新は続きます。ピンも更新する場合はmiseを導入してからmake update-actionsを実行してください"; exit 0; }; \
	GITHUB_TOKEN=$$(gh auth token) mise exec -- pinact run --update --min-age=1

# pyfltrの推奨ガイドから意図して外れる指定。グローバルuv設定の公開待機（exclude-newer）は`uvx`にも適用され、
# 公開直後のpyfltrを解決しないため、コマンドラインでpyfltrだけを公開待機から外す（個人の開発環境向けの対処）。
format:  # 整形 + 軽量lint
	uvx --exclude-newer-package pyfltr=false pyfltr fast

test:  # 全チェック実行（これを通過すればコミット可能）
	uvx --exclude-newer-package pyfltr=false pyfltr run
	$(MAKE) test-backup
	$(MAKE) test-db
	$(MAKE) test-e2e

test-unit:  # vitestによるユニットテスト実行（node/domの両projectを実行）
	$(call RUN_NODE, pnpm run test:unit)

migrate:  # DBマイグレーション実行
	docker compose exec app node $(if $(filter development,$(COMPOSE_PROFILE)),app/)scripts/migrate.mjs

db-studio:  # Drizzle Studio起動
	$(call RUN_NODE, pnpm run db:studio, --rm --interactive --tty --env=DATABASE_URL=mysql://$(DB_CREDENTIAL):$(DB_CREDENTIAL)@localhost/glatasks)


test-backup:  # バックアップ機能の隔離復元テスト（Dockerが利用できること）
	@bash db/test-backup.sh

docs-dev:  # ドキュメントサイトをローカルで起動
	$(call RUN_NODE, pnpm --dir docs dev --host=0.0.0.0 --port=5173, --rm --interactive --tty -p 5173:5173)

docs:  # ドキュメントサイトをビルド
	$(call RUN_NODE, pnpm --dir docs build, --rm)

# playwrightサービスのコンテナー内で使うPATHと、pnpm・依存の導入手順（test-e2eとtest-dbで共有）
# 配布イメージのCorepack同梱に依存せず、公開後1日を過ぎた版を非rootの専用prefixへ導入する。
PLAYWRIGHT_PATH = export PATH="${PWD}/.cache/playwright/corepack/bin:$$PATH"
PLAYWRIGHT_INSTALL = npm install --global --prefix="${PWD}/.cache/playwright/corepack" --before="$$(date -u -d yesterday +%Y-%m-%dT%H:%M:%SZ)" corepack &&\
	corepack enable pnpm &&\
	pnpm install --frozen-lockfile

# ローカルのE2Eは、開発環境とは別のComposeプロジェクトを空のDB（tmpfs）と空のデータ置き場で起動して実行する。
# 開発用DBに残ったデータが試験自身の準備不足を補い、CIで初めて失敗する手戻りを防ぐためである。
# 開発用DB・添付ファイル・鍵と公開ポートは分離され（compose.e2e.yaml）、成功・失敗とも終了時に資源を回収する。
# 前回の実行が途中で止まって資源が残っていても、開始時に回収してから空の状態で起動する。
# CIは新しいDATA_DIRで起動したproduction構成が既に空のDBを持つため、起動・初期化を重ねずその構成へ接続する。
E2E_PROJECT = $(notdir $(CURDIR))-e2e
E2E_DATA_DIR = $(CURDIR)/.cache/e2e-data
E2E_COMPOSE = WEBAUTHN_RP_ID=web WEBAUTHN_ORIGINS=https://web DATA_DIR=$(E2E_DATA_DIR) docker compose --project-name=$(E2E_PROJECT) --file=compose.yaml --file=compose.ci.yaml --file=compose.e2e.yaml
E2E_LOCK = .cache/test-e2e.lock
# 失敗時の診断用ログ。終了時に試験用の資源を回収するため、回収の前にここへ保存する
E2E_FAILURE_LOG = $(CURDIR)/.cache/test-e2e-failure.log
E2E_COMPOSE_RUN ?= docker compose

# E2E_GREPの値に`$`や`"`を含む場合は`sql`ターゲットと同じ制約が生じる
test-e2e:  # E2Eテスト（E2E_GREP=... 指定で対象限定実行）。ローカルでは毎回空の試験用DBで実行する
ifeq ($(CI),true)
	$(MAKE) --no-print-directory test-e2e-run
else
	mkdir -p $(dir $(E2E_LOCK))
	flock $(E2E_LOCK) $(MAKE) --no-print-directory test-e2e-isolated
endif

# test-e2eがロックを取得した後に実行する本体。直接呼ぶと同時実行の直列化を経ない
test-e2e-isolated:
	$(E2E_COMPOSE) down --volumes --remove-orphans
	rm -rf "$(E2E_DATA_DIR)" "$(E2E_FAILURE_LOG)"
	mkdir -p "$(E2E_DATA_DIR)"
	@status=0; \
	{ $(E2E_COMPOSE) up --detach --wait web && \
		$(MAKE) --no-print-directory healthcheck-e2e && \
		$(MAKE) --no-print-directory test-e2e-run E2E_COMPOSE_RUN='$(E2E_COMPOSE)'; } || status=$$?; \
	if [ "$$status" -ne 0 ]; then \
		$(E2E_COMPOSE) logs --no-color --timestamps > "$(E2E_FAILURE_LOG)" 2>&1 || true; \
		echo "test-e2e: 失敗時の試験用コンテナーのログを $(E2E_FAILURE_LOG) へ保存しました。このファイルは、続けて行う試験用の資源の回収の後も残ります" >&2; \
	fi; \
	$(E2E_COMPOSE) down --volumes --remove-orphans || true; \
	rm -rf "$(E2E_DATA_DIR)"; \
	exit $$status

# E2E用のアプリが応答するまで待つ。開発サーバーの起動は依存の確認とビルドを含むため、通常のhealthcheckより長く待つ
healthcheck-e2e:
	@attempt=1; \
	while [ "$$attempt" -le 90 ]; do \
		if $(E2E_COMPOSE) exec -T app node --input-type=module --eval="const res = await fetch('http://localhost:3000/healthcheck', {signal: AbortSignal.timeout(2000)}); if (!res.ok) process.exit(1); console.log(await res.text());"; then \
			exit 0; \
		fi; \
		sleep 2; \
		attempt=$$((attempt + 1)); \
	done; \
	echo "healthcheck-e2e: E2E用のアプリが180秒以内に応答しませんでした。終了時に保存される $(E2E_FAILURE_LOG) の app の起動ログを確認してください" >&2; \
	exit 1

test-e2e-run:
	$(E2E_COMPOSE_RUN) run --rm \
		--env=BASE_URL=https://web \
		--env=DATABASE_URL=mysql://$(DB_CREDENTIAL):$(DB_CREDENTIAL)@db/glatasks \
		--env=CI=$(CI) \
		--env=COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
		--env=E2E_STORAGE_STATE=$(E2E_STORAGE_STATE) \
		--env=E2E_OUTPUT_DIR=$(E2E_OUTPUT_DIR) \
		--env=E2E_SKIP_INSTALL=$(E2E_SKIP_INSTALL) \
		playwright \
		bash -xc '\
			$(PLAYWRIGHT_PATH) &&\
			if [ "$$E2E_SKIP_INSTALL" != "1" ]; then\
				$(PLAYWRIGHT_INSTALL);\
			fi &&\
			pnpm run test:e2e $(if $(E2E_GREP),-g "$(E2E_GREP)")\
		'

# `describeDb`のテストは`DATABASE_URL`があるときだけ実行されるため、DBと同じネットワークのplaywrightサービスから
# node project全体を実行する。対象ファイルを列挙しないため、`describeDb`を新設したファイルも登録なしで実行される。
# 接続先は試験専用のデータベース（TEST_DB_NAME）とし、実行のたびにrootで作成し直してマイグレーションを適用する。
# アプリと同じデータベースを使うと、稼働中のアプリの定期処理がテストのfixtureへ実時刻の分を書き込み、
# テストもアプリの開発用データを処理するためである。
# 本番イメージは`TZ=Asia/Tokyo`で動くため、プロセスの時刻帯に依存する計算を検出できるよう、UTCと本番の時刻帯の両方で実行する
# 試験専用のデータベースは名前が固定のため、同時に2つの実行が使うと、後の実行の作り直しと
# 定期処理の試験（全リストの有効な予定を走査して更新する`processSchedules`）が先の実行のfixtureへ交差する。
# 回収中の行が別の実行に更新されると、MariaDBのsnapshot isolationで回収が失敗する（ER_CHECKREAD）。
# このため手順全体をホスト上のファイルロックで直列化し、後から起動した実行は先の実行の終了を待つ。
TEST_DB_NAME = glatasks_test
TEST_DB_LOCK = .cache/test-db.lock

test-db:  # DBへ実接続する統合テスト（Docker環境が起動していること）。試験専用DBで動き、開発用データと稼働中のアプリの定期処理に影響しない
	mkdir -p $(dir $(TEST_DB_LOCK))
	flock $(TEST_DB_LOCK) $(MAKE) --no-print-directory test-db-locked

# test-dbがロックを取得した後に実行する本体。直接呼ぶと同時実行の直列化を経ない
test-db-locked:
	docker compose exec -T db mariadb --user=root --password="$(DB_CREDENTIAL)" \
		--execute="DROP DATABASE IF EXISTS $(TEST_DB_NAME); CREATE DATABASE $(TEST_DB_NAME); GRANT ALL PRIVILEGES ON $(TEST_DB_NAME).* TO '$(DB_CREDENTIAL)'@'%';"
	docker compose run --rm \
		--env=DATABASE_URL=mysql://$(DB_CREDENTIAL):$(DB_CREDENTIAL)@db/$(TEST_DB_NAME) \
		--env=CI=$(CI) \
		--env=COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
		playwright \
		bash -xc '\
			$(PLAYWRIGHT_PATH) &&\
			$(PLAYWRIGHT_INSTALL) &&\
			node app/scripts/migrate.mjs &&\
			TZ=UTC pnpm run test:unit --project node &&\
			TZ=Asia/Tokyo pnpm run test:unit --project node\
		'

.PHONY: help setup sync backup deploy build start stop restart-app logs ps healthcheck shell node-shell update update-actions format test test-unit test-backup test-db test-db-locked test-e2e test-e2e-isolated healthcheck-e2e test-e2e-run start-app logs-app migrate db-studio sql docs docs-dev
