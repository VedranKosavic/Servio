#!/usr/bin/env bash
#
# Šank VPS setup - run ONCE, as root, on a fresh Ubuntu 24.04 server.
#
#   scp -r deploy root@<server-ip>:/root/
#   ssh root@<server-ip>
#   bash /root/deploy/setup-server.sh
#
# What it does, in order:
#   1. installs the packages the app needs (Node 22 from NodeSource, the sqlite3
#      command-line tool, rsync, curl, ufw)
#   2. sets the machine's clock zone to Europe/Sarajevo
#   3. creates the unprivileged `sank` user the app and the deploys run as
#   4. lays out /opt/sank (releases, data, backups, native, bin) and writes a
#      starter /opt/sank/.env with a freshly generated PIN pepper
#   5. installs better-sqlite3 for THIS machine (see the long comment below)
#   6. installs the systemd unit and ENABLES it - it does not start it, because
#      of the first-run order in README-DEPLOY.md
#   7. installs the database backups: the script in bin/ and the cron file
#   8. optionally installs the nginx site (only if nginx is already there)
#   9. raises a firewall that allows ssh, 80 and 443 and nothing else
#
# It is idempotent: running it again after a change is safe and is the intended
# way to update the systemd unit, the backup script or the cron file.
set -euo pipefail

APP_USER="sank"
APP_DIR="/opt/sank"
SERVICE="sank"
NODE_MAJOR="22"
APP_PORT="3100"
TIMEZONE="Europe/Sarajevo"

# Backup retention, mirrored in the cron file written in step 7.
HOURLY_KEEP="48"
DAILY_KEEP="30"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- output helpers ----------------------------------------------------------
# Colours are only sent to a real terminal, so the output stays readable when
# it is piped into a file.
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_OFF=''
fi
step()  { printf '\n%s==>%s %s\n' "$C_OK" "$C_OFF" "$*"; }
info()  { printf '    %s\n' "$*"; }
skip()  { printf '    %salready done: %s%s\n' "$C_DIM" "$*" "$C_OFF"; }
warn()  { printf '%s!!  %s%s\n' "$C_WARN" "$*" "$C_OFF" >&2; }
die()   { printf '\n%sERROR: %s%s\n' "$C_ERR" "$*" "$C_OFF" >&2; exit 1; }

# --- sanity checks -----------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "run this as root: sudo bash $0"

command -v apt-get >/dev/null 2>&1 \
  || die "this script is written for Ubuntu/Debian (no apt-get here). Install Node $NODE_MAJOR, sqlite3 and rsync by hand and read the rest of this file for what it sets up."

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${VERSION_ID:-}" in
    24.04|22.04) : ;;
    *) warn "tested on Ubuntu 24.04, this is ${PRETTY_NAME:-unknown}. Continuing." ;;
  esac
fi

for f in sank.service backup-db.sh; do
  [ -f "$SCRIPT_DIR/$f" ] \
    || die "$f is missing next to this script. Copy the WHOLE deploy/ folder up: scp -r deploy root@<ip>:/root/"
done

export DEBIAN_FRONTEND=noninteractive

# --- 1. packages -------------------------------------------------------------
step "Installing packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg openssl rsync sqlite3 ufw >/dev/null
info "curl, openssl, rsync, sqlite3, ufw"

# `sqlite3` here is the command-line tool, which is a different thing from the
# better-sqlite3 the app uses. The backup script shells out to it (`.backup`),
# and it is how you look inside the database by hand when something is odd.
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR" ]; then
  skip "Node $(node -v)"
else
  info "installing Node $NODE_MAJOR from NodeSource (this takes a minute)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh \
    || die "could not download the NodeSource installer - is the server online?"
  bash /tmp/nodesource_setup.sh >/dev/null
  rm -f /tmp/nodesource_setup.sh
  apt-get install -y -qq nodejs >/dev/null
  command -v node >/dev/null 2>&1 || die "Node still is not installed"
  info "Node $(node -v), npm $(npm -v)"
fi

