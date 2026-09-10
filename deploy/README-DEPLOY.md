# Putting Šank on a server

This is written for someone who has never logged into a server before. Every
command is meant to be copy-pasted, in order, and it says which machine you are
typing on: **your Mac** or **the server**.

Bosnian glosses are in brackets the first time a word appears, because most of
these words have no good Bosnian equivalent and you will hear them in English
anyway.

> **Šank is not a fiscal device.** It issues no receipts, prints nothing and
> records nothing for tax purposes; it is an internal accountability and stock
> tool. *Ovo nije fiskalni uređaj.* Nothing on this page changes that, and
> nothing on this page should be described to anyone as a cash register.

---

## What you are about to do

Šank runs on your Mac while you build it. That works until you close the laptop:
the waiters' phones lose the server, the owner's dashboard goes dark, and
nothing can be locked. A **VPS** (*virtualni server* — someone else's computer
in a data centre, yours for ~€5/month) is a Linux machine that never sleeps.

The end state:

```
   your Mac                          the VPS (Ubuntu 24.04)
   ────────                          ──────────────────────
   npm run build   ──rsync──▶   /opt/sank/releases/20260909-181500/
                                 /opt/sank/current ──▶ (that one)
                                 systemd runs: node .output/server/index.mjs
                                   ├── the waiters' phones on /konobar
                                   └── the owner's dashboard on /admin
                                 nginx on 443 ──▶ 127.0.0.1:3100
                                 /opt/sank/data/sank.db     ← the till
                                 /opt/sank/backups/         ← hourly + nightly
```

You do this once (steps 1–8), and after that every new version is one command:
`./deploy/deploy.sh`.

Time needed: about 45 minutes, most of it waiting for downloads, plus another
half hour the day you add a domain.

---

## Before you start

- A VPS with **Ubuntu 24.04**, 1 GB RAM is plenty. Hetzner CX22, DigitalOcean,
  Contabo — any of them. Write down its **IP address**, e.g. `203.0.113.10`.
- Your provider will ask for an **SSH key** when creating the machine (step 1
  makes one).
- The Šank repo on your Mac, with `npm run build` working.
- A domain name, eventually. Not needed for steps 1–8; the app runs on the IP
  address through a tunnel until you have one. It **is** needed before any
  waiter uses it for real, because the session cookie only travels over https.

---

## 1. Make an SSH key (on your Mac)

An SSH key is a pair of files: a private one that stays on your Mac forever and
a public one you hand out. It replaces a password, and it cannot be guessed.

Check whether you already have one:

```bash
ls ~/.ssh/id_ed25519.pub
```

If that prints a filename, skip ahead. If it says "No such file":

```bash
ssh-keygen -t ed25519 -C "vedran-mac"
```

Press Enter three times (default location; a passphrase is optional — if you set
one, macOS will remember it in the Keychain after the first use).

Now print the **public** half:

```bash
cat ~/.ssh/id_ed25519.pub
```

Copy that whole line (starts with `ssh-ed25519`, ends with `vedran-mac`) into
your provider's "SSH keys" box when you create the server. Never paste the file
without `.pub` — that one is the secret.

---

## 2. Log in for the first time (on your Mac)

```bash
ssh root@203.0.113.10
```

Replace the IP with yours, here and everywhere below.

The first time, ssh asks:

```
The authenticity of host '203.0.113.10' can't be established.
ED25519 key fingerprint is SHA256:...
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

Type `yes` and Enter. That question is ssh saying "I have never seen this
machine before" — normal on a brand-new server, and you will never see it again
for this one.

You are now on the server. The prompt changes to something like
`root@ubuntu-2gb-fsn1:~#`. Type `exit` and Enter to come back to your Mac. Do
that now, and notice the prompt change back — knowing which machine you are on
is the whole skill.

---

## 3. Copy the deploy folder up and run the setup (both machines)

**On your Mac**, from the project directory:

```bash
scp -r deploy root@203.0.113.10:/root/
```

`scp` is "copy over ssh". The whole folder has to go: the setup script installs
`sank.service`, `backup-db.sh` and `nginx.conf` from next to itself.

**Then log in and run it:**

```bash
ssh root@203.0.113.10
bash /root/deploy/setup-server.sh
```

It takes a few minutes and prints what it is doing. It:

