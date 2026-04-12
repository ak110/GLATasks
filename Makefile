include .env
ifndef COMPOSE_PROFILE
$(error COMPOSE_PROFILE が定義されていません)
endif

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
        corepack enable --install-directory ${PWD}/.cache/bin &&\
        export PATH=${PWD}/.cache/bin:${PWD}/node_modules/.bin:$$PATH &&\
		pnpm install --frozen-lockfile &&\
		$(1)\
	'

help:
	@cat Makefile

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
	elif docker compose --profile $(COMPOSE_PROFILE) ps db --format '{{.State}}' 2>/dev/null | grep -q running; then \
		docker compose --profile $(COMPOSE_PROFILE) exec -T db \
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
	docker compose --profile $(COMPOSE_PROFILE) pull
ifeq ($(COMPOSE_PROFILE), development)
	docker compose --profile $(COMPOSE_PROFILE) --progress=plain build --pull
endif

start:
	docker compose --profile $(COMPOSE_PROFILE) up -d

stop:
	docker compose --profile $(COMPOSE_PROFILE) down

restart-app:
	docker compose --profile $(COMPOSE_PROFILE) restart app

logs:
	docker compose --profile $(COMPOSE_PROFILE) logs -ft

ps:
	docker compose --profile $(COMPOSE_PROFILE) ps

healthcheck:
	curl --fail http://localhost:3000/healthcheck 2>/dev/null || docker compose --profile $(COMPOSE_PROFILE) exec app curl --fail http://localhost:3000/healthcheck

start-app:
	docker compose --profile $(COMPOSE_PROFILE) down app
	docker compose --profile $(COMPOSE_PROFILE) up -d app

logs-app:
	docker compose --profile $(COMPOSE_PROFILE) logs -ft app

sql:
	docker compose --profile $(COMPOSE_PROFILE) exec db mariadb -uglatasks -pglatasks -Dglatasks

shell:
	docker compose --profile $(COMPOSE_PROFILE) exec app bash

node-shell:
	$(call RUN_NODE, bash, --rm --interactive --tty)

update:
	$(call RUN_NODE, corepack prepare pnpm@latest --activate && corepack use pnpm@latest && pnpm update --latest && pnpm prune && pnpm store prune, --rm)
	$(MAKE) update-actions
	$(MAKE) test

# GitHub Actions のアクションをハッシュピンで最新化する（mise 未導入時はスキップする）
update-actions:
	@command -v mise >/dev/null 2>&1 || { echo "mise が未検出のためスキップします"; exit 0; }; \
	GITHUB_TOKEN=$$(gh auth token) mise exec -- pinact run --update --min-age 1

format:  # 整形 + 軽量lint
	@# pre-commitはフォーマットによるエラーを考慮して2度まで実行する
	SKIP=pyfltr uvx pre-commit run --all-files || SKIP=pyfltr uvx pre-commit run --all-files
	-uvx pyfltr fix
	-uvx pyfltr fast

test:  # 全チェック実行（これを通過すればコミット可能）
	SKIP=pyfltr uvx pre-commit run --all-files || SKIP=pyfltr uvx pre-commit run --all-files
	uvx pyfltr run
	$(MAKE) test-backup
	$(MAKE) test-e2e

migrate:  # DBマイグレーション実行
	docker compose exec app node --input-type=module --eval "\
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

PLAYWRIGHT_IMAGE = mcr.microsoft.com/playwright:v1.59.1-noble

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
	$(call RUN_NODE, cd docs && pnpm dev --host 0.0.0.0 --port 5173, --rm --interactive --tty -p 5173:5173)

test-e2e:
	docker compose --profile $(COMPOSE_PROFILE) run --rm \
		--env=BASE_URL=https://web \
		playwright \
		bash -xc '\
			npm install -g pnpm@$(PNPM_VERSION) --prefix ${PWD}/.cache/playwright --force &&\
			export PATH=${PWD}/.cache/playwright/bin:${PWD}/node_modules/.bin:$$PATH &&\
			pnpm install --frozen-lockfile && pnpm run test:e2e\
		'

.PHONY: help sync backup deploy build start stop restart-app logs ps healthcheck shell node-shell update update-actions format test test-unit test-backup test-e2e start-app logs-app migrate db-studio docs
