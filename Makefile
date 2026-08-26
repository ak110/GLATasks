include .env
ifndef COMPOSE_PROFILE
$(error COMPOSE_PROFILE が定義されていません)
endif

# 個別ターゲットでの `--profile=$(COMPOSE_PROFILE)` 手書き重複を避けるため、
# Docker Composeが公式に解釈する環境変数へ一括指定する。
export COMPOSE_PROFILES = $(COMPOSE_PROFILE)

RUN_ARGS += --user=$(shell id --user):$(shell id --group) --ulimit="core=0"

export DOCKER_BUILDKIT=1

# pnpm実行用の共通コマンド（プロジェクトルートで実行）
# サプライチェーン攻撃対策として `pnpm install --frozen-lockfile` で
# 再resolveを禁止し、`pnpm-lock.yaml` をそのまま使う。
RUN_NODE = docker run $(2) \
    --env=HOME=${PWD}/.cache \
	--env=COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
	--volume=${PWD}:${PWD} \
	--workdir=${PWD} \
	$(RUN_ARGS) \
	node:lts \
	bash -xc '\
	    mkdir -p ${PWD}/.cache/bin &&\
        corepack enable --install-directory=${PWD}/.cache/bin &&\
        export PATH=${PWD}/.cache/bin:${PWD}/node_modules/.bin:$$PATH &&\
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
	docker pull node:lts
	git fetch --prune
	git rebase
	git show --oneline --no-patch
	git status --verbose

BACKUP_KEEP ?= 5