1. installs Node 22, `sqlite3`, `rsync`, `ufw`
2. sets the machine's clock zone to **Europe/Sarajevo**
3. creates the `sank` user (the app runs as it, not as root) and copies your ssh
   key to it, so you can log in as `sank` too
4. creates `/opt/sank/{releases,data,backups,native,bin}` and writes
   `/opt/sank/.env` with a **freshly generated PIN pepper**
5. installs `better-sqlite3` compiled for Linux (your Mac's copy cannot run
   here — see "Why is there a `native` folder?")
6. installs the systemd service and **enables** it (starts at boot) but does
   **not** start it now — on purpose, there is no code deployed yet
7. installs the two database backups into cron
8. copies the nginx site into place, without enabling it
9. raises the firewall: ssh, 80 and 443 open, everything else closed

It is safe to run again later; that is how you update the service file, the
backup script or the cron file.

**Two words from that list.**

**systemd** is Ubuntu's process supervisor. It is what "runs the app" means on a
server: it starts `node .output/server/index.mjs` at boot, starts it again
within five seconds if it ever dies, and collects everything the app prints into
one place you read with `journalctl`. There is no `npm run dev` window to leave
open and nothing to restart by hand after a reboot.

**ufw** is the firewall (*zaštitni zid*) — a list of which ports the machine
answers on at all. After the setup it is ssh, 80 and 443, and nothing else.
Port 3100, where the app actually listens, is **closed from the outside on
purpose** and stays that way forever.

---

## 4. The server's settings (on the server)

```bash
nano /opt/sank/.env
```

`nano` is the simple text editor. Arrow keys to move, type, then **Ctrl+O**,
Enter to save and **Ctrl+X** to quit.

The file is already written and mostly correct. One line needs you:

```
PUBLIC_URL=https://sank.example.ba
```

- **`PUBLIC_URL`** is the address the outside world uses — the one the café
  types into a phone. Put the real domain in the day you have one, and make it
  the same host as `server_name` in `nginx.conf`.

There is **no notification setting anywhere in this file, and no step in this
guide that sets one up.** Šank sends nothing outward: no Telegram bot, no
e-mail, no push. Everything worth the owner's attention is written to the
database as it happens, and he reads it in the app — the *Dnevnik*, and the
attention list on *Puls*. Nothing to register, no token to paste, and no café
data leaving this machine.

`deploy/deploy.env.example` in the repo documents every line of this file,
including the four variables that must **not** appear in it. Read it once.

> ### ⚠️ `PIN_PEPPER` — generated once, then never touched
>
> The pepper is 32 random bytes mixed into every PIN before it is hashed, so a
> stolen database file cannot be attacked with a pre-computed table of all ten
> thousand four-digit PINs. `setup-server.sh` generated one for this machine and
> put it in the file.
>
> **Changing that line invalidates every stored PIN.** Not "logs everybody out"
> — invalidates: no PIN in the database verifies any more, and nobody can get
> in until the owner sets all of them again in `/admin`. Copy the line into a
> password manager now, next to wherever you keep the backups, and leave it
> alone.
>
> The same is true of an **empty** pepper, which is the trap: an empty one is a
> perfectly working configuration that says nothing, and filling it in three
> months later has exactly the effect above. `deploy.sh` warns if it ever finds
> that line empty.
>
> Unlike some Nuxt projects, **none of these names has a prefix**. The server
> reads `PIN_PEPPER`, `DB_PATH`, `TRUST_PROXY` and `PUBLIC_URL` straight from
> the environment, so what you write is what the code sees. `nuxt.config.ts`
> declares three of them under `runtimeConfig`
> as well — that block is server-only and is there as the one written list of
> every secret the app may hold, not as a second way to set them.

---

## 5. The database (on your Mac, then the server)

The app creates its own database file on first boot and runs every migration —
but an **empty** database has no venue, no tables and no products in it. Nothing
crashes: `/api/health` needs no venue and answers `{"ok":true,"tables":0,
"products":0}`, so the deploy in step 6 goes green either way, and it prints a
loud warning when the products count is zero. What you get is a running app with
no menu, no floor plan and nobody to log in as. So the file gets made first.

The seeding script needs the source tree, which is not on the server, so the
database is made on your Mac and copied up:

```bash
rm -f /tmp/sank-prod.db
DB_PATH=/tmp/sank-prod.db NODE_ENV=production npm run db:seed
scp /tmp/sank-prod.db sank@203.0.113.10:/opt/sank/data/sank.db
```

