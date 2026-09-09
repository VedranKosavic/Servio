#!/usr/bin/env bash
#
# Deploy Šank from this Mac to the VPS.
#
#   ./deploy/deploy.sh              build, ship, restart, check
#   ./deploy/deploy.sh --skip-build ship whatever is already in .output/
#   ./deploy/deploy.sh --no-start   ship and flip, but do not touch the service
#
# The shape of it:
#
#   npm run build            -> .output/ on this machine
#   rsync                    -> /opt/sank/releases/<timestamp>/
#   symlink `current`        -> that release            (the flip)
#   systemctl restart        -> the app comes back on the new code
#   curl /api/health         -> the HEALTH GATE
#   if the gate fails        -> flip `current` back, restart again, exit 1
#
# Releases are directories that never change once written, and `current` is a
# symlink (a shortcut) pointing at one of them. That is the whole trick: going
# back to yesterday's code is re-pointing a shortcut, which takes a millisecond
# and cannot half-fail, instead of copying files back over a running app.
#
# There is no separate "migrate" step. The app runs the migrations and re-applies
# the triggers itself, inside openDatabase(), every time it boots — so the
# restart IS the migration, and the health gate is what proves it worked.
#
# Settings come from deploy/.deploy.env - copy deploy/deploy.env.example to it.
# That file holds your server's address and is gitignored.
set -euo pipefail

SERVICE="sank"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$SCRIPT_DIR/.deploy.env"

SKIP_BUILD=0
NO_START=0

# --- output helpers ----------------------------------------------------------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_OFF=''
fi
step() { printf '\n%s==>%s %s\n' "$C_OK" "$C_OFF" "$*"; }
info() { printf '    %s\n' "$*"; }
dim()  { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }
warn() { printf '%s!!  %s%s\n' "$C_WARN" "$*" "$C_OFF" >&2; }
die()  { printf '\n%sERROR: %s%s\n' "$C_ERR" "$*" "$C_OFF" >&2; exit 1; }

# The header comment of this file is the help text: everything from line 2 up to
# the first line that is not a comment.
usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-start)   NO_START=1 ;;
    -h|--help)    usage ;;
    *) die "unknown option: $arg (try --help)" ;;
  esac
done

# --- settings ----------------------------------------------------------------
[ -f "$CONFIG_FILE" ] || die "no $CONFIG_FILE.
    Copy the example and fill in your server:
      cp deploy/deploy.env.example deploy/.deploy.env
      \$EDITOR deploy/.deploy.env"

# shellcheck disable=SC1090
. "$CONFIG_FILE"

SSH_HOST="${SSH_HOST:-}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/sank}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3100/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-15}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-5}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

[ -n "$SSH_HOST" ] || die "SSH_HOST is empty in $CONFIG_FILE (it should look like sank@203.0.113.10)"
case "$SSH_HOST" in
  root@*) warn "SSH_HOST is root@... - deploying as the sank user is the intended setup. Continuing." ;;
esac

RELEASES_DIR="$REMOTE_DIR/releases"
CURRENT_LINK="$REMOTE_DIR/current"
NATIVE_DIR="$REMOTE_DIR/native"
STAMP="$(date -u '+%Y%m%d-%H%M%S')"
RELEASE_DIR="$RELEASES_DIR/$STAMP"

# --- talking to the server ---------------------------------------------------
# One ssh connection per call. `remote_script` feeds a whole here-document to a
# remote bash, which keeps quoting sane for anything longer than one command.
# `-n` keeps ssh from swallowing this script's own standard input.
remote() {
  ssh -n -p "$SSH_PORT" -o ConnectTimeout=10 "$SSH_HOST" "$@"
}
remote_script() {
  ssh -p "$SSH_PORT" -o ConnectTimeout=10 "$SSH_HOST" bash -s -- "$@"
}

for tool in ssh rsync node npm; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed on this Mac"
done

