.PHONY: up down logs secrets seed reset backup restore check import legacy-restore

# The whole stack in Docker: database, API, the three apps behind Caddy, and a
# mail catcher. Reads .env. See README.md.
up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

# Generates any secret that does not exist yet. Never overwrites one.
secrets:
	@mkdir -p secrets
	@for name in db_password auth_secret door_token; do \
		if [ -f secrets/$$name ]; then \
			echo "secrets/$$name exists, left alone"; \
		else \
			openssl rand -base64 32 | tr -d '\n' > secrets/$$name; \
			chmod 600 secrets/$$name; \
			echo "secrets/$$name written"; \
		fi; \
	done
	@if [ -f secrets/smtp_url ]; then \
		echo "secrets/smtp_url exists, left alone"; \
	else \
		echo "smtp://mail:1025" > secrets/smtp_url; \
		chmod 600 secrets/smtp_url; \
		echo "secrets/smtp_url written, pointing at the local mail catcher."; \
		echo "  Replace it with a real SMTP URL before deploying."; \
	fi

# Invented members, so there is something to look at without a copy of the
# lab's data. Refuses to run against a database that already holds members.
seed:
	docker compose run --rm --entrypoint node api dist/seed.js

# Throws the local database away and rebuilds it from the migrations. Local
# only: it deletes the volume.
reset:
	docker compose down
	docker volume rm hsl_db_data 2>/dev/null || true
	docker compose up -d --build

# Copies the old Rails database into this one. Needs compose.legacy.yaml and a
# dump at ./legacy/members.dump. See README.md.
import:
	docker compose -f compose.yaml -f compose.legacy.yaml --profile tools run --rm import $(ARGS)

# Restores ./legacy/members.dump into the legacy database container.
legacy-restore:
	docker compose -f compose.yaml -f compose.legacy.yaml up -d legacy-db
	@echo "waiting for the legacy database"
	@until docker compose -f compose.yaml -f compose.legacy.yaml exec -T legacy-db pg_isready -h 127.0.0.1 -U legacy >/dev/null 2>&1; do sleep 1; done
	docker compose -f compose.yaml -f compose.legacy.yaml exec -T legacy-db \
		pg_restore --no-owner --no-acl -h 127.0.0.1 -U legacy -d members /dumps/members.dump
	@echo "restored. Now run: make import ARGS=--dry-run"

backup:
	./tools/backup.sh

restore:
	./tools/restore.sh $(FILE)

check:
	pnpm check
