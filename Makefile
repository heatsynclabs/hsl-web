.PHONY: up down logs secrets backup restore check

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

backup:
	./tools/backup.sh

restore:
	./tools/restore.sh $(FILE)

check:
	pnpm check