# --- 2. the clock ------------------------------------------------------------
# The machine's clock zone. Two things read it and one deliberately does not:
#
#   - cron reads it, so /etc/cron.d/sank-backup fires at 05:00 *Sarajevo*, which
#     is what "after the last shift" means to the owner;
#   - `date`, `ls -l` and the journal timestamps you read by hand use it, so the
#     log agrees with the clock on the wall;
#   - the APP does not: sank.service pins the app's own process to TZ=UTC and
#     the app converts to Europe/Sarajevo itself, in `shared/dates.ts`. The
#     business day boundary (06:00) must not depend on a machine setting anyone
#     can change.
step "Setting the clock zone to $TIMEZONE"
current_tz="$(timedatectl show -p Timezone --value 2>/dev/null || echo '')"
if [ "$current_tz" = "$TIMEZONE" ]; then
  skip "already $TIMEZONE"
else
  timedatectl set-timezone "$TIMEZONE" || warn "could not set the timezone (is this a container without systemd-timesyncd?)"
  info "$(date '+%Y-%m-%d %H:%M:%S %Z')"
fi

# --- 3. the app user ---------------------------------------------------------
step "Creating the $APP_USER user"
if id -u "$APP_USER" >/dev/null 2>&1; then
  skip "user $APP_USER exists"
else
  # A real shell, because deploys ssh in as this user. --system keeps it out of
  # the normal user id range and gives it no password: the only way in is the
  # ssh key copied below.
  useradd --system --create-home --home-dir "$APP_DIR" --shell /bin/bash "$APP_USER"
  info "created $APP_USER with home $APP_DIR"
fi

# journalctl -u sank without sudo, for the app user and for whoever deploys.
if getent group systemd-journal >/dev/null 2>&1; then
  usermod -aG systemd-journal "$APP_USER"
  info "$APP_USER can read the journal (group systemd-journal)"
fi

# The same ssh key that got root in gets the app user in, so deploys work with
# no extra key juggling.
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/.ssh"
  if [ -f "$APP_DIR/.ssh/authorized_keys" ] \
     && cmp -s /root/.ssh/authorized_keys "$APP_DIR/.ssh/authorized_keys"; then
    skip "ssh key already copied to $APP_USER"
  else
    install -m 600 -o "$APP_USER" -g "$APP_USER" /root/.ssh/authorized_keys "$APP_DIR/.ssh/authorized_keys"
    info "copied root's ssh key(s) to $APP_USER - deploys log in as $APP_USER@<ip>"
  fi
else
  warn "root has no ~/.ssh/authorized_keys, so nothing was copied. You will have to put your public key in $APP_DIR/.ssh/authorized_keys yourself before deploying."
fi

# Deploys need to restart the service. Exactly those verbs, no wildcards, no
# journalctl (that goes through the group above instead - journalctl as root
# can open a pager, and a pager can open a shell).
step "Allowing $APP_USER to restart the service"
SUDOERS_TMP="$(mktemp)"
cat > "$SUDOERS_TMP" <<EOF
# Installed by deploy/setup-server.sh. Lets deploy.sh restart the app without a
# password, and nothing else.
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl start $SERVICE, /usr/bin/systemctl stop $SERVICE, /usr/bin/systemctl restart $SERVICE, /usr/bin/systemctl is-active $SERVICE, /usr/bin/systemctl status $SERVICE, /usr/bin/systemctl reset-failed $SERVICE
EOF
if visudo -cqf "$SUDOERS_TMP"; then
  install -m 440 -o root -g root "$SUDOERS_TMP" /etc/sudoers.d/sank-deploy
  rm -f "$SUDOERS_TMP"
  info "/etc/sudoers.d/sank-deploy"
else
  rm -f "$SUDOERS_TMP"
  die "the sudoers snippet did not validate - nothing was installed (that check is why you are not locked out)"
fi

# --- 4. directories and the env file ----------------------------------------
step "Laying out $APP_DIR"
for d in "$APP_DIR" "$APP_DIR/releases" "$APP_DIR/data" "$APP_DIR/native" "$APP_DIR/bin"; do
  install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$d"
done
info "releases/ data/ native/ bin/"

# The backups are stricter than everything else, and this is the one permission
# on the box worth understanding.
#
# A backup file is a key to the till. It is the whole database: every PIN hash,
# every payment, every waiter's numbers, every log line. Anybody who can read
# one can read all of that at their leisure, off the server, forever.
#
# So: owner only, nobody else, not even the group.
#
# The directory is 700 and not 600. On a directory the execute bit is what
# permits opening the files inside it - a literal 600 would leave a directory
# whose contents not even the backup script could write or read back. 700 is
# the same "owner and nobody else" that 600 means on a file, and every backup
# FILE inside is created 600 (backup-db.sh sets `umask 077` and chmods what it
# writes). That pair is the intent.
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/backups"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/backups/hourly"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/backups/daily"
info "backups/ (mode 700, hourly/ and daily/) - a backup is a key to the till"

