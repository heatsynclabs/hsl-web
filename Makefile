# The front door. Every command a maintainer runs is a target here, and
# README.md explains what each one is for.

.DEFAULT_GOAL := help
SHELL := /bin/sh

API  := npm --prefix api
DOOR := npm --prefix door

.PHONY: help install secrets keys up down logs psql migrate seed check typecheck voice test simulator import nightly backup hooks

help: ## List the targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk -F':.*?## ' '{printf "  %-12s %s\n", $$1, $$2}'

install: ## Install dependencies for the scripts, the API and the door service
	npm install && $(API) install && $(DOOR) install

secrets: ## Write a .env with a fresh database password
	@test ! -f .env || (echo ".env already exists. Delete it first if you mean to." && false)
	@pass=$$(openssl rand -hex 16); \
	 sed -e "s/^PG_PASS=.*/PG_PASS=$$pass/" \
	     -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://hsl:$$pass@localhost:5432/hsl#" \
	     .env.example > .env
	@echo "Wrote .env. Run make keys and paste the two lines into it."

keys: ## Print an RSA signing key pair for SIGNING_KEY and SIGNING_KEY_PUBLIC
	@openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/hsl.key 2>/dev/null
	@openssl rsa -in /tmp/hsl.key -pubout -out /tmp/hsl.pub 2>/dev/null
	@echo "SIGNING_KEY=\"$$(awk 1 ORS='\\n' /tmp/hsl.key)\""
	@echo "SIGNING_KEY_PUBLIC=\"$$(awk 1 ORS='\\n' /tmp/hsl.pub)\""
	@rm -f /tmp/hsl.key /tmp/hsl.pub

up: ## Start Postgres and the API
	docker compose up -d --build db api

down: ## Stop everything, keeping the data
	docker compose down

logs: ## Follow the API log
	docker compose logs -f api

psql: ## A shell on the database
	docker compose exec db psql -U hsl hsl

migrate: ## Apply pending migrations
	node scripts/migrate.ts

seed: ## Invented development data. Never run this against production
	docker compose exec -T db psql -U hsl hsl < scripts/seed.sql

check: typecheck voice test ## Everything CI runs

typecheck: ## Type check the scripts and both services
	npm run typecheck

voice: ## Check the copy rules in CONTRIBUTING.md section 11
	node scripts/voice-check.mjs

test: ## Run both suites
	$(API) test && $(DOOR) test

simulator: ## Serve the simulated controller on port 8080
	$(DOOR) run simulator

import: ## Preflight the legacy import. Add ARGS=--apply to write
	node scripts/import.ts $(ARGS)

nightly: ## Expire sessions, drop door events older than two years, report progress
	docker compose exec -T db psql -U hsl hsl < scripts/nightly.sql

backup: ## Dump the database to backups/
	./scripts/backup.sh

hooks: ## Use the checked-in git hooks
	git config core.hooksPath .githooks
