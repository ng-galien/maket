# Bootstrap a Maket workspace in a target directory
#
# Usage:
#   make bootstrap DIR=/path/to/project PORT=3335
#
# Creates (never overwrites existing files):
#   DIR/.mcp.json          — HTTP MCP config pointing to localhost:PORT
#   DIR/.claude/skills/    — Synced skills from plugin/claude/skills/
#   DIR/package.json       — package.json with maket:dev script

MAKET_ROOT := $(shell pwd)
SKILLS     := maket maket-charte maket-review
PORT       ?= 3335

.PHONY: help bootstrap mcp skills package
.DEFAULT_GOAL := help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Example: make bootstrap DIR=/path/to/project PORT=3335"

bootstrap: ## Bootstrap a Maket workspace (requires DIR=, optional PORT=)
ifndef DIR
	$(error DIR is required. Usage: make bootstrap DIR=/path/to/project PORT=3335)
endif
	@mkdir -p "$(DIR)"
	@$(MAKE) mcp skills package DIR="$(DIR)" PORT="$(PORT)"

mcp: ## Create .mcp.json in DIR (requires DIR=, optional PORT=)
ifndef DIR
	$(error DIR is required)
endif
	@if [ -f "$(DIR)/.mcp.json" ]; then \
		echo "⚠ $(DIR)/.mcp.json already exists — skipped"; \
	else \
		printf '{\n  "mcpServers": {\n    "maket": {\n      "type": "http",\n      "url": "http://localhost:$(PORT)/mcp"\n    }\n  }\n}\n' > "$(DIR)/.mcp.json"; \
		echo "✓ Created $(DIR)/.mcp.json (port $(PORT))"; \
	fi

skills: ## Sync skills to DIR/.claude/skills/ (requires DIR=)
ifndef DIR
	$(error DIR is required)
endif
	@for skill in $(SKILLS); do \
		mkdir -p "$(DIR)/.claude/skills/$$skill"; \
		rsync -a --delete "$(MAKET_ROOT)/plugin/claude/skills/$$skill/" "$(DIR)/.claude/skills/$$skill/"; \
	done
	@echo "✓ Skills synced → $(DIR)/.claude/skills/"

package: ## Create package.json with maket:dev script in DIR (requires DIR=)
ifndef DIR
	$(error DIR is required)
endif
	@if [ -f "$(DIR)/package.json" ]; then \
		echo "⚠ $(DIR)/package.json already exists — skipped"; \
	else \
		printf '{\n  "name": "%s",\n  "private": true,\n  "scripts": {\n    "maket:dev": "MAKET_PORT=$(PORT) MAKET_DATA_DIR=$$PWD/.maket npx --prefix $(MAKET_ROOT) tsx $(MAKET_ROOT)/packages/server/index.ts"\n  }\n}\n' "$$(basename "$(DIR)")" > "$(DIR)/package.json"; \
		echo "✓ Created $(DIR)/package.json (maket:dev → port $(PORT))"; \
	fi