if [ -f "$APP_DIR/.env" ]; then
  skip "$APP_DIR/.env exists (not touched - your PIN pepper is in there)"
else
  # The pepper is generated here, once, rather than left blank for someone to
  # fill in later. Blank is a working configuration - the code falls back to an
  # empty pepper - so a forgotten line would never announce itself, and the day
  # it is finally filled in every stored PIN stops verifying.
  PEPPER="$(openssl rand -hex 32)"
  cat > "$APP_DIR/.env" <<EOF
# Šank server settings. One KEY=value per line, no \`export\`, no quotes needed.
# systemd reads this file when the service starts, so every change needs
# \`sudo systemctl restart sank\` to take effect.
#
# These names are plain - no prefix. The server reads every one of them straight
# from the environment, so what you write here is what the code sees.
#
# deploy/deploy.env.example in the repo documents all of them, including the
# four that must stay absent from this file.

# The database. Absolute, and outside the release directories on purpose: the
# releases come and go, the data does not.
DB_PATH=$APP_DIR/data/sank.db

# The PIN pepper: 32 random bytes mixed into every PIN and password hash before
# it is stored, so a stolen database file cannot be attacked with a rainbow
# table of four-digit PINs.
#
# Generated fresh for this machine, once, by setup-server.sh. Re-running the
# script does NOT touch it.
#
# CHANGING THIS LINE INVALIDATES EVERY STORED PIN. Nobody can log in until the
# owner sets all of them again in /a. Copy it somewhere safe (a password
# manager) along with the backups, and never regenerate it casually. If you ever
# have to, generate it with:
#   openssl rand -hex 32
PIN_PEPPER=$PEPPER

# Trust the reverse proxy's forwarded headers when working out who is calling.
# ONLY safe because deploy/nginx.conf overwrites X-Real-IP and X-Forwarded-For
# with the real socket address. Without that file in front, this line lets any
# caller pick his own rate-limit bucket and his own lockout subject by sending
# the header himself. If nginx is ever removed, remove this line with it.
TRUST_PROXY=1

# Where the app answers as the outside world sees it - the address the owner
# types on his phone. Fill in the real domain once there is one.
PUBLIC_URL=https://sank.example.ba

# The port and interface. 127.0.0.1 means "this machine only" - the firewall
# does not open $APP_PORT, nginx is what publishes the app.
NITRO_PORT=$APP_PORT
NITRO_HOST=127.0.0.1

# NOT SET HERE, DELIBERATELY - see deploy/deploy.env.example:
#   SANK_DEV_ENROL   would hand an enrolled device cookie to the whole internet
#   BACKUP_DIR       cron owns backups on this machine (/etc/cron.d/sank-backup)
#   COOKIE_SECURE    defaults to true; only a dev laptop ever sets it to 0
EOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  info "wrote $APP_DIR/.env (mode 600) with a fresh PIN_PEPPER"
  info "set PUBLIC_URL to the real domain"
fi

# --- 5. the native module ----------------------------------------------------
# better-sqlite3 is not JavaScript, it is a compiled C++ addon: a .node file
# built for one operating system and one processor. `npm run build` on the Mac
# bundles a macOS build of it, which Linux cannot load - the app would start and
# die on its first database call with "invalid ELF header".
#
# So it is installed here, once, for this machine, and every release symlinks to
# it (deploy.sh does that). npm downloads a ready-made Linux binary; nothing is
# compiled and there is no build toolchain on this server.
step "Installing better-sqlite3 for this machine"
if [ -f "$APP_DIR/native/node_modules/better-sqlite3/package.json" ]; then
  installed="$(node -p "require('$APP_DIR/native/node_modules/better-sqlite3/package.json').version" 2>/dev/null || echo '?')"
  skip "better-sqlite3 $installed in $APP_DIR/native"
  info "if a deploy complains about a version mismatch, run:"
  info "  sudo -u $APP_USER -H npm --prefix $APP_DIR/native install better-sqlite3@<version>"
