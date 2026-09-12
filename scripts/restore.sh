#!/bin/sh
# Restore a dump into a scratch database, which is the only way to know a backup
# is a backup. It never touches the live database.
#
#   ./scripts/restore.sh backups/hsl-20260911T000000Z.dump

set -eu

dump=${1:?usage: restore.sh <dump file>}
scratch=${SCRATCH_DB:-hsl_restore_check}

docker compose exec -T db dropdb -U hsl --if-exists "$scratch"
docker compose exec -T db createdb -U hsl "$scratch"
docker compose exec -T db pg_restore -U hsl -d "$scratch" < "$dump"

docker compose exec -T db psql -U hsl "$scratch" -c \
  "select (select count(*) from members) as members,
          (select count(*) from credentials) as credentials,
          (select count(*) from payments) as payments"

echo
echo "Restored into $scratch. Now point a staging API at it and sign in as a"
echo "real migrated member. Row counts are not verification."
