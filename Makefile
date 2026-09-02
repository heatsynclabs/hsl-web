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
	@if [ -f secrets/smtp_url ]; then \
		echo "secrets/smtp_url exists, left alone"; \
	else \
		echo "smtp://localhost:1025" > secrets/smtp_url; \
		chmod 600 secrets/smtp_url; \
		echo "secrets/smtp_url written with a placeholder. Put the real SMTP URL in it"; \
		echo "  before deploying, or password reset mail will not arrive."; \
	fi

backup:
	./tools/backup.sh

restore:
	./tools/restore.sh $(FILE)

check:
	pnpm check