Note the user changed to `sank` — the file has to belong to the user the app
runs as.

> **`NODE_ENV=production` is the important half of that command.** Without it,
> the seed installs the development PINs — Amar 1111, Lejla 2222, and an admin
> password of `lounge`. With it, the six people are created with **no PIN at
> all** and the script prints `postavi PIN-ove u /admin`: nobody can log in until
> the owner sets each PIN himself, on the real server. That is the only way a
> default PIN never reaches a café.
>
> It also means the pepper mismatch between your Mac and the server does not
> matter here — nothing was hashed on the Mac. Every PIN this database ever
> holds will be hashed on the server, with the server's pepper.

Sanity-check what landed, **on the server**:

```bash
sqlite3 /opt/sank/data/sank.db "select count(*) from tables; select count(*) from products;"
```

Two numbers, both above zero. That is what the health gate is about to ask for.

### If you are moving an existing database up

The same rule as any other copy of this file: **never `cp` it while the app is
running**. The database is in **WAL mode** (*Write-Ahead Logging*) — recent
writes go into a second file next to it, `sank.db-wal`, and SQLite folds them
back into the main file later. A plain copy of `sank.db` taken mid-service is a
copy as of some arbitrary moment, missing everything still in the WAL, and
nothing warns you. You find out months later.

`.backup` is SQLite's own snapshot command and always gives a complete,
consistent file:

```bash
sqlite3 data/sank.db ".backup /tmp/sank-transfer.db"
scp /tmp/sank-transfer.db sank@203.0.113.10:/opt/sank/data/sank.db
```

---

## 6. The first deploy (on your Mac)

```bash
cp deploy/deploy.env.example deploy/.deploy.env
nano deploy/.deploy.env      # put in SSH_HOST=sank@203.0.113.10
./deploy/deploy.sh
```

That builds the app, uploads it, points `current` at it, restarts the service
and checks that `/api/health` answers. It prints each step. The last line, if
all went well:

```
Deployed. release 20260909-181500 is live and answering.
```

If the health check fails, the script rolls back on its own and tells you what
it did — see "How a deploy works" below.

---

## 7. Check it is really working (on the server)

```bash
ssh sank@203.0.113.10
systemctl status sank
```

You want `Active: active (running)`. Press `q` to get out of that view.

```bash
journalctl -u sank -f
```

That is the live log. **Ctrl+C** stops watching (it does not stop the app).

And ask the app directly:

```bash
curl http://127.0.0.1:3100/api/health
```

You should get `{"ok":true,"tables":27,"products":14}` or thereabouts.

---

## 8. Opening it before there is a domain (on your Mac)

The firewall does not open port 3100, and it should not. Until nginx and a
domain are in front of it (see "A domain and https" below), the app is meant to
be reachable only from the server itself. Reach it through an **SSH tunnel**
(*tunel* — a private wire through your ssh connection):

```bash
ssh -L 3100:127.0.0.1:3100 sank@203.0.113.10
```

Leave that window open and go to <http://localhost:3100> in your browser. You
are looking at the server's app through the tunnel. Close the window and the
tunnel is gone.

