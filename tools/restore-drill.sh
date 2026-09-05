#!/bin/sh
# Proves the backup path works: load a fixture, dump it, destroy the database,
# restore it, and check the rows came back. Runs in CI on every change.
set -eu

image="postgres:18.6-alpine"
name="hsl-restore-drill"
work=$(mktemp -d)

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

docker run -d --name "$name" -e POSTGRES_PASSWORD=drill -e POSTGRES_USER=hsl \
  -e POSTGRES_DB=hsl "$image" >/dev/null

# The official image starts a temporary server to run its init scripts, then
# shuts it down and starts the real one. pg_isready answers yes during that
# first phase, so a loop that trusts it wins the race on an idle laptop and
# loses it on a loaded CI runner, failing with "the database system is shutting
# down" on a backup path that is fine. Wait for the entrypoint to say it has
# finished, then prove the real server answers a real query.
i=0
until docker logs "$name" 2>&1 | grep -q 'PostgreSQL init process complete'; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || { echo "postgres did not finish initialising" >&2; exit 1; }
  sleep 1
done

i=0
until docker exec "$name" psql -U hsl -d hsl -At -c 'select 1' >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || { echo "postgres did not become ready" >&2; exit 1; }
  sleep 1
done

docker exec -i "$name" psql -U hsl -d hsl -q <<'SQL'
create table drill (id integer primary key, note text);
insert into drill values (1, 'a'), (2, 'b'), (3, 'c');
SQL

docker exec "$name" pg_dump -U hsl -Fc hsl > "$work/drill.dump"
docker exec "$name" psql -U hsl -d postgres -q -c 'drop database hsl with (force)'
docker exec "$name" createdb -U hsl hsl
docker exec -i "$name" pg_restore -U hsl -d hsl --no-owner --no-acl < "$work/drill.dump"

count=$(docker exec "$name" psql -U hsl -d hsl -At -c 'select count(*) from drill')

if [ "$count" != "3" ]; then
  echo "restore drill failed: expected 3 rows, got $count" >&2
  echo "The backup path is broken. Do not deploy until this passes." >&2
  exit 1
fi

echo "restore drill passed: 3 rows survived a dump, a drop and a restore"
