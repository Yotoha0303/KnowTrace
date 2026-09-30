POWERSHELL ?= powershell

.PHONY: help init up start down stop restart ps logs auth-logs test auth-test check build backup deploy

help:
	@echo KnowTrace commands:
	@echo   make init       Generate local secrets and default administrator settings
	@echo   make up         Build and start KnowTrace, go-user-system, PostgreSQL, MySQL and Redis
	@echo   make down       Stop and remove containers while preserving data volumes
	@echo   make restart    Restart the complete stack
	@echo   make ps         Show unified service status
	@echo   make logs       Follow KnowTrace and authentication logs
	@echo   make check      Run frontend and Go backend quality gates
	@echo   make backup     Back up KnowTrace PostgreSQL and go-user-system MySQL
	@echo   make deploy     Run the VPS deploy chain and assert the running revision matches HEAD

init:
	$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/init-env.ps1

up start:
	$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/start-all.ps1

down stop:
	docker compose down

restart: down up

ps:
	docker compose ps -a

logs:
	docker compose logs -f app auth

auth-logs:
	docker compose logs -f auth auth-migrate auth-bootstrap auth-mysql auth-redis

test:
	pnpm test

auth-test:
	cd services/go-user-system && go test ./...

build:
	pnpm build

check:
	pnpm typecheck
	pnpm lint
	pnpm test
	pnpm build
	cd services/go-user-system && go test ./...

backup:
	$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/backup-all.ps1

# 在 VPS 上以 root 执行（deploy/deploy.sh 会自己 sudo）。
# 之所以做成脚本而不是一行 docker compose：一行命令无法断言
# 「运行态真的换成了新代码」，而那正是这里最容易假成功的地方。
deploy:
	sudo bash deploy/deploy.sh