(If your Mac's own dev server is running, port 3100 is taken — use
`-L 3200:127.0.0.1:3100` and open <http://localhost:3200>.)

**This is for you, not for the staff.** Over plain http the session cookie is
`secure` and will not be sent at all, so signing in through the tunnel does not
work — that is the cookie doing its job, not a bug. The tunnel is for looking at
the health route, the logs and the shape of a page. Real use waits for the
domain.

---

## Everyday use

### Deploy a new version (on your Mac)

```bash
./deploy/deploy.sh
```

That is the whole thing. It never touches the database.

Options you will rarely need:

| Option | What it does |
| --- | --- |
| `--skip-build` | ship whatever is already in `.output/` |
| `--no-start` | upload and flip `current`, but leave the service alone |
| `--help` | print the header of the script |

### How a deploy works

Worth understanding once, because it is what lets you deploy during opening
hours without fear.

A **symlink** (*prečica* — a shortcut) is a file whose whole content is the name
of another path. `/opt/sank/current` is one. It points at a release directory,
and release directories never change once written:

```
/opt/sank/releases/20260908-193000/    yesterday
/opt/sank/releases/20260909-181500/    today
/opt/sank/current ─────────────────▶   today
```

So the deploy is:

1. **build** on your Mac — `npm run build` produces `.output/`;
2. **upload** into a brand new `releases/<timestamp>/` — nothing live is touched
   yet, and if the upload dies half way you have a junk directory nobody points
   at;
3. **flip** `current` to the new directory. This is one atomic rename: there is
   no instant where `current` is missing or half-written;
4. **restart** the service — systemd starts Node in the new directory. This is
   also when the migrations run: the app runs them itself at startup, so there
   is no separate migrate step and no window where the code and the schema
   disagree;
5. **the health gate** — `deploy.sh` curls `/api/health` on the server, up to 15
   times, 2 seconds apart. It demands a real answer: HTTP 200 **and** a body
   containing the row counts. That body is the proof, not the process being
   alive: those counts come out of a query, so getting them back means the
   database opened, the migrations ran and the triggers applied. A process that
   is "up" but answering nothing does not count as healthy, and neither does one
   booted onto an unreadable or empty database.

Going back to yesterday's code is therefore re-pointing a shortcut — a
millisecond, and it cannot half-fail — instead of copying files back over a
running app.

### When a deploy fails

If the gate never gets a real answer, `deploy.sh`:

1. prints the last 40 log lines from the server,
2. points `current` back at the **previous** release,
3. restarts the service,
4. health-checks again and tells you whether the old version came back,
5. exits with an error, leaving the broken release on disk so you can look at it.

Two things it cannot do for you:

- **The very first deploy has nothing to roll back to.** It says so plainly and
  tells you where to look — usually a missing value in `/opt/sank/.env`, or a
  database that was never seeded.
- **A rollback does not un-run a migration.** The old code comes back; the
  database keeps its new shape. That is harmless for a migration that adds a
  column and is not harmless for one that renames or drops one — which is why
  migrations in this project only ever add.

### Roll back by hand (on the server)

```bash
ls -1t /opt/sank/releases          # newest first
ln -sfn /opt/sank/releases/<the-one-you-want> /opt/sank/.current.new
mv -Tf /opt/sank/.current.new /opt/sank/current
sudo systemctl restart sank
```

`cat /opt/sank/releases/<one>/RELEASE` tells you what each release is: the git
commit, who built it, and which better-sqlite3 it wants.

### Restart, stop, start (on the server)

```bash
sudo systemctl restart sank
sudo systemctl stop sank
sudo systemctl start sank
```

If the service ever refuses to start again after ten quick failures, systemd
gives up on purpose so a broken app does not spin forever. Clear that with:

```bash
sudo systemctl reset-failed sank
sudo systemctl start sank
```

---

## A domain and https

Until this is done the app is reachable only through the ssh tunnel, and nobody
can actually sign in. This is the step that puts Šank in the waiters' hands.

**A reverse proxy** (*obratni proxy*) is a program that answers the internet on
your behalf and passes each request on to something local. nginx is one. The app
listens on `127.0.0.1:3100` — "this machine only" — and nginx is the piece that
listens on 443, holds the certificate, and hands requests over.

**TLS** is the `s` in https: the encryption that stops the café's wifi, the ISP
or anybody on the same network from reading a session cookie or a PIN in flight.
A **certificate** (*certifikat*) is the file that proves to a browser that this
server really is that domain. Let's Encrypt gives them away free and `certbot`
fetches and renews them for you.

**On the server**, once the domain's A record points at the server's IP address:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/sank      # replace sank.example.ba
sudo ln -s /etc/nginx/sites-available/sank /etc/nginx/sites-enabled/sank
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d sank.example.ba
```

`setup-server.sh` already put `deploy/nginx.conf` at that path if nginx was
installed when you ran it; if it was not, copy it up now. Read the comments in
it — it is written to be read.

`nginx -t` checks the syntax. **Never reload without it**: nginx refuses to
start on a bad config, and a reload that fails on a running server is much
easier to fix than a start that fails on a stopped one.

Then, in `/opt/sank/.env`:

```
PUBLIC_URL=https://sank.example.ba
```

```bash
sudo systemctl restart sank
```

### The two lines in that file that are load-bearing

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
```

Behind a proxy, every request arrives at the app from `127.0.0.1` — nginx is
the only thing talking to it. The app would see one caller for the whole world,
and the rate limiter and the PIN lockout both bucket **by caller**. So
`/opt/sank/.env` sets `TRUST_PROXY=1`, which tells the app to believe those two
headers instead of the socket address.

A header, though, is only ever whatever somebody wrote in it. The usual recipe
for the second line is `$proxy_add_x_forwarded_for`, which **appends** to
whatever the client sent — and then anybody could send
`X-Forwarded-For: 1.2.3.4`, get a fresh rate-limit bucket per guess, and walk
straight through the PIN lockout. `$remote_addr` is the address of the socket
nginx is actually talking to. It is not a header; it cannot be forged.

**`TRUST_PROXY=1` is only safe because that file exists.** The two arrive
together and they leave together: if nginx is ever removed or replaced with
something else in front, take `TRUST_PROXY=1` out of `.env` in the same breath.

---

## Backups

### What runs, and when

`setup-server.sh` installed `/etc/cron.d/sank-backup`. **cron** is the Unix
scheduler: a file of lines saying "at this time, run this". Two lines here, both
running the same script with different settings:

| When | Where it lands | Kept |
| --- | --- | --- |
| every hour, 12:00–23:00 and 00:00–04:00 | `/opt/sank/backups/hourly/` | 48 |
| every day at 05:00 | `/opt/sank/backups/daily/` | 30 |

**Those times are Sarajevo time.** cron uses the machine's clock zone, which
`setup-server.sh` set to `Europe/Sarajevo`. (The *app's own* process runs on
`TZ=UTC` — that is set in `sank.service`, so its in-process schedules mean the
same thing across a daylight-saving change, and it converts to local time itself
for the business day. Two different clocks on one machine, on purpose.)

Hourly through opening hours means at most an hour of rounds can ever be lost.
The daily at 05:00 lands after the last shift is settled and before the new
business day starts at 06:00, so each daily file is one clean night.

Both use `sqlite3 <db> ".backup <dest>"`, which is SQLite's own online backup:
it reads a consistent snapshot **including the WAL**, while waiters are still
locking rounds, and never blocks the floor. `cp sank.db elsewhere.db` cannot do
that and must never be used on a live database.

Each fresh copy is verified with `PRAGMA quick_check` before it counts as a
backup — a backup nobody has ever opened is a rumour. If a copy fails the check,
the script deletes it and shouts, because that usually means the database on
disk is damaged.

Where to look:

```bash
tail -20 /opt/sank/backups/backup.log
ls -lh /opt/sank/backups/daily
```

Run one right now if you want to see it work:

```bash
/opt/sank/bin/backup-db.sh
```

### ⚠️ A backup file is a key to the till

A backup is the whole database: **every PIN hash, every payment, every waiter's
numbers, every line of the Dnevnik**. Anybody holding one can read all of it, at
leisure, off the server, forever. It is not "a copy of some data" — it is the
café's books and its keys in one file.

So:

- the directory is mode **700** and every file in it **600** — owner only,
  nobody else on the machine, not even the group;
- a backup **never goes into Viber, WhatsApp, Telegram, Messenger or an email
  attachment**. Not once, not "just to look at something". Those files sit on
  someone else's servers forever and get forwarded by accident;
- it moves by `scp`, to a machine that is somebody's own, and it is deleted from
  the laptop when it is no longer needed;
- the owner is told this in one sentence in `OWNER_RUNBOOK.md`, in Bosnian:
  *čuvaj je kao ključ od kase.*

The same goes for `PIN_PEPPER`. A backup plus the pepper is the strongest form
of both.

### Copying a backup down (on your Mac)

```bash
scp sank@203.0.113.10:/opt/sank/backups/daily/sank-20260909-050000.db ~/Downloads/
```

Off-box copies are a good idea — a VPS can be lost with everything on it — and
doing it by hand once a week is fine. Wherever they land is subject to
everything above.

### Restoring — into a scratch path first

**Never restore straight over the live database.** Restore into a scratch path
(*a throwaway file nobody is using*), open it, look at it, and only then decide.

**On the server:**

```bash
mkdir -p /tmp/restore
cp /opt/sank/backups/daily/sank-20260909-050000.db /tmp/restore/check.db
sqlite3 /tmp/restore/check.db 'pragma quick_check;'
```

You want exactly `ok`. Then look at what is actually in it:

```bash
sqlite3 /tmp/restore/check.db "select count(*) from orders; select max(created_at) from orders;"
```

That last timestamp tells you how far the copy reaches — which is the whole
question you are asking of a backup.

Only if both answers are what you expect, put it in place:

```bash
sudo systemctl stop sank
cp /opt/sank/data/sank.db /opt/sank/data/sank.db.before-restore
cp /tmp/restore/check.db /opt/sank/data/sank.db
rm -f /opt/sank/data/sank.db-wal /opt/sank/data/sank.db-shm
sudo systemctl start sank
curl http://127.0.0.1:3100/api/health
```

The `rm` of the two sidecars matters: they belong to the database you just
replaced, and leaving them next to a different file is how you get a database
that will not open. The `cp` of the old file before overwriting it is your
undo — keep it until you are sure.

Clean up `/tmp/restore` when you are done. It is a copy of the till.

---

## Reading the logs (journalctl)

Everything the app prints goes to the **journal**, systemd's log. There is no
log file to rotate and no `tail -f app.log`.

| Command | What you get |
| --- | --- |
| `journalctl -u sank -f` | live, as it happens (**Ctrl+C** to stop) |
| `journalctl -u sank -n 100` | the last 100 lines |
| `journalctl -u sank --since "1 hour ago"` | the last hour |
| `journalctl -u sank --since today` | since midnight |
| `journalctl -u sank -p err` | errors only |
| `journalctl -u sank -g "shift"` | only lines matching "shift" |

`-u sank` means "the unit called sank" — without it you get the logs of the
entire machine.

Anything longer than a screen opens in a pager: arrows scroll, `q` quits, `G`
jumps to the end. Add `--no-pager` to just dump it.

Disk usage of the journal, and a trim if it ever matters:

```bash
journalctl --disk-usage
sudo journalctl --vacuum-time=14d
```

The backups keep their own log, separately, because cron is not the app:

```bash
tail -20 /opt/sank/backups/backup.log
```

---

## Why is there a `native` folder?

`better-sqlite3` is not JavaScript. It is a C++ addon compiled into a `.node`
file for one operating system and one processor — and `npm run build` on your
Mac bundles the **macOS** build of it. Copied to Linux, it fails to load with
`invalid ELF header`, and the app dies on its first database call.

So `setup-server.sh` installs a Linux copy once, into
`/opt/sank/native/node_modules/better-sqlite3`, and every deploy:

1. leaves the Mac copy out of the upload,
2. symlinks the release's `better-sqlite3` to the Linux one,
3. **loads it, from inside the release, before flipping `current`** — so a
   problem here stops the deploy instead of taking the app down.

If you ever change the `better-sqlite3` version in `package.json`, `deploy.sh`
notices the major-version mismatch and gives you the one command to fix it:

```bash
sudo -u sank -H npm --prefix /opt/sank/native install better-sqlite3@<version>
```

### The two `.sql` files that also travel outside the build

`.output/` is everything the bundler could see. It cannot see a `.sql` file read
at runtime, and the app reads two of those from disk at **every boot**, relative
to its working directory:

- `server/database/migrations/*.sql` — drizzle runs these,
- `server/database/triggers.sql` — re-applied on every start.

`deploy.sh` uploads both alongside the build, into
`<release>/server/database/`, which is exactly where the app looks from
`WorkingDirectory=/opt/sank/current`. It checks they exist before it builds and
checks they arrived before it flips.

This matters more than it sounds. The triggers are what make the ledger tables
**append-only** — the SQLite rules that refuse an UPDATE on a payment or a
DELETE on a shift summary. A release running without them is a release where a
bad query goes through silently and the books can be edited. That is why the
deploy would rather stop than ship one.

---

## Rehearse it once, with the owner

Do this the week before the café starts using it, with the owner watching, on
the real server. It takes twenty minutes and it is the difference between "there
are backups" and "we have restored one".

Tick off all five:

1. **Deploy.** Run `./deploy/deploy.sh` from your Mac and let it finish.
   *Expect:* `Deployed. release <stamp> is live and answering.`

2. **Watch the health gate pass.** In the deploy output, find the
   `Health gate: http://127.0.0.1:3100/api/health` step and the
   `healthy after N attempt(s)` line under it, with the body printed after it.
   *That line is the app answering from the server, with real row counts.*

3. **Break the health check deliberately.** On the server, put a wrong database
   path in the env file so the app cannot open it, and deploy again:

   ```bash
   ssh sank@203.0.113.10
   sudo cp /opt/sank/.env /opt/sank/.env.ok
   sed -i 's#^DB_PATH=.*#DB_PATH=/opt/sank/data/nope/sank.db#' /opt/sank/.env
   exit
   ./deploy/deploy.sh
   ```

   *Expect:* the gate counts to 15, prints 40 log lines, and says
   `ROLLING BACK to /opt/sank/releases/<the previous one>`.

4. **Watch the rollback land.** The same run should end with
   `ROLLED BACK. The previous release is live again and answering.` and a
   non-zero exit. Check the app really is up:

   ```bash
   ssh sank@203.0.113.10 'curl -s http://127.0.0.1:3100/api/health'
   ```

   Then put the file back and restart:

   ```bash
   ssh sank@203.0.113.10
   sudo mv /opt/sank/.env.ok /opt/sank/.env
   sudo systemctl restart sank
   curl http://127.0.0.1:3100/api/health
   ```

   *The point of this step:* the owner sees with his own eyes that a bad deploy
   during opening hours puts yesterday's working version back by itself.

5. **Restore yesterday's backup into a scratch path and check it.**

   ```bash
   ssh sank@203.0.113.10
   mkdir -p /tmp/rehearsal
   cp "$(ls -1t /opt/sank/backups/daily/*.db | head -1)" /tmp/rehearsal/check.db
   sqlite3 /tmp/rehearsal/check.db 'pragma quick_check;'
   sqlite3 /tmp/rehearsal/check.db "select count(*) from orders; select max(created_at) from orders;"
   rm -rf /tmp/rehearsal
   ```

   *Expect:* `ok`, a plausible number of orders, and a timestamp from the night
   the file is named after. **Do not skip the `rm -rf`** — that scratch copy is
   a key to the till.

And one thing to say out loud to the owner while he is standing there, because
it is the answer to the only question that matters on a bad night: **if the
application does not work, take the paper pad and keep working. Nothing is
lost.** The rounds get typed in afterwards. That sentence is the whole of
`OWNER_RUNBOOK.md` — print it and tape it inside a cupboard behind the bar.

---

## When it breaks

| What you see | What it usually means |
| --- | --- |
| `Permission denied (publickey)` | your ssh key is not on the server for that user. Log in as root and check `/opt/sank/.ssh/authorized_keys`. |
| deploy stops at "Checking the server" | `setup-server.sh` was never run, or `SSH_HOST` points somewhere else. |
| `better-sqlite3 major version mismatch` | run the `npm --prefix /opt/sank/native install` line it prints. |
| `invalid ELF header` in the log | a macOS build of `better-sqlite3` got in. Deploy again; the pre-flight load test catches it. |
| `triggers.sql not found` in the log | the release is missing `server/database/triggers.sql`. Deploy again — the script checks for it now. Do **not** work around it by editing the app; a release without triggers is a release with editable books. |
| deploy warns `the database has NO products` | the database is empty — step 5 was skipped, or `DB_PATH` points at a different file from the one you copied up. The app is running; nobody can order on it. |
| Service restarts in a loop | `journalctl -u sank -n 50`. Usually `/opt/sank/.env` (a bad value), or `/opt/sank/data/sank.db` missing or unreadable. |
| Nobody can log in with their PIN, and it worked yesterday | `PIN_PEPPER` in `/opt/sank/.env` changed or was filled in after the PINs were set. If you have the old value, put it back and restart. If you do not, the owner sets every PIN again in `/admin`. |
| Everyone is rate-limited or locked out at once | the app is seeing one caller for the whole world: nginx is not setting the two headers, or `TRUST_PROXY=1` is missing from `.env`. Both, or neither. |
| Sign-in seems to work and then does nothing | you are on plain http. The session cookie is `secure` and is never sent over http. Finish the domain and certificate step. |
| `413 Request Entity Too Large` on an upload | `client_max_body_size` in `nginx.conf`. |
| nginx will not reload | `sudo nginx -t` and read the line number it prints. |
| No new backups in `backups/` | `tail /opt/sank/backups/backup.log`, then `systemctl status cron`. Check the disk with `df -h`. |
| `no space left on device` | `du -sh /opt/sank/*`, then lower `KEEP_RELEASES`, or lower the backup retention in `setup-server.sh` and run it again. |
| The app is down and you cannot fix it now | **Tell the staff to use the paper pad.** Nothing is lost; the rounds get typed in afterwards. Then read the logs without a clock running. |

Anything that leaves you stuck: `journalctl -u sank -n 100 --no-pager`, and read
from the bottom up.
