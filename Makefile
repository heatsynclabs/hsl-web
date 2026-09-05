.PHONY: up down logs secrets seed reset backup restore check import legacy-restore admin hooks

# The whole stack in Docker: database, API and the three apps behind Caddy.
# Reads .env. See README.md.
#
# Migrations run before anything is recreated. `docker compose up -d` on its own
# tears down the old api and web containers first and only then runs migrate, so
# a migration that fails takes the running site down with it and leaves nothing
# to fall back to. Running it as its own step first means a bad migration stops
# the deploy with the site still up.
up:
	docker compose build
	docker compose run --rm migrate
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

# Generates any secret that does not exist yet. Never overwrites one.
#
# The directory is 700 and the files are 644, rather than the files being 600.
# Compose mounts a file secret as a plain bind mount and ignores uid, gid and
# mode, and the service images run as the node user, uid 1000. A file the
# deploying user owns at 600 is unreadable inside the container, so migrate
# exits with EACCES and the api never starts. The private directory is what
# keeps other host users out.
secrets:
	@mkdir -p secrets
	@chmod 700 secrets
	@for name in db_password auth_secret door_token; do \
		if [ -f secrets/$$name ]; then \
			echo "secrets/$$name exists, left alone"; \
		else \
			openssl rand -base64 32 | tr -d '\n' > secrets/$$name; \
			chmod 644 secrets/$$name; \
			echo "secrets/$$name written"; \
		fi; \
	done
	@if [ -f secrets/smtp_url ]; then \
		echo "secrets/smtp_url exists, left alone"; \
	else \
		echo "smtp://mail:1025" > secrets/smtp_url; \
		chmod 644 secrets/smtp_url; \
		echo "secrets/smtp_url written, pointing at the local mail catcher."; \
		echo "  Replace it with a real SMTP URL before deploying."; \
	fi

# Invented members, so there is something to look at without a copy of the
# lab's data. Refuses to run against a database that already holds members.
seed:
	docker compose run --rm --entrypoint node api dist/seed.js

# Makes an existing member an admin. A fresh install has nobody who can reach
# the admin app, and every route that could grant admin already needs one, so
# the first one is granted from the host.
#
#   make admin EMAIL=someone@heatsynclabs.org
admin:
	@test -n "$(EMAIL)" || { echo "Usage: make admin EMAIL=someone@example.org"; exit 1; }
	docker compose run --rm --entrypoint node api dist/make-admin.js "$(EMAIL)"

# Throws the local database away and rebuilds it from the migrations.
#
# It deletes every member, card, payment and signed release. A comment saying
# "local only" is not a guard, so this reads .env and refuses on anything that
# looks like a deployment.
reset:
	@if grep -qE '^HSL_SCHEME=https' .env 2>/dev/null && [ "$(CONFIRM)" != "yes" ]; then \
		echo "Refusing: .env says HSL_SCHEME=https, so this host looks like a deployment."; \
		echo "make reset deletes the members database: every member, card, payment and"; \
		echo "signed release. To put a database back, restore a backup instead:"; \
		echo "  ./tools/restore.sh <dump file>"; \
		echo "If you really do mean it on this host: make reset CONFIRM=yes"; \
		exit 1; \
	fi
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

# Points git at .githooks, which nothing else does, so a fresh clone gets the
# commit message check. CI runs the same script over every commit in a pull
# request, which is the half that holds when this has not been run.
hooks:
	git config core.hooksPath .githooks
	@echo "commit hooks enabled from .githooks"