# macOS ships two different rsyncs depending on the version (the old 2.6.9 and
# Apple's openrsync), and they do not agree on compression. Ask before using it
# rather than failing on an unknown flag.
RSYNC_FLAGS="-a --delete"
if rsync --help 2>&1 | grep -q -- '--compress'; then
  RSYNC_FLAGS="$RSYNC_FLAGS -z"
fi

cd "$PROJECT_DIR"

# --- 1. build ----------------------------------------------------------------
if [ "$SKIP_BUILD" -eq 1 ]; then
  step "Skipping the build (--skip-build)"
  [ -f .output/server/index.mjs ] || die "there is no .output/server/index.mjs to ship. Run without --skip-build."
else
  step "Building"
  npm run build || die "the build failed - nothing was sent to the server"
fi

[ -f .output/server/index.mjs ] || die ".output/server/index.mjs is missing after the build"

# THE TWO FILES THAT ARE NOT IN THE BUILD.
#
# `.output/` is everything the bundler could see. Two things it cannot see are
# .sql files read at runtime, and the app reads both of them from disk at every
# boot, relative to its working directory (server/database/client.ts):
#
#   server/database/migrations/*.sql   drizzle's migrate() runs these
#   server/database/triggers.sql       applyTriggers() re-executes this
#
# WorkingDirectory in the systemd unit is /opt/sank/current, so both have to
# land inside the release, at exactly those paths. Forget the triggers file and
# the app throws "triggers.sql not found" at startup; forget the migrations and
# a new column is simply missing. Neither failure has anything to do with the
# code you just wrote, which is why they are checked here, by name, before
# anything moves.
#
# The triggers are what make the ledger tables append-only. A release running
# without them is a release where a bad UPDATE goes through silently.
[ -d server/database/migrations ] || die "server/database/migrations is missing"
[ -f server/database/triggers.sql ] || die "server/database/triggers.sql is missing - the ledger triggers would not be installed"

MIGRATIONS="$(find server/database/migrations -name '*.sql' | wc -l | tr -d ' ')"
info "$MIGRATIONS migration file(s) + triggers.sql will travel with the build"

# The in-process task schedules are compiled into the bundle at build time - they
# are NOT read from the server's .env. Printing them here is the only honest way
# to know what the server will actually run. They are cron expressions in UTC,
# because the systemd unit sets TZ=UTC for the app's process.
CRONS="$(grep -o 'const scheduledTasks = \[.*\]' .output/server/chunks/nitro/nitro.mjs 2>/dev/null | head -1 || true)"
if [ -n "$CRONS" ]; then
  dim "schedules baked into this build (UTC):"
  dim "${CRONS#const scheduledTasks = }"
else
  dim "no in-process scheduled tasks in this build"
fi

# --- 2. the server side, before anything moves -------------------------------
step "Checking the server"
remote "test -d '$RELEASES_DIR' && test -d '$REMOTE_DIR/data'" \
  || die "$REMOTE_DIR does not look set up (no releases/ or data/). Run deploy/setup-server.sh on the server first."

# better-sqlite3 is a compiled C++ addon. The copy inside .output/ was built for
# macOS and cannot run on Linux, so it is excluded from the transfer and each
# release symlinks to the Linux copy setup-server.sh installed once. If that
# copy is missing or a major version behind, say so now rather than after the
# service is already restarted onto a broken release.
LOCAL_SQLITE="$(node -p "require('./.output/server/package.json').dependencies['better-sqlite3'] || ''" 2>/dev/null || echo '')"
REMOTE_SQLITE="$(remote "node -p \"require('$NATIVE_DIR/node_modules/better-sqlite3/package.json').version\" 2>/dev/null" || echo '')"
[ -n "$REMOTE_SQLITE" ] || die "better-sqlite3 is not installed in $NATIVE_DIR on the server.
    Fix it there with:
      sudo -u sank -H npm --prefix $NATIVE_DIR install better-sqlite3@$LOCAL_SQLITE"