else
  cat > "$APP_DIR/native/package.json" <<'EOF'
{
  "name": "sank-native",
  "private": true,
  "description": "The compiled modules that cannot travel from a Mac to this Linux box. Every release symlinks better-sqlite3 to the copy here.",
  "dependencies": {}
}
EOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/native/package.json"
  sudo -u "$APP_USER" -H npm --prefix "$APP_DIR/native" install --no-audit --no-fund better-sqlite3 >/dev/null \
    || die "npm could not install better-sqlite3 in $APP_DIR/native"
  installed="$(node -p "require('$APP_DIR/native/node_modules/better-sqlite3/package.json').version")"
  info "better-sqlite3 $installed"
fi

# Prove it actually loads on this machine, now, rather than at 3am.
sudo -u "$APP_USER" -H node -e "
  const Database = require('$APP_DIR/native/node_modules/better-sqlite3');
  const db = new Database(':memory:');
  db.exec('create table t(x)');
  db.close();
" || die "better-sqlite3 is installed but does not load. Nothing else will work until that does."
info "it loads"

# --- 6. the systemd unit -----------------------------------------------------
step "Installing the systemd service"
WAS_RUNNING=0
if systemctl is-active --quiet "$SERVICE"; then WAS_RUNNING=1; fi
install -m 644 -o root -g root "$SCRIPT_DIR/sank.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
info "/etc/systemd/system/$SERVICE.service, enabled at boot"
if [ "$WAS_RUNNING" -eq 1 ]; then
  # Re-run on a live server: the file on disk changed, the running process did
  # not. Say so instead of leaving a difference nobody can see.
  warn "$SERVICE is running with the OLD unit file - run 'systemctl restart $SERVICE' when you are ready for it to pick this up"
else
  # Deliberately NOT started on a first run. There is no code deployed yet, so
  # `current` points at nothing and the service would fail ten times and give
  # up. The first deploy is what starts it. See README-DEPLOY.md.
  warn "the service is enabled but NOT started - that is on purpose, follow the first-run order in README-DEPLOY.md"
fi

# --- 7. the database backups -------------------------------------------------
step "Installing the database backups"
install -m 755 -o root -g root "$SCRIPT_DIR/backup-db.sh" "$APP_DIR/bin/backup-db.sh"
info "$APP_DIR/bin/backup-db.sh"

# Two schedules, one script, told apart by the two environment variables it
# reads.
#
# THE TIMES ARE LOCAL. cron uses the machine's clock zone, which step 2 set to
# Europe/Sarajevo, so these are the hours on the clock behind the bar. (The app
# process itself runs on TZ=UTC - that is set in sank.service and applies to the
# app's own in-process schedules, not to this file.)
#
#   0 12-23,0-4  hourly through opening hours, midday to four in the morning,
#                48 kept = the last two days of nights
#   0 5          once at five, after the last shift is settled and before the
#                new business day starts at six, 30 kept = a month
cat > /etc/cron.d/sank-backup <<EOF
# Installed by deploy/setup-server.sh. Do not edit here - edit
# deploy/setup-server.sh in the repo and run it again.
#
# sqlite3 .backup, which is safe to run while the app is writing. Times are
# Europe/Sarajevo (the machine's clock zone). Both lines log to
# $APP_DIR/backups/backup.log.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# hourly, 12:00-23:00 and 00:00-04:00, keeping the newest $HOURLY_KEEP
0 12-23,0-4 * * * $APP_USER SANK_BACKUP_DIR=$APP_DIR/backups/hourly SANK_BACKUP_KEEP=$HOURLY_KEEP $APP_DIR/bin/backup-db.sh >> $APP_DIR/backups/backup.log 2>&1

# daily at 05:00, keeping the newest $DAILY_KEEP
0 5 * * * $APP_USER SANK_BACKUP_DIR=$APP_DIR/backups/daily SANK_BACKUP_KEEP=$DAILY_KEEP $APP_DIR/bin/backup-db.sh >> $APP_DIR/backups/backup.log 2>&1
EOF
chmod 644 /etc/cron.d/sank-backup
touch "$APP_DIR/backups/backup.log"
chown "$APP_USER:$APP_USER" "$APP_DIR/backups/backup.log"
chmod 600 "$APP_DIR/backups/backup.log"
info "/etc/cron.d/sank-backup - hourly (keep $HOURLY_KEEP) + daily at 05:00 (keep $DAILY_KEEP), local time"
info "log: $APP_DIR/backups/backup.log"