backup:  # デプロイ前バックアップ（DB + キーファイル）
	$(eval BACKUP_DIR := $(DATA_DIR)/backups/$(shell date +%Y%m%d_%H%M%S))
	@echo "バックアップを開始します: $(BACKUP_DIR)"
	mkdir -p $(BACKUP_DIR)
	@# DBダンプ実行（停止中はエラー。SKIP_DB_DUMP=1 でスキップ可）
	@if [ "$(SKIP_DB_DUMP)" = "1" ]; then \
		echo "SKIP_DB_DUMP=1: DBダンプをスキップします"; \
	elif docker compose ps db --format='{{.State}}' 2>/dev/null | grep -q running; then \
		docker compose exec -T db \
			mariadb-dump -uglatasks -pglatasks --single-transaction --routines --triggers glatasks \
			> $(BACKUP_DIR)/glatasks.sql \
		&& echo "DBダンプが完了しました" \
		|| (echo "DBダンプに失敗しました" && \rm -f $(BACKUP_DIR)/glatasks.sql && exit 1); \
	else \
		echo "DBコンテナが起動していません" && exit 1; \
	fi
	cp -p $(DATA_DIR)/.encrypt_key $(BACKUP_DIR)/ 2>/dev/null || true
	cp -p $(DATA_DIR)/.secret_key $(BACKUP_DIR)/ 2>/dev/null || true
	@echo "バックアップが完了しました: $(BACKUP_DIR)"
	@# 古いバックアップを削除（直近 BACKUP_KEEP 世代を保持）
	@ls -dt $(DATA_DIR)/backups/*/ 2>/dev/null | tail -n +$$(($(BACKUP_KEEP) + 1)) | xargs \rm -rf 2>/dev/null || true
	@echo "古いバックアップを削除しました（保持: $(BACKUP_KEEP) 世代）"

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

healthcheck:
	curl --fail http://localhost:3000/healthcheck 2>/dev/null || docker compose exec app curl --fail http://localhost:3000/healthcheck

start-app:
	docker compose down app
	docker compose up -d app

logs-app:
	docker compose logs -ft app

# SQLの値に`$`や`"`を含む複雑な問い合わせは、Make・シェルの二重展開で意図しない結果になるため、
# `docker compose exec db mariadb -uglatasks -pglatasks -Dglatasks`を直接呼び出すこと
sql:  # DBへの問い合わせ（対話用途。SQL=... 指定時は非対話で1回だけ実行する）
	docker compose exec $(if $(SQL),-T) db mariadb -uglatasks -pglatasks -Dglatasks $(if $(SQL),-e "$(SQL)")

shell:
	docker compose exec app bash

node-shell:
	$(call RUN_NODE, bash, --rm --interactive --tty)

# 依存更新後はSvelteKit生成物（app/.svelte-kit）も再生成する。
# SvelteKit・Viteのメジャー更新が含まれる場合、古い生成物が新バージョンの公開モジュール群と
# 整合せずdev SSRが500を返すため、削除してsyncで再生成する。
update:
	$(call RUN_NODE, corepack prepare pnpm@latest --activate && corepack use pnpm@latest && pnpm update --latest --recursive && pnpm prune && pnpm store prune && rm -rf app/.svelte-kit && cd app && svelte-kit sync, --rm)
	$(MAKE) update-actions
	$(MAKE) test

# GitHub Actionsのアクションをハッシュピンで最新化（mise未導入時はスキップ）
update-actions:
	@command -v mise >/dev/null 2>&1 || { echo "mise未検出、スキップ"; exit 0; }; \
	GITHUB_TOKEN=$$(gh auth token) mise exec -- pinact run --update --min-age=1

format:  # 整形 + 軽量lint
	uvx pyfltr fast

test:  # 全チェック実行（これを通過すればコミット可能）
	uvx pyfltr run
	$(MAKE) test-backup
	$(MAKE) test-e2e

test-unit:  # vitestによるユニットテスト実行（node/domの両projectを実行）
	$(call RUN_NODE, pnpm run test:unit)

migrate:  # DBマイグレーション実行
	docker compose exec app node --input-type=module --eval="\
		import { drizzle } from 'drizzle-orm/mysql2';\
		import { migrate } from 'drizzle-orm/mysql2/migrator';\
		import mysql from 'mysql2/promise';\
		const conn = await mysql.createConnection(process.env.DATABASE_URL);\
		const db = drizzle(conn);\
		console.log('Running migrations...');\
		await migrate(db, { migrationsFolder: './drizzle/migrations' });\
		await conn.end();\
		console.log('Done.');\
	"

db-studio:  # Drizzle Studio起動
	$(call RUN_NODE, pnpm run db:studio, --rm --interactive --tty)

PNPM_VERSION = $(shell node -e "const p=require('./package.json'); console.log((p.packageManager||'').split('@')[1]?.split('+')[0]||'latest')" 2>/dev/null || echo latest)

test-backup:  # バックアップ機能のテスト（Docker環境が起動していること）
	@echo "バックアップテストを開始します"
	@TEST_BACKUP_DIR=$$(mktemp -d) && \
	trap '\rm -rf "$$TEST_BACKUP_DIR"' EXIT && \
	\
	echo "--- テスト1: バックアップ作成 ---" && \
	$(MAKE) backup DATA_DIR=$$TEST_BACKUP_DIR && \
	BACKUP=$$(ls -d $$TEST_BACKUP_DIR/backups/*/ | head -1) && \
	test -f "$$BACKUP/glatasks.sql" && echo "DBダンプが存在します" && \
	grep -q "CREATE TABLE" "$$BACKUP/glatasks.sql" && echo "DBダンプにテーブル定義が含まれます" && \
	\
	echo "--- テスト2: 世代管理 ---" && \
	for i in 1 2 3; do \
		sleep 1 && $(MAKE) backup DATA_DIR=$$TEST_BACKUP_DIR BACKUP_KEEP=2; \
	done && \
	BACKUP_COUNT=$$(ls -d $$TEST_BACKUP_DIR/backups/*/ | wc -l) && \
	test "$$BACKUP_COUNT" -eq 2 && echo "世代管理: $$BACKUP_COUNT 世代のみ保持されています" && \
	\
	echo "全テストが成功しました"

docs:  # ドキュメントサイトをローカルで起動
	$(call RUN_NODE, cd docs && pnpm dev --host=0.0.0.0 --port=5173, --rm --interactive --tty -p 5173:5173)

# E2E_GREPの値に`$`や`"`を含む場合は`sql`ターゲットと同じ制約が生じる
test-e2e:  # E2Eテスト（E2E_GREP=... 指定で対象限定実行）
	docker compose run --rm \
		--env=BASE_URL=https://web \
		--env=COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
		--env=E2E_STORAGE_STATE=$(E2E_STORAGE_STATE) \
		--env=E2E_OUTPUT_DIR=$(E2E_OUTPUT_DIR) \
		--env=E2E_SKIP_INSTALL=$(E2E_SKIP_INSTALL) \
		playwright \
		bash -xc '\
			export PATH=${PWD}/.cache/playwright/bin:${PWD}/node_modules/.bin:$$PATH &&\
			if [ "$$E2E_SKIP_INSTALL" != "1" ]; then\
				mkdir -p ${PWD}/.cache/playwright/bin &&\
				corepack enable --install-directory=${PWD}/.cache/playwright/bin &&\
				corepack prepare pnpm@$(PNPM_VERSION) --activate &&\
				pnpm install --frozen-lockfile;\
			fi &&\
			pnpm run test:e2e $(if $(E2E_GREP),-g "$(E2E_GREP)")\
		'

.PHONY: help setup sync backup deploy build start stop restart-app logs ps healthcheck shell node-shell update update-actions format test test-unit test-backup test-e2e start-app logs-app migrate db-studio sql docs