if [ "${LOCAL_SQLITE%%.*}" != "${REMOTE_SQLITE%%.*}" ]; then
  die "better-sqlite3 major version mismatch: this build wants $LOCAL_SQLITE, the server has $REMOTE_SQLITE.
    Fix it on the server with:
      sudo -u sank -H npm --prefix $NATIVE_DIR install better-sqlite3@$LOCAL_SQLITE"
fi
info "better-sqlite3 $REMOTE_SQLITE on the server, $LOCAL_SQLITE in this build"

# The PIN pepper is what makes a stolen database file hard to attack. An empty
# one is a working configuration - the code falls back to no pepper - so nothing
# would ever complain, and the day it is finally filled in every stored PIN
# stops verifying and nobody can log in. Cheaper to notice now.
if remote "test -f '$REMOTE_DIR/.env'"; then
  if ! remote "grep -Eq '^PIN_PEPPER=.+' '$REMOTE_DIR/.env'"; then
    warn "PIN_PEPPER is empty or missing in $REMOTE_DIR/.env. PINs will be stored unpeppered, and filling it in later invalidates every one of them. Set it BEFORE anybody sets a PIN:  openssl rand -hex 32"
  fi
else
  warn "there is no $REMOTE_DIR/.env on the server - the service will start without a pepper, a PUBLIC_URL or TRUST_PROXY"
fi

# Plain `readlink`, not `readlink -f`: -f happily prints the canonical path of
# something that does not exist, which would hand the rollback a release
# directory that was never there.
PREVIOUS="$(remote "readlink '$CURRENT_LINK' 2>/dev/null || true" || true)"
if [ -n "$PREVIOUS" ]; then
  info "currently live: $PREVIOUS"
else
  warn "nothing is live yet - this is the first deploy, so there is nothing to roll back to if it fails"
fi

# --- 3. ship it --------------------------------------------------------------
step "Uploading release $STAMP"
remote "mkdir -p '$RELEASE_DIR/.output' '$RELEASE_DIR/server/database'"

# shellcheck disable=SC2086
rsync $RSYNC_FLAGS \
  --exclude '/server/node_modules/better-sqlite3' \
  -e "ssh -p $SSH_PORT" \
  .output/ "$SSH_HOST:$RELEASE_DIR/.output/" \
  || die "rsync of .output failed - the release is incomplete and nothing was switched over"

# shellcheck disable=SC2086
rsync $RSYNC_FLAGS \
  -e "ssh -p $SSH_PORT" \
  server/database/migrations/ "$SSH_HOST:$RELEASE_DIR/server/database/migrations/" \
  || die "rsync of the migrations failed - nothing was switched over"

# The triggers file, one file, next to the migrations directory. No --delete
# here: it is a single named file, not a directory being mirrored.
rsync -a \
  -e "ssh -p $SSH_PORT" \
  server/database/triggers.sql "$SSH_HOST:$RELEASE_DIR/server/database/triggers.sql" \
  || die "rsync of triggers.sql failed - nothing was switched over"

# Both really arrived, at the paths the app will look in.
remote "test -f '$RELEASE_DIR/server/database/triggers.sql' && ls '$RELEASE_DIR/server/database/migrations/'*.sql >/dev/null 2>&1" \
  || die "the migrations or triggers.sql did not arrive in $RELEASE_DIR - nothing was switched over"
info "migrations and triggers.sql are in the release"

GIT_REF="$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo 'no-git')"
GIT_DIRTY=""
if ! git -C "$PROJECT_DIR" diff --quiet 2>/dev/null; then GIT_DIRTY=" (uncommitted changes)"; fi
remote "printf '%s\n' 'release $STAMP' 'built on $(hostname) by $(whoami)' 'git $GIT_REF$GIT_DIRTY' 'better-sqlite3 $LOCAL_SQLITE' 'migrations $MIGRATIONS + triggers.sql' > '$RELEASE_DIR/RELEASE'"
info "git $GIT_REF$GIT_DIRTY"

