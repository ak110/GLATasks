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
		if [ "$$attempt" -lt 30 ]; then sleep 2; fi; \
		attempt=$$((attempt + 1)); \
	done; \
	exit 1

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
	$(MAKE) restart-app
	$(MAKE) healthcheck
	$(MAKE) test

# GitHub Actionsのアクションをハッシュピンで最新化（mise未導入時はスキップ）
update-actions:
	@command -v mise >/dev/null 2>&1 || { echo "mise未検出、スキップ"; exit 0; }; \
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

test-backup:  # バックアップ機能の隔離復元テスト（Dockerが利用できること）
	@bash db/test-backup.sh

docs:  # ドキュメントサイトをローカルで起動
	$(call RUN_NODE, cd docs && pnpm dev --host=0.0.0.0 --port=5173, --rm --interactive --tty -p 5173:5173)

# playwrightサービスのコンテナー内で使うPATHと、pnpm・依存の導入手順（test-e2eとtest-dbで共有）
PLAYWRIGHT_PATH = export PATH=${PWD}/.cache/playwright/bin:${PWD}/node_modules/.bin:$$PATH
PLAYWRIGHT_INSTALL = mkdir -p ${PWD}/.cache/playwright/bin &&\
	corepack enable --install-directory=${PWD}/.cache/playwright/bin &&\
	corepack prepare pnpm@$(PNPM_VERSION) --activate &&\
	pnpm install --frozen-lockfile

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
			$(PLAYWRIGHT_PATH) &&\
			if [ "$$E2E_SKIP_INSTALL" != "1" ]; then\
				$(PLAYWRIGHT_INSTALL);\
			fi &&\
			pnpm run test:e2e $(if $(E2E_GREP),-g "$(E2E_GREP)")\
		'

# `describeDb`のテストは`DATABASE_URL`があるときだけ実行されるため、DBと同じネットワークのplaywrightサービスから
# node project全体を実行する。対象ファイルを列挙しないため、`describeDb`を新設したファイルも登録なしで実行される
test-db:  # DBへ実接続する統合テスト（Docker環境が起動していること）
	docker compose run --rm \
		--env=DATABASE_URL=mysql://glatasks:glatasks@db/glatasks \
		--env=COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
		playwright \
		bash -xc '\
			$(PLAYWRIGHT_PATH) &&\
			$(PLAYWRIGHT_INSTALL) &&\
			pnpm run test:unit --project node\
		'

.PHONY: help setup sync backup deploy build start stop restart-app logs ps healthcheck shell node-shell update update-actions format test test-unit test-backup test-db test-e2e start-app logs-app migrate db-studio sql docs
