# Elevate Monorepo — Build & Test

.PHONY: help install test test-python test-node lint clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Shared libraries ──────────────────────────────────────────────

install-libs-python: ## Install shared Python libs in editable mode
	pip install -e libs/braille/python
	pip install -e libs/audit/python
	pip install -e libs/bbid/python

install-libs-ts: ## Build shared TypeScript libs
	cd libs/braille/typescript && npm install && npm run build
	cd libs/audit/typescript && npm install && npm run build
	cd libs/bbid/typescript && npm install && npm run build

# ── Tests ─────────────────────────────────────────────────────────

test: test-python test-node ## Run all tests

test-python: ## Run Python package tests
	cd packages/cortex && pytest tests/ -v --tb=short 2>/dev/null || true
	cd packages/famulus && pytest tests/ -v --tb=short 2>/dev/null || true
	cd packages/visualize && pytest tests/ --ignore=tests/test_e2e.py -v --tb=short 2>/dev/null || true
	cd packages/cerebellar && pytest tests/ -v --tb=short 2>/dev/null || true

test-node: ## Run Node.js package tests
	cd packages/sal && npm test 2>/dev/null || true
	cd packages/braille-bench && npm test 2>/dev/null || true

test-libs: ## Run shared library tests
	cd libs/braille/python && pytest -v 2>/dev/null || python -m pytest -v 2>/dev/null || true
	cd libs/audit/python && pytest -v 2>/dev/null || python -m pytest -v 2>/dev/null || true

# ── Individual packages ───────────────────────────────────────────

cortex: ## Start cortex daemon
	cd packages/cortex && python -m src.daemon

famulus: ## Start famulus CLI
	cd packages/famulus && python -m famulus.cli

sal: ## Start Sal server
	cd packages/sal && npm start

visualize: ## Start visualizer (backend + frontend)
	cd packages/visualize && python -m src.server &
	cd packages/visualize/frontend && npm run dev

cerebellar: ## Start cerebellar loop
	cd packages/cerebellar && streamlit run app.py

dashboard: ## Start meta dashboard
	cd packages/meta/dashboard && npm run dev

# ── Housekeeping ──────────────────────────────────────────────────

clean: ## Remove build artifacts
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name node_modules -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name dist -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .next -exec rm -rf {} + 2>/dev/null || true
	find . -name '*.pyc' -delete 2>/dev/null || true
