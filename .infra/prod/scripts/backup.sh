#!/usr/bin/env bash
# Daily dump of the Prudence database on the OVH host (_product/docs/ops.md, Backups).
# Run as root by prudence-backup.service: its timer fires every day at 03:00 host time, the playbook
# starts it after the first deploy, and `make backup-now` starts it too. pg_dump -Fc inside the Postgres
# container into /var/backups/prudence/<date>.dump (mode 600, checked with pg_restore --list), keeps the
# last 30 days, writes one line to the journal per run, and pings HEARTBEAT_BACKUP_URL from the host .env
# when it is set: the URL after a dump that worked, <url>/fail after one that failed. Never prints the URL.
set -uo pipefail
umask 077

APP_DIR=${APP_DIR:-/opt/scam-shield}
DEST=${BACKUP_DIR:-/var/backups/prudence}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
ENV_FILE="$APP_DIR/.infra/prod/.env"
compose=(docker compose -f "$APP_DIR/.infra/prod/docker-compose.yml")

url=""
if [ -r "$ENV_FILE" ]; then url=$(sed -n 's/^HEARTBEAT_BACKUP_URL=//p' "$ENV_FILE" | tail -n 1); fi
ping() { if [ -n "$url" ]; then curl -fsS -m 10 --retry 2 -o /dev/null "$url$1" >/dev/null 2>&1 || true; fi; }

day=$(date +%F)
file="$DEST/$day.dump"
tmp="$file.partial"
fail() { rm -f "$tmp"; echo "prudence-backup: FAILED: $1"; ping /fail; exit 1; }

mkdir -p "$DEST" && chmod 700 "$DEST" || fail "cannot create $DEST"
err=$( { "${compose[@]}" exec -T postgres pg_dump -U scam_shield -d scam_shield -Fc > "$tmp"; } 2>&1 ) \
  || fail "pg_dump: $(printf '%s' "$err" | tail -n 1)"
[ -s "$tmp" ] || fail "pg_dump wrote an empty file"
err=$( { "${compose[@]}" exec -T postgres pg_restore --list < "$tmp" > /dev/null; } 2>&1 ) \
  || fail "the dump does not read back (pg_restore --list): $(printf '%s' "$err" | tail -n 1)"
mv -f "$tmp" "$file" && chmod 600 "$file" || fail "cannot move the dump into $file"

# Keep the last KEEP_DAYS daily dumps (by the date in their name); pre-restore-*.dump files stay.
cutoff=$(date -d "-$((KEEP_DAYS - 1)) days" +%F)
for old in "$DEST"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].dump; do
  [ -e "$old" ] || continue
  name=$(basename "$old" .dump)
  if [[ "$name" < "$cutoff" ]]; then rm -f "$old"; fi
done

count=$(find "$DEST" -maxdepth 1 -name '[0-9]*.dump' | wc -l)
echo "prudence-backup: ok $file ($(stat -c %s "$file") bytes; daily dumps kept: $count, at most $KEEP_DAYS)"
ping ""