# --- 8. nginx (only if it is already installed) ------------------------------
# nginx is the reverse proxy: the thing that answers on 443 with the TLS
# certificate and hands the request on to the app on 127.0.0.1:$APP_PORT. This
# script does not install it, because the config needs a real domain name and a
# certificate first - README-DEPLOY.md walks through both. If nginx is here, the
# file is copied into place but NOT enabled.
step "nginx site"
if [ -f "$SCRIPT_DIR/nginx.conf" ] && [ -d /etc/nginx/sites-available ]; then
  install -m 644 -o root -g root "$SCRIPT_DIR/nginx.conf" /etc/nginx/sites-available/sank
  info "/etc/nginx/sites-available/sank (copied, not enabled)"
  info "edit the domain in it, get a certificate, then:"
  info "  ln -s /etc/nginx/sites-available/sank /etc/nginx/sites-enabled/sank"
  info "  nginx -t && systemctl reload nginx"
else
  skip "nginx is not installed - see README-DEPLOY.md, 'A domain and https'"
fi

# --- 9. firewall -------------------------------------------------------------
# The order matters more than anything else in this script: ssh is allowed
# BEFORE the firewall comes up. Get that backwards and you lock yourself out of
# a machine you can only reach over ssh.
step "Firewall (ufw)"
# Which port(s) is ssh really on? Three sources, all of them allowed, because
# guessing wrong here is how you end up needing your provider's rescue console:
#   - 22, always, as the floor
#   - the port THIS session is connected on (SSH_CONNECTION's fourth field)
#   - every `Port` line in the sshd config, in case someone moved it and is
#     running this under sudo, where SSH_CONNECTION is not passed through
SSH_PORTS="22"
if [ -n "${SSH_CONNECTION:-}" ]; then
  detected="$(printf '%s' "$SSH_CONNECTION" | awk '{print $4}')"
  case "$detected" in
    ''|*[!0-9]*) : ;;
    *) SSH_PORTS="$SSH_PORTS $detected" ;;
  esac
fi
conf_ports="$(cat /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null \
  | awk '$1 == "Port" && $2 ~ /^[0-9]+$/ { print $2 }' | sort -u | tr '\n' ' ')"
SSH_PORTS="$SSH_PORTS $conf_ports"

allowed=""
for p in $SSH_PORTS; do
  case " $allowed " in *" $p "*) continue ;; esac
  ufw allow "$p/tcp" >/dev/null
  allowed="$allowed $p"
done
info "allowed ssh on port(s):$allowed"
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
info "allowed 80 and 443 for nginx"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
info "firewall up - your current session stays connected"
# Port 3100 is never opened. The app binds 127.0.0.1 anyway, so this is the
# second lock on the same door: everything from outside comes through nginx,
# which is the only thing that sets the forwarded headers TRUST_PROXY=1 makes
# the app believe.
info "port $APP_PORT is deliberately closed - the app is reached through nginx or an ssh tunnel"

# --- done --------------------------------------------------------------------
cat <<EOF

${C_OK}Server ready.${C_OFF}

Next, in this order (details in deploy/README-DEPLOY.md):

  1. Look over $APP_DIR/.env
       nano $APP_DIR/.env         (PUBLIC_URL - the real domain)
     The PIN pepper is already generated. Copy that line somewhere safe.
  2. Put a database in $APP_DIR/data/sank.db, from the Mac. The seeding
     script needs the source tree, which is not on this server, so the file is
     made on the Mac and copied up. NODE_ENV=production is what leaves the six
     people with NO PIN - the owner sets them in /a - instead of the dev PINs:
       rm -f /tmp/sank-prod.db
       DB_PATH=/tmp/sank-prod.db NODE_ENV=production npm run db:seed
       scp /tmp/sank-prod.db $APP_USER@<this-server>:$APP_DIR/data/sank.db
     The app starts fine without this and the health gate passes - it reports
     0 tables and 0 products - but there is no menu, no floor plan and nobody
     to log in as, so do it before the staff pick up a phone.
  3. Deploy, from the Mac:
       cp deploy/deploy.env.example deploy/.deploy.env
       \$EDITOR deploy/.deploy.env      (SSH_HOST=$APP_USER@<this-server>)
       ./deploy/deploy.sh
     That ships the build, starts the service and checks that it answers.
  4. A domain and https, when you have one: README-DEPLOY.md, last section.

Logs, any time:  sudo journalctl -u $SERVICE -f
Backups:         ls -lh $APP_DIR/backups/daily
EOF
