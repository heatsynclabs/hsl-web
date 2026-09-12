#!/bin/sh
# A nightly dump, off the host it protects.
#
# Thirty daily and twelve monthly are the retention this system wants. Set
# BACKUP_DESTINATION to an rclone remote or an s3 path and the last line copies
# them off; without it they stay local, which is not a backup.
#
# Restore is tested quarterly by restoring into a scratch database and signing
# in as a test member. A backup that has never been restored is not a backup.

set -eu

stamp=$(date -u +%Y%m%dT%H%M%SZ)
out=${BACKUP_DIR:-backups}
mkdir -p "$out"
# Resolved, because the docker mount below needs an absolute path and joining
# $PWD to an already absolute BACKUP_DIR writes the archive somewhere nobody
# asked for, inside this repository.
here=$(cd "$out" && pwd)

docker compose exec -T db pg_dump -U hsl -Fc hsl > "$out/hsl-$stamp.dump"
echo "wrote $out/hsl-$stamp.dump"

# Caddy's volume holds the TLS certificate and the ACME account key. Losing it
# costs a new certificate rather than data, and it is cheap to keep.
docker run --rm -v hsl-web_caddy:/data -v "$here":/out alpine \
  tar czf "/out/caddy-$stamp.tar.gz" -C /data . 2>/dev/null || true

find "$out" -name 'hsl-*.dump' -mtime +30 -delete

if [ -n "${BACKUP_DESTINATION:-}" ]; then
  rclone copy "$out" "$BACKUP_DESTINATION"
  echo "copied to $BACKUP_DESTINATION"
else
  echo "BACKUP_DESTINATION is not set, so these are on the host they protect."
fi
