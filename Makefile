SHELL := /bin/bash

RAILWAY_SERVICE ?= jungle-bay-backend
RAILWAY_ENV ?= production
BACKEND_ENV_FILE ?= backend/.env.local
FRONTEND_ENV_FILE ?= island/.env
DEPLOY_MSG ?= chore: deploy

REQUIRED_BACKEND_VARS := DATABASE_URL PONDER_RPC_URL_8453 PONDER_RPC_URL_1 PRIVY_APP_ID PRIVY_APP_SECRET PRIVY_VERIFICATION_KEY TREASURY_ADDRESS CLAIM_SIGNER_PRIVATE_KEY CLAIM_CONTRACT_ADDRESS
OPTIONAL_BACKEND_VARS := CORS_ORIGIN SERVER_URL NEYNAR_API_KEY HELIUS_API_KEY X_CLIENT_SECRET_ID X_CLIENT_SECRET X_CONSUMER_KEY X_SECRET_KEY X_BEARER_TOKEN
REQUIRED_FRONTEND_VARS := VITE_TREASURY_ADDRESS VITE_CLAIM_CONTRACT_ADDRESS VITE_JBM_ADDRESS

.PHONY: help check-tools build-frontend git-upload sync-railway-env railway-deploy deploy

help:
	@echo "Targets:"
	@echo "  make deploy            Build frontend, push to GitHub, sync Railway env, deploy Railway, wait for active success"
	@echo "  make build-frontend    Build island assets into backend/public/island"
	@echo "  make sync-railway-env  Sync required env vars from local env files to Railway"
	@echo "  make railway-deploy    Deploy current repo state to Railway and wait for success"
	@echo ""
	@echo "Optional vars:"
	@echo "  DEPLOY_MSG='your commit message'"
	@echo "  RAILWAY_SERVICE=jungle-bay-backend"
	@echo "  RAILWAY_ENV=production"

check-tools:
	@command -v bun >/dev/null || (echo "Missing required tool: bun" && exit 1)
	@command -v git >/dev/null || (echo "Missing required tool: git" && exit 1)
	@command -v railway >/dev/null || (echo "Missing required tool: railway" && exit 1)

build-frontend:
	@echo "Building island frontend..."
	@cd island && bun install --frozen-lockfile && bun run build

git-upload:
	@set -euo pipefail; \
	branch="$$(git rev-parse --abbrev-ref HEAD)"; \
	if [ "$$branch" = "HEAD" ]; then \
		echo "Cannot deploy from detached HEAD."; \
		exit 1; \
	fi; \
	git add -A; \
	if git diff --cached --quiet; then \
		echo "No staged changes to commit."; \
	else \
		git commit -m "$(DEPLOY_MSG)"; \
	fi; \
	git push origin "$$branch"


railway-deploy:
	@set -euo pipefail; \
		started_at="$$(date -u +"%Y-%m-%dT%H:%M:%SZ")"; \
		started_epoch="$$(date +%s)"; \
		echo "Uploading to Railway..."; \
		railway up --service "$(RAILWAY_SERVICE)" --environment "$(RAILWAY_ENV)" --ci; \
		echo "Waiting for Railway to promote the new deployment..."; \
		deadline="$$((started_epoch + 600))"; \
		while [ "$$(date +%s)" -lt "$$deadline" ]; do \
		deployment_json="$$(railway deployment list --service "$(RAILWAY_SERVICE)" --environment "$(RAILWAY_ENV)" --limit 10 --json)"; \
		status="$$(printf '%s' "$$deployment_json" | node -e 'let s=""; process.stdin.on("data",(d)=>s+=d); process.stdin.on("end",()=>{ const startedAt = Date.parse(process.argv[1]); const deployments = JSON.parse(s); const latest = deployments.find((deployment) => Date.parse(deployment.createdAt) >= startedAt); process.stdout.write(latest?.status ?? ""); });' "$$started_at")"; \
		if [ "$$status" = "SUCCESS" ]; then \
			echo "Railway deployment is active."; \
			exit 0; \
		fi; \
		if [ -n "$$status" ] && [ "$$status" != "BUILDING" ] && [ "$$status" != "DEPLOYING" ] && [ "$$status" != "INITIALIZING" ]; then \
			echo "Railway deployment did not become active. Latest status: $$status"; \
			exit 1; \
		fi; \
		sleep 5; \
	done; \
	echo "Timed out waiting for Railway deployment to become active."; \
	exit 1

deploy: check-tools build-frontend git-upload railway-deploy