step "Linking the Linux better-sqlite3 into the release"
remote_script "$RELEASE_DIR" "$NATIVE_DIR" <<'REMOTE'
set -euo pipefail
release="$1"; native="$2"
mkdir -p "$release/.output/server/node_modules"
rm -rf "$release/.output/server/node_modules/better-sqlite3"
ln -sfn "$native/node_modules/better-sqlite3" "$release/.output/server/node_modules/better-sqlite3"
# Load it exactly the way the app will, from inside the release, before
# anything is switched over. "invalid ELF header" here means a macOS build
# slipped through; a missing file means the symlink target is gone.
cd "$release/.output/server"
node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('create table t(x)');d.close()"
REMOTE
info "loads from inside the release"

# --- 4. the flip -------------------------------------------------------------
# `ln -sfn` then `mv -T` because plain `ln -sfn` onto an existing symlink is two
# operations with a gap in between; the rename is atomic, so `current` is never
# briefly missing.
flip_to() {
  remote "ln -sfn '$1' '$REMOTE_DIR/.current.new' && mv -Tf '$REMOTE_DIR/.current.new' '$CURRENT_LINK'"
}

restart_service() {
  remote "sudo systemctl restart $SERVICE"
}

# The health gate. It asks the freshly restarted service for /api/health over
# and over, from the server itself (the port is not open to the internet), and
# only accepts a real answer: HTTP 200 AND a body carrying the counts.
#
# `GET /api/health` answers `{ ok: true, tables, products }`, and it counts those
# rows on purpose - the query is what proves the database opened, the migrations
# ran and the triggers applied. A process that is up but answering 502 from a
# half-booted app is not healthy. So the gate matches on "products". Do not
# relax it to a 200, and do not match on `"ok"` - the error envelope has one too.
#
# It takes no venue and it does not need a seeded database: it is a `public`
# route that answers before any cookie exists, so on a fresh box it returns
# `{"ok":true,"tables":0,"products":0}` and the FIRST deploy passes. That is on
# purpose - you deploy, then put the database in - but it also means the counts
# themselves are the signal rather than the status code. Zero products after a
# deploy is either a brand-new box or a DB_PATH pointing at the wrong file, so
# the gate says so loudly instead of quietly going green.
health_ok() {
  local i body
  i=1
  while [ "$i" -le "$HEALTH_RETRIES" ]; do
    body="$(remote "curl -fsS --max-time $HEALTH_TIMEOUT '$HEALTH_URL'" 2>/dev/null || true)"
    case "$body" in
      *'"products":0'*)
        info "answering after ${i} attempt(s)"
        dim "$(printf '%s' "$body" | cut -c1-160)"
        warn "the database has NO products. Either this is the first deploy and"
        warn "you have not copied data/sank.db up yet (README-DEPLOY.md step 5),"
        warn "or DB_PATH in $REMOTE_DIR/.env points at the wrong file. The app is"
        warn "running, but nobody can order anything on it."
        return 0
        ;;
      *'"products"'*)
        info "healthy after ${i} attempt(s)"
        dim "$(printf '%s' "$body" | cut -c1-160)"
        return 0
        ;;
    esac
    printf '    waiting for the app to answer (%s/%s)\r' "$i" "$HEALTH_RETRIES"
    sleep "$HEALTH_INTERVAL"
    i=$((i + 1))
  done
  printf '\n'
  return 1
}

show_logs() {
  printf '\n%s--- last 40 log lines from the server ---%s\n' "$C_DIM" "$C_OFF"
  remote "journalctl -u $SERVICE -n 40 --no-pager 2>/dev/null || sudo systemctl status $SERVICE --no-pager" || true
  printf '%s----------------------------------------%s\n' "$C_DIM" "$C_OFF"
}

step "Switching 'current' to release $STAMP"
flip_to "$RELEASE_DIR"

