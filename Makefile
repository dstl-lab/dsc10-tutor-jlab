.PHONY: help
help:
	@echo "Available make commands"
	@echo "==================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: lab
lab: ## Start JupyterLab
	@echo "🚀 Starting JupyterLab"
	uv run jupyter lab --port 9999

.PHONY: watch
watch: ## Rebuild JS bundle on JS changes
	@echo "🚀 Starting JS bundle watch..."
	uv run jlpm run watch

.PHONY: build
build: ## Build the JS bundle
	@echo "🚀 Building JS bundle..."
	uv run jlpm run build

.PHONY: test
test: ## Run tests
	@echo "🚀 Running tests..."
	uv run jlpm run test
