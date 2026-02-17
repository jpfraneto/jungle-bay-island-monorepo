# ─── Jungle Bay Island ───────────────────────────────────────
# make dev       → run backend + frontend in dev mode
# make build     → build frontend + typecheck both
# make deploy    → build, commit, push, deploy to Railway
# make setup     → first-time: init git, create GitHub repo, link Railway
# ─────────────────────────────────────────────────────────────

REPO     := jpfraneto/jungle-bay-island-v2
BRANCH   := main
SERVICE  := jungle-bay-backend

.PHONY: dev dev-backend dev-frontend build typecheck deploy push setup clean logs status

# ─── Development ─────────────────────────────────────────────

dev:
	@echo "\n  Starting dev servers...\n"
	@make -j2 dev-backend dev-frontend

dev-backend:
	@cd backend && bun run dev

dev-frontend:
	@cd frontend && bun run dev

# ─── Build ───────────────────────────────────────────────────

build: typecheck
	@echo "\n  Building frontend..."
	@cd frontend && bun run build
	@echo "  Done. Output in frontend/dist/\n"

typecheck:
	@echo "  Typechecking backend..."
	@cd backend && bunx tsc --noEmit
	@echo "  Typechecking frontend..."
	@cd frontend && bunx tsc --noEmit
	@echo "  All clear.\n"

# ─── Deploy ──────────────────────────────────────────────────

deploy: build
	@echo "\n  Deploying Jungle Bay Island...\n"
	@git add -A
	@git diff --cached --quiet && echo "  No changes to commit." || \
		git commit -m "deploy: $$(date '+%Y-%m-%d %H:%M')"
	@git push origin $(BRANCH)
	@echo "\n  Pushed to GitHub. Deploying to Railway...\n"
	@railway up --service $(SERVICE) --detach
	@echo "\n  Deploy triggered."
	@echo "  Railway:  https://jungle-bay-backend-production.up.railway.app"
	@echo "  GitHub:   https://github.com/$(REPO)\n"

push:
	@git add -A
	@git diff --cached --quiet && echo "  No changes to commit." || \
		git commit -m "update: $$(date '+%Y-%m-%d %H:%M')"
	@git push origin $(BRANCH)
	@echo "  Pushed to GitHub."

# ─── First-time setup ───────────────────────────────────────

setup:
	@echo "\n  Setting up Jungle Bay Island...\n"
	@# Init git if needed
	@[ -d .git ] || git init
	@git add -A
	@git commit -m "initial commit" 2>/dev/null || true
	@# Create GitHub repo if it doesn't exist
	@gh repo view $(REPO) >/dev/null 2>&1 || \
		gh repo create $(REPO) --private --source=. --push --remote=origin
	@# Ensure remote is set
	@git remote get-url origin >/dev/null 2>&1 || \
		git remote add origin git@github.com:$(REPO).git
	@git branch -M $(BRANCH)
	@git push -u origin $(BRANCH)
	@echo "\n  GitHub repo: https://github.com/$(REPO)"
	@echo "  Railway is already linked to: $(SERVICE)"
	@echo "  Run 'make deploy' to ship.\n"

# ─── Utilities ───────────────────────────────────────────────

logs:
	@railway logs --service $(SERVICE)

status:
	@echo ""
	@railway status
	@echo ""
	@git log --oneline -5
	@echo ""

clean:
	@rm -rf frontend/dist
	@echo "  Cleaned frontend/dist/"

install:
	@cd backend && bun install
	@cd frontend && bun install
	@echo "  Dependencies installed."
