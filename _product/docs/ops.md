Keywords: deploy, server, ovh, ops, backup, restore, tailscale, logs, cloudflared, domain, prod database

# Operations: Prudence on the OVH host

Production is one machine: Vlad's OVH dedicated server, set up and redeployed by `make deploy` from a laptop (Ansible,
`.infra/prod/ansible/`). It runs the app and Postgres in Docker Compose (`.infra/prod/docker-compose.yml`), plus cloudflared
for heyprudence.com once the tunnel token is set. Its address lives only in `.infra/prod/ansible/inventory.ini`
(gitignored; ask Vlad). Docker, compose and CI basics: `_product/docs/infra.md`; keys: `_product/docs/secrets.md`.

## The host

Ubuntu 26.04 LTS, kernel 7.0, 32 cores, 251 GB RAM, 878 GB on software RAID 1 (two NVMe drives), clock in UTC, swap off.
User `ubuntu` with sudo, SSH keys only, no root login. In North America (the address block is OVH Canada's), about 90 ms
round trip from Vlad's laptop in Europe (measured Oct 31).
Code in `/opt/scam-shield` (the archive of the deployed commit, `GIT_SHA` names it), the compose `.env` next to the
compose file (root only, mode 600), Postgres data in `.infra/prod/_volumes/postgres`, dumps in `/var/backups/prudence`.

## Deploy

`make deploy` checks for ansible, `config/master.key` and the inventory, warns when tracked files have uncommitted
changes or HEAD is not on `origin/main`, ships `git archive HEAD` (the repository is private: the host never clones it),
then runs the playbook: base system, Docker and Tailscale, firewall, the code, the `.env` (the master key from your
`config/master.key`; the Postgres password generated on the host at the first deploy and kept), `docker compose up -d
--build --wait`, the migrations, and a wait until `/api/health` names the deployed sha with `db: ok`. About 70 s once the
host is set up. The first deploy from a laptop also stores `PROD_DATABASE_URL` in `config/credentials.enc`: commit it.
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

## The shared database: two modes

Postgres is published on the host's 127.0.0.1:5432 only and reaches the tailnet through `tailscale serve`, as
`prudence-prod:5432`, with the app's role `scam_shield` and the generated password (`PROD_DATABASE_URL`).
- `make server` (`DB=local`, the default): the laptop's own Postgres, as always. Daily work stays here.
- `make server DB=prod`: the laptop app on the shared database with `WORKER=0` (production alone runs the jobs); it
  refuses when the checkout has migrations production has not applied (the app migrates at start). `make
  db-prod-shell`: psql on it (`brew install libpq`, or Docker). Tests never use it: `TEST_DATABASE_URL` stays local.
- Latency: every query crosses the tailnet, and a page runs 5 to 10 of them one after another, so from a laptop across
  the ocean each page takes up to a second longer (a Gmail backfill far more). Use it when the shared data is the point:
  looking at what testers did, seeding the demo account.

## Tailscale

1. Vlad creates an auth key in the admin console (Settings → Keys): reusable off, ephemeral off, pre-authorized, tag
   `tag:prudence-prod` if the policy below is in first (a tagged node never expires; untagged, disable key expiry on it).
2. `make deploy TS_AUTHKEY=tskey-auth-...` (or the key in `.infra/prod/ansible/.tailscale-authkey`, gitignored): the host
   joins as `prudence-prod` with Tailscale SSH and serves Postgres on 5432. The key is single use; delete the file after.
3. Access policy (Access controls; grants deny by default, so this replaces the allow-all starter policy: keep any rule
   the tailnet's other devices need). Tailscale SSH into a node owned by someone else needs the tag:

```json
{
  "tagOwners": { "tag:prudence-prod": ["autogroup:admin"] },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["tag:prudence-prod"], "ip": ["tcp:5432", "tcp:22"] }
  ],
  "ssh": [
    { "action": "accept", "src": ["autogroup:member"], "dst": ["tag:prudence-prod"], "users": ["ubuntu"] }
  ]
}
```

4. Check `tailscale ssh ubuntu@prudence-prod` from a laptop, then close public SSH: in `inventory.ini` set
   `ansible_host=prudence-prod` and `ssh_public=false`, and `make deploy`. The playbook refuses to close port 22 unless it
   came in over the tailnet. The firewall lets everything in on `tailscale0`, so plain `ssh ubuntu@prudence-prod` works too.

## Security on the host

ufw denies incoming except 22/tcp (public until step 4 above) and the tailnet; Docker publishes ports past ufw, so every
published port is on 127.0.0.1 (app 3000, Postgres 5432). fail2ban bans an address for 1 h after 5 failed SSH logins in
10 minutes (never the tailnet). Unattended upgrades install security updates daily and never reboot: reboot by hand
when a kernel update waits (`/var/run/reboot-required`), not on a demo day. `rp_filter=1`, `tcp_syncookies=1`.

## The domain

cloudflared runs in the compose file (profile `cloudflared`, no published port) once `make deploy TUNNEL_TOKEN=...` has
stored the token in the host's `.env`; later deploys keep it, `TUNNEL_TOKEN=off` stops the tunnel. A token that does not
connect fails the deploy with what to do. The app runs with `BASE_URL=https://heyprudence.com` (sign-in and the Origin
check are built from it) and `TRUST_PROXY=true`, so the rate limits key on the visitor's address.

## For Hadrien

1. Cloudflare Zero Trust → Networks → Tunnels: create a tunnel named `prudence` (cloudflared, Docker), with public
   hostnames `heyprudence.com` and `www.heyprudence.com`, both to the service `http://app:3000`. Add a Redirect Rule
   (Rules → Redirect Rules) from `www.heyprudence.com/*` to `https://heyprudence.com/${1}`: the app accepts writes from
   `https://heyprudence.com` only. Send the tunnel token (in the install command, after `--token`) to Vlad privately:
   never in the repository, never in a chat with an agent.
2. Google Cloud Console → the OAuth client: add `https://heyprudence.com/auth/google/callback` to the redirect URIs.
3. Accept Vlad's Tailscale invite, install Tailscale (tailscale.com/download), `tailscale up`, and check that
   `tailscale status` lists `prudence-prod`.
4. Deploying from your laptop: `brew install ansible`, your own `.infra/prod/ansible/inventory.ini` from the example with
   `ansible_host=prudence-prod` (Tailscale SSH once you are in the tailnet), and the master key you already have. Until
   then Vlad can add your public key: `authorized_keys` in `.infra/prod/ansible/group_vars/scam_shield.yml` (gitignored),
   then `make deploy`.
