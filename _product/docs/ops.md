Keywords: deploy, server, ovh, meikit, ops, backup, restore, tailscale, magicdns, logs, cloudflared, domain, prod database, shared database

# Operations: Prudence on the OVH host

Production is one machine: Vlad's OVH dedicated server `meikit`, set up and redeployed by `make deploy` from a laptop
(Ansible, `.infra/prod/ansible/`). It runs the app and Postgres in Docker Compose (`.infra/prod/docker-compose.yml`), plus
cloudflared for heyprudence.com once the tunnel token is set. Laptops reach it over Tailscale at 100.127.78.127
(`meikit.tail2c017.ts.net` where MagicDNS is on); the host to deploy to is in `.infra/prod/ansible/inventory.ini`
(gitignored; its public address stays out of the repository). Docker, compose and CI basics: `_product/docs/infra.md`;
keys: `_product/docs/secrets.md`.

## The host

Ubuntu 26.04 LTS, kernel 7.0, 32 cores, 251 GB RAM, 878 GB on software RAID 1 (two NVMe drives), clock in UTC, swap off.
User `ubuntu` with sudo, SSH keys only, no root login. In North America (the address block is OVH Canada's), about 90 ms
round trip from Vlad's laptop in Europe (measured Oct 31). The machine is `meikit`, its OS hostname and its Tailscale
name: Vlad will try other projects on it.

Containers only (Vlad, Nov 1): everything a project runs lives in containers, through its compose file. The host
carries Docker and its compose plugin, Tailscale, the firewall (ufw, fail2ban) and the update tools (unattended-upgrades,
needrestart), plus what Ansible and those need (rsync, curl, gnupg, ca-certificates, python3-systemd), nothing else: no
Postgres client, no Node. A new need goes into the image or a compose service, never into apt on the host. So the dumps
and the restore run `pg_dump` and `pg_restore` inside the postgres container, and psql from a laptop goes through brew's
libpq or the postgres image (`make db-prod-shell`).

What Prudence owns on the box: 127.0.0.1:3000 (the app) and 127.0.0.1:5432 (Postgres), port 5432 served on the tailnet,
`/opt/scam-shield` and its compose project `scam-shield-prod`, `/var/backups/prudence` and the `prudence-backup` timer.
Another project on the box takes its own loopback ports, its own folder, its own compose project name and its own
served port. The host-wide parts (Docker's `daemon.json`, Tailscale, ufw, fail2ban, sshd, unattended upgrades) are set
by Prudence's playbook, so changing them changes them for every project there.
Code in `/opt/scam-shield` (the archive of the deployed commit, `GIT_SHA` names it), the compose `.env` next to the
compose file (root only, mode 600), Postgres data in `.infra/prod/_volumes/postgres`, dumps in `/var/backups/prudence`.

## Deploy

`make deploy` checks for ansible, `config/master.key` and the inventory, warns when tracked files have uncommitted
changes or HEAD is not on `origin/main`, ships `git archive HEAD` (the repository is private: the host never clones it),
then runs the playbook: base system, Docker and Tailscale, firewall, the code, the `.env` (the master key from your
`config/master.key`; the Postgres password generated on the host at the first deploy and kept), `docker compose up -d
--build --wait`, the migrations, and a wait until `/api/health` names the deployed sha with `db: ok`. About 70 s once the
host is set up. A deploy also stores `DATABASE_URL` (the shared database, below) in `config/credentials.enc` when the
credentials have none: commit it; `make db-prod-url` stores it again (a new password, another address).
A failed run names its task; what it did not replace keeps running (`make prod-status`). Extra Ansible flags:
`make deploy ANSIBLE_ARGS="--check --diff"`.

**Deploy often.** Every green main goes out the same day, small and often. After each deploy: the health version is the
new sha (the deploy waits for it; `make prod-status` shows it), `make logs` for a minute, Rollbar for new items (once
the account exists). Never deploy during the video recording. Rolling back is deploying the previous good commit
(`git checkout <sha>`, `make deploy`, back to main after); migrations stay additive until Nov 4, since a rollback
does not undo the schema.

## Logs and status

- `make logs`: the app's pino JSON lines (`LOG_LEVEL=info`), followed; `make prod-status`: deployed commit, containers,
  health, disk, last dump and the timer, the tailnet, ufw and fail2ban, memory and swap; `make prod-shell`: SSH in.
- Docker keeps 5 files of 50 MB per container (`/etc/docker/daemon.json`); journald is persistent, 2 GB at most;
  `sudo journalctl -u prudence-backup -t prudence-backup` shows one line per dump.

## Backups and restore

**A laptop database to production** (once, before anyone works on the shared database): on the laptop `make db-dump`
(pg_dump -Fc of the compose Postgres into `.runtime/backups/local-<date>.dump`), then `make backup-restore
FILE=.runtime/backups/local-<date>.dump` from the same laptop: the dump goes up over Tailscale SSH, production's data is
replaced after a pre-restore dump on the host, the app restarts and migrates if the dump is behind. Needs the machine
shared with you, your `inventory.ini` and the master key. Never restore an old laptop copy over fresher production data.

`prudence-backup.timer` runs `.infra/prod/scripts/backup.sh` every day at 03:00 host time (UTC): `pg_dump -Fc` inside
the Postgres container into `/var/backups/prudence/<date>.dump` (mode 600, read back with `pg_restore --list`), the last
30 kept, one journal line, a GET on `HEARTBEAT_BACKUP_URL` when it is set (`<url>/fail` on failure). The deploy takes the
first dump when none exists for the day. `make backup-now` dumps at once; `make backup-pull` copies the latest dump into
`.runtime/backups/` on your laptop (gitignored): that is the off-host copy, so pull after anything that matters.

Decision: full daily dumps, not incremental (WAL archiving, pgBackRest). The database holds a few megabytes (45 KB on
Oct 31), a dump takes a second and restores in one step; incremental backups would add a tool and a restore drill
for data that fits in a mail attachment. Revisit past a few GB or when losing a day of data becomes unacceptable.

Restore (not run so far): `make backup-restore FILE=2026-10-31.dump` (a dump on the host) or
`FILE=.runtime/backups/2026-10-31.dump` (sent up first); it asks you to type `restore`. What it runs on the host, by hand:

```bash
C="sudo docker compose -f /opt/scam-shield/.infra/prod/docker-compose.yml"
$C exec -T postgres pg_dump -U scam_shield -d scam_shield -Fc | sudo tee /var/backups/prudence/pre-restore-$(date +%F-%H%M%S).dump >/dev/null
$C stop app
sudo cat /var/backups/prudence/2026-10-31.dump | $C exec -T postgres pg_restore -U scam_shield -d scam_shield --clean --if-exists --no-owner --single-transaction
$C start app                                    # migrates at start: a dump older than the code gains the newer tables
curl -s http://127.0.0.1:3000/api/health
```

## The shared database

Decision (Vlad, Nov 1): both of us run on the production database by default, for the same data on both laptops.
Postgres is published on the host's 127.0.0.1:5432 only and reaches the tailnet through `tailscale serve`, on port 5432
of `meikit`, with the app's role `scam_shield` and the password generated on the host. `DATABASE_URL` in the team's
credentials is that database at the box's Tailscale address: `postgres://scam_shield:<password>@100.127.78.127:5432/scam_shield`.
MagicDNS is off on Vlad's tailnet, so the name would not resolve on his laptop; `PROD_DB_HOST` gives `make db-prod-url`
another host (`meikit.tail2c017.ts.net`), the one place the code names it being `scripts/prod.mjs`.

- `make server`: the laptop's app on the shared database, restarted on change, background jobs off (`WORKER=0`: the host
  runs them; a second scheduler would poll every mailbox twice and close the host's running jobs as interrupted). No
  compose Postgres starts. It migrates the shared database once before the app starts, then the restarts skip it
  (`MIGRATE=0`, so saving a migration file never applies it), prints which database it is on and what the migration did,
  and refuses a pending migration file that is not committed: production would keep a version nobody else has. When the
  address does not answer within 5 s it stops with one line: Tailscale not running on this laptop, or `meikit` not
  shared with you.
- `make server DB=dev`: this laptop's compose Postgres (`DEV_DATABASE_URL`, default `postgres://localhost:5432/scam_shield`),
  migrations, jobs on: the old default. Without the master key (a judge's clone) `make server` does the same by itself.
- `make db-prod-shell`: psql on the shared database (`brew install libpq`, or the postgres image when there is no psql;
  `echo 'select 1' | make db-prod-shell` works too). `make db-shell` stays on the local one. `make doctor` and `make gate`
  follow `make server` (`DB=dev` for the local one); `make start`, `make db-migrate` and the other Data targets always use
  the local one.
- Everything else that loads the credentials (`--import ./lib/credentials.js`: `npm run dev`, the scripts) opens the
  shared database too; put `DATABASE_URL=postgres://localhost/scam_shield` in front for the local one. Outside production
  the jobs stay off on a database on another machine unless `WORKER=1` (`src/config.js`). `WORKER` and `MIGRATE` never go
  in the credentials: the host's container would read them too.
- Migrations stay additive until Nov 4 (`_product/research/ops-services.md`): a laptop ahead of production migrates
  production at `make server` while the container still runs the older code, and a rollback does not undo a schema.
- Latency: from Europe each query pays 80 to 100 ms on the tailnet (from Boston much less), and a page runs 5 to 10 of them
  one after another; a Gmail backfill, an eval or the gate far more. `make server DB=dev` for anything query-heavy.
- People: a Google sign-in on a laptop stores that person's tokens in production, whose jobs then sync that mailbox. The
  local sign-in (`/dev/signin`) writes there too: a new person is a dev user in production data (a `users` row with
  `google_sub` `local:<email>`, a mailbox row for a senior, a session, an `audit_log` line), and while the laptop has no
  Google client the page lists every person in production and signs in as any of them. Keep it to local test people;
  the agreed demo path is the shared Google account (Linda's demo Gmail).
- Precedence keeps production on its own database: the container gets `DATABASE_URL` from compose (the `postgres`
  service), and the real environment always wins over the credentials, which the image carries too. `make server DB=dev`
  wins the same way, and the tests derive theirs from `TEST_DATABASE_URL` without ever loading the credentials
  (`tests/shared-database.test.js`).

## Tailscale

How the host joined (Nov 1): on the host, `sudo tailscale up --ssh --hostname=meikit` printed a login link, which Vlad
opened and approved with his own account; then `sudo tailscale serve --bg --tcp=5432 tcp://127.0.0.1:5432` (the playbook
runs the same whenever the node is Running, and keeps Tailscale SSH on). The machine is `meikit`, Tailscale address
100.127.78.127, full name `meikit.tail2c017.ts.net`. MagicDNS is off on Vlad's tailnet, so laptops use the address; the
name works on a tailnet that has MagicDNS on (Hadrien's, by default). The other way in is an auth key (Settings → Keys:
reusable off, ephemeral off, pre-authorized, tag `tag:meikit`) with `make deploy TS_AUTHKEY=tskey-auth-...` (or the key
in `.infra/prod/ansible/.tailscale-authkey`, gitignored; it is single use, delete the file after).

Tailscale SSH takes port 22 for everything that comes over the tailnet: `ssh ubuntu@100.127.78.127` is answered by
Tailscale ("Authentication checked with Tailscale SSH") against the policy's `ssh` rules, never by the host's OpenSSH, so
a public key in `authorized_keys` helps only over the public port. Ansible (`make deploy`) goes the same way.

Vlad's three console steps (login.tailscale.com/admin), in this order:

1. Access controls: add these entries to the policy file. Grants deny by default, so keep every rule the tailnet's other
   devices use (with the starter policy, its allow-all grant and its `autogroup:self` ssh rule) and add these to them:

```json
{
  "tagOwners": { "tag:meikit": ["autogroup:admin"] },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["tag:meikit"], "ip": ["tcp:5432", "tcp:22"] },
    { "src": ["autogroup:shared"], "dst": ["tag:meikit"], "ip": ["tcp:5432", "tcp:22"] }
  ],
  "ssh": [
    { "action": "accept", "src": ["autogroup:member"], "dst": ["tag:meikit"], "users": ["ubuntu"] }
  ]
}
```

   `autogroup:shared` is whoever accepted a share of one of your machines (Hadrien): `autogroup:member` does not include
   them in grants. In `ssh` rules, `autogroup:member` also covers a user a tagged machine is shared with (kb/1193).
2. Machines → meikit → ⋯ → Edit ACL tags → `tag:meikit`, after step 1. A tagged machine is no longer Vlad's own, so the
   starter `autogroup:self` ssh rule stops matching it and the rule above takes over; its key never expires. Check
   `ssh ubuntu@100.127.78.127 true` right after.
3. Machines → meikit → Share → Hadrien's email. He sees and reaches that machine only. The invite link is single use and
   expires after 30 days; sharing needs an admin on both sides (Hadrien owns his own tailnet). Tailscale SSH to a shared
   machine works only once it is tagged.

Closing public SSH (done Nov 1): `ansible_host=100.127.78.127` and `ssh_public=false` in `inventory.ini`, then `make
deploy`, which Ansible runs through Tailscale SSH like any session (file copies included, about 75 s). The first run left
port 22 open: the playbook's own `ssh_public: true` was a play var, which outranks the inventory in Ansible. Since
`1b4a4ed` the playbook's defaults sit in `inventory_defaults` and the inventory's value wins (`tests/prod-script.test.js`
checks it); the second run closed the port. Now ufw lets in `tailscale0` only, port 22 on the public address refuses,
`ssh ubuntu@100.127.78.127 true` works, and `make logs`, `make prod-status` and the rest go over the tailnet. The playbook
refuses to close port 22 unless the play came in over the tailnet. Until Vlad's steps 1 and 2 are done, two things can
stop a session: an untagged machine's key expires (180 days by default; Machines → meikit → ⋯ → Disable key expiry), and
the starter policy's `check` ssh rule wants a browser login every 12 h, so an SSH session, Ansible's included, waits on a
login link (`make prod-shell` first, open the link it prints, then deploy). Reopening port 22: `ssh_public=true` and `make deploy` over the tailnet; with no tailnet at all, only
OVH's rescue mode or KVM console gets in.

## Security on the host

ufw denies incoming except the tailnet (`tailscale0`); port 22 has been closed to the internet since Nov 1 (Closing
public SSH, above; `ssh_public=true` reopens it). Docker publishes ports past ufw, so every published port is on
127.0.0.1 (app 3000, Postgres 5432). fail2ban bans an address for 1 h after 5 failed SSH logins in 10 minutes (never the
tailnet). Unattended upgrades install security updates daily and never reboot: reboot by hand when a kernel update
waits (`/var/run/reboot-required`), not on a demo day. `rp_filter=1`, `tcp_syncookies=1`.

## The domain

cloudflared runs in the compose file (profile `cloudflared`, no published port) once `make deploy TUNNEL_TOKEN=...` has
stored the token in the host's `.env`; later deploys keep it, `TUNNEL_TOKEN=off` stops the tunnel. A token that does not
connect fails the deploy with what to do. The app runs with `BASE_URL=https://heyprudence.com` (sign-in and the Origin
check are built from it) and `TRUST_PROXY=true`, so the rate limits key on the visitor's address. Once it is live,
Better Stack's HTTP monitor belongs on https://heyprudence.com/api/health; `prudence-demo` (demo.heyprudence.com to a
laptop) stays for takes from a laptop.

## For Hadrien

1. Tailscale: install it (tailscale.com/download) and sign in with your own account, which creates your own tailnet with
   you as its owner (you do not join Vlad's). Accept Vlad's share invite from the email (single use, 30 days). `tailscale
   status` must list `meikit` (100.127.78.127; `meikit.tail2c017.ts.net` works too, MagicDNS being on in a new tailnet).
2. DNS, in the heyprudence.com Cloudflare account: Zero Trust → Networks → Tunnels, create a tunnel named `prudence`
   (cloudflared, Docker) with public hostnames `heyprudence.com` and `www.heyprudence.com`, both to the service
   `http://app:3000`. Delete any existing DNS record for the apex and for `www` first (DNS → Records), or Cloudflare
   refuses the hostname. A new tunnel, not a hostname on `prudence-demo`: one tunnel with two connectors splits visitors
   between two databases. Add a Redirect Rule (Rules → Redirect Rules) from `www.heyprudence.com/*` to
   `https://heyprudence.com/${1}`: the app accepts writes from `https://heyprudence.com` only. Send the tunnel token (in
   the install command, after `--token`) to Vlad privately: never in the repository, never in a chat with an agent.
3. Google Cloud Console → the OAuth client: add `https://heyprudence.com/auth/google/callback` to the redirect URIs.
4. `git pull`, then `make server`: the app on the shared database (your `config/master.key` opens the credentials), jobs
   off, migrated first. `make server DB=dev` for your local one, and for anything query-heavy. `make db-prod-shell` for
   psql (`brew install libpq`, or Docker). "Does not answer": `tailscale status`, step 1.
5. Deploying from your laptop: `brew install ansible`, your own `.infra/prod/ansible/inventory.ini` from the example
   (`ansible_host=100.127.78.127`, or `meikit.tail2c017.ts.net`), the master key you have, then `make deploy`. The port 22
   you reach is Tailscale SSH, which lets you in once Vlad's steps 1 and 2 are done (the ssh rule and the tag); until then
   Vlad deploys. A public key of yours only works over the public port, closed since Nov 1 (Vlad can reopen it:
   `ssh_public=true`, your key in `authorized_keys`, `make deploy`).
