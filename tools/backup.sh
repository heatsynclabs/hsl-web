#!/bin/sh
# Dumps the members database. Run from the repository root on the host.
#
# pg_dump refuses to read a server newer than itself, so this runs pg_dump from
# the same image tag the server runs. Do not swap it for a locally installed
# pg_dump.
set -eu

# This writes every member's name, address, phone number, emergency contact,
# payment history and password hash to disk. `make secrets` two files away
# writes mode 600; a backup of the whole database deserves the same.
umask 077

out_dir="${HSL_BACKUP_DIR:-/var/backups/hsl}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)

mkdir -p "$out_dir"
chmod 700 "$out_dir"

docker compose exec -T db pg_dump -U hsl -Fc hsl > "$out_dir/hsl-$stamp.dump"

# Roles live in the cluster rather than the database, and a restore into a fresh
# cluster fails on the first GRANT without them.
docker compose exec -T db pg_dumpall -U hsl --roles-only --no-role-passwords \
  > "$out_dir/roles-$stamp.sql"

chmod 600 "$out_dir/hsl-$stamp.dump" "$out_dir/roles-$stamp.sql"

echo "wrote $out_dir/hsl-$stamp.dump"
echo "wrote $out_dir/roles-$stamp.sql"
echo
echo "A backup nobody has restored is not a backup. Prove this one:"
echo "  ./tools/restore.sh $out_dir/hsl-$stamp.dump"