if [ "$NO_START" -eq 1 ]; then
  step "Not touching the service (--no-start)"
  info "the new code is in place; start it when you are ready:"
  info "  ssh -p $SSH_PORT $SSH_HOST 'sudo systemctl restart $SERVICE'"
  exit 0
fi

step "Restarting $SERVICE"
restart_service || warn "systemctl restart reported a problem - the health gate will decide"

step "Health gate: $HEALTH_URL"
if health_ok; then
  DEPLOY_OK=1
else
  DEPLOY_OK=0
fi

# --- 5. roll back if the gate said no ----------------------------------------
if [ "$DEPLOY_OK" -eq 0 ]; then
  warn "the new release did not answer $HEALTH_URL after $HEALTH_RETRIES tries"
  show_logs

  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE_DIR" ] && remote "test -d '$PREVIOUS'"; then
    step "ROLLING BACK to $PREVIOUS"
    flip_to "$PREVIOUS"
    restart_service || warn "the restart during rollback reported a problem"
    if health_ok; then
      printf '\n%sROLLED BACK.%s The previous release is live again and answering.\n' "$C_WARN" "$C_OFF" >&2
      printf 'The broken release is still on the server for you to look at:\n  %s\n' "$RELEASE_DIR" >&2
      printf '\nNote what a rollback does NOT undo: a migration that already ran.\n' >&2
      printf 'The old code is back, the database is still the new shape. That is\n' >&2
      printf 'fine for adding a column and is not fine for renaming or dropping\n' >&2
      printf 'one - which is why migrations here only ever add.\n' >&2
    else
      printf '\n%sROLLED BACK, AND THE OLD RELEASE IS NOT ANSWERING EITHER.%s\n' "$C_ERR" "$C_OFF" >&2
      printf 'The app is DOWN. Tell the staff to use the paper pad - nothing is\n' >&2
      printf 'lost, the rounds get typed in afterwards. Then look at the logs\n' >&2
      printf 'above, and at the server: ssh -p %s %s, then journalctl -u %s -n 100\n' "$SSH_PORT" "$SSH_HOST" "$SERVICE" >&2
    fi
  else
    printf '\n%sNOTHING TO ROLL BACK TO.%s This was the first deploy, so the broken\n' "$C_ERR" "$C_OFF" >&2
    printf 'release is still what `current` points at. Fix it and deploy again.\n' >&2
    printf 'Most likely causes: a missing value in %s/.env, a DB_PATH the sank\n' "$REMOTE_DIR" >&2
    printf 'user cannot write, or the native better-sqlite3 build. Note that an\n' >&2
    printf 'EMPTY database is not one of them - the health route needs no venue\n' >&2
    printf 'and answers `{"ok":true,"tables":0,"products":0}` on a fresh box - so\n' >&2
    printf 'if this gate never answered at all, the process is not starting.\n' >&2
    printf 'Read the logs above; they say why.\n' >&2
  fi
  die "deploy failed"
fi

# --- 6. tidy up --------------------------------------------------------------
step "Cleaning up old releases (keeping $KEEP_RELEASES)"
remote_script "$RELEASES_DIR" "$CURRENT_LINK" "$KEEP_RELEASES" <<'REMOTE'
set -euo pipefail
releases="$1"; current_link="$2"; keep="$3"
live="$(readlink "$current_link" 2>/dev/null || true)"
removed=0
# Newest first, skip the ones we keep, and never delete the live release even
# if it somehow sorts old.
for dir in $(ls -1t "$releases" 2>/dev/null | tail -n "+$((keep + 1))"); do
  path="$releases/$dir"
  if [ "$path" = "$live" ]; then
    continue
  fi
  rm -rf "$path"
  removed=$((removed + 1))
done
echo "    removed $removed old release(s)"
REMOTE

printf '\n%sDeployed.%s release %s is live and answering.\n' "$C_OK" "$C_OFF" "$STAMP"
printf 'Logs:  ssh -p %s %s "journalctl -u %s -f"\n' "$SSH_PORT" "$SSH_HOST" "$SERVICE"
