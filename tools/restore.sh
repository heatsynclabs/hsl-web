#!/bin/sh
# Restores a dump into a throwaway database and reports what came back.
# Never restores over the live database.
set -eu

dump="${1:?usage: restore.sh <dump file>}"
target="hsl_restore_check"

[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 1; }

echo "restoring $dump into $target"

docker compose exec -T db dropdb -U hsl --if-exists "$target"
docker compose exec -T db createdb -U hsl "$target"
docker compose exec -T db pg_restore -U hsl -d "$target" --no-owner --no-acl < "$dump"

echo
echo "row counts in the restored copy:"
docker compose exec -T db psql -U hsl -d "$target" -c \
  "select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc;"

echo
echo "The restore succeeded. Drop the copy when you are done looking at it:"
echo "  docker compose exec db dropdb -U hsl $target"
