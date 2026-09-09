#!/usr/bin/env bash
#
# SQLite backup for Šank. Installed by setup-server.sh to
# /opt/sank/bin/backup-db.sh and run from /etc/cron.d/sank-backup.
#
# ONE script, TWO schedules. Which one is running is decided entirely by the two
# environment variables the cron file sets on each line:
#
#   hourly   SANK_BACKUP_DIR=/opt/sank/backups/hourly  SANK_BACKUP_KEEP=48
#   daily    SANK_BACKUP_DIR=/opt/sank/backups/daily   SANK_BACKUP_KEEP=30
#
# Run it by hand with no variables at all and it writes one backup into
# /opt/sank/backups and keeps 48 - which is a perfectly good "make me a copy
# right now".
#
# Why not `cp sank.db backup.db`? Because the database runs in WAL mode
# (Write-Ahead Logging): recent commits live in a separate `sank.db-wal` file
# until SQLite folds them back in. A plain copy of the .db file taken while a
# waiter is locking a round is a copy of the database as of some arbitrary
# moment, missing everything in the WAL - and there is no warning, you just
# restore it one day and find last night missing.
#
# `sqlite3 <db> ".backup <dest>"` uses SQLite's own online backup API. It reads
# a consistent snapshot including the WAL, while the app keeps writing, and it
# never blocks the floor. That is the only correct way to copy this file.
#
# ---------------------------------------------------------------------------
# WHAT THIS FILE PRODUCES IS A KEY TO THE TILL.
#
# A backup is the whole database: every PIN hash, every payment, every waiter's
# numbers, every line of the Dnevnik. Anybody holding one can read all of it, at
# leisure, off the server, forever. So every copy is written owner-only (600) in
# an owner-only directory (700), and a backup file never goes into Viber,
# WhatsApp or an email attachment. It moves by scp, to a machine that is
# somebody's own, and it is treated like the key to the cash drawer.
# ---------------------------------------------------------------------------
set -euo pipefail

# Anything this script creates is owner-only from the moment it exists - not
# created world-readable and fixed a line later.
umask 077

DB="${SANK_DB:-/opt/sank/data/sank.db}"
DEST="${SANK_BACKUP_DIR:-/opt/sank/backups}"
KEEP="${SANK_BACKUP_KEEP:-48}"

log() { printf '%s backup: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
die() { printf '%s backup: ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; exit 1; }

command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is not installed (apt-get install -y sqlite3)"
[ -f "$DB" ] || die "no database at $DB"
case "$KEEP" in
  ''|*[!0-9]*) die "SANK_BACKUP_KEEP must be a whole number, got '$KEEP'" ;;
esac
mkdir -p "$DEST" || die "cannot create $DEST"
chmod 700 "$DEST"

# Local time in the filename, because the person reading `ls` is standing in
# Sarajevo and the machine's clock zone is Europe/Sarajevo. The timestamp still
# sorts correctly: year, month, day, hour.
stamp="$(date '+%Y%m%d-%H%M%S')"
out="$DEST/sank-$stamp.db"

# The single quotes inside the dot-command are SQLite's own quoting, not the
# shell's: .backup takes a quoted filename.
sqlite3 "$DB" ".backup '$out'" || die "sqlite3 .backup failed"
[ -s "$out" ] || die "backup file $out is empty"
chmod 600 "$out"

# A backup nobody has ever opened is a rumour. quick_check reads the whole file
# and answers exactly "ok" when the structure is sound.
verdict="$(sqlite3 "$out" 'pragma quick_check;' 2>&1 || true)"
if [ "$verdict" != "ok" ]; then
  rm -f "$out" "$out-wal" "$out-shm"
  die "the fresh backup did not pass quick_check ($verdict) - deleted it, the database on disk may be damaged"
fi

# The backup inherits WAL mode from the original, so simply OPENING it - which
# the check above just did, read-only - can leave a `-wal` and a `-shm` sidecar
# next to it. Nothing of ours ever wrote to them, and a backup should be one
# self-contained file, so they go.
rm -f "$out-wal" "$out-shm"

size="$(du -h "$out" | cut -f1)"
log "wrote $out ($size)"

# Keep the newest $KEEP, delete the rest. The names are ours and sort by date,
# so a plain reverse-time listing is safe here.
if [ "$KEEP" -gt 0 ]; then
  removed=0
  # shellcheck disable=SC2012
  for old in $(ls -1t "$DEST"/sank-*.db 2>/dev/null | tail -n "+$((KEEP + 1))"); do
    # The sidecars too, in case an older version of this script left some.
    rm -f "$old" "$old-wal" "$old-shm"
    removed=$((removed + 1))
  done
  if [ "$removed" -gt 0 ]; then
    log "pruned $removed backup(s), keeping the newest $KEEP"
  fi
fi

exit 0
