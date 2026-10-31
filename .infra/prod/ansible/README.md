# Prudence on the OVH host (Ansible)

`make deploy` runs `playbook.yml` from a laptop against the host in `inventory.ini` (gitignored; copy
`inventory.example.ini`). The repository is private, so the host never clones it: `make deploy` ships
`git archive HEAD` of the local checkout (tracked files only; uncommitted changes are not deployed and
a warning says so) with its sha, and the playbook:

1. sets apt to never prompt (`DEBIAN_FRONTEND=noninteractive`, needrestart in automatic mode), turns on
   unattended security upgrades (no automatic reboot, a daily apt cleanup), keeps the journal on disk
   (`Storage=persistent`, 2 GB at most), sets `rp_filter=1`, `tcp_syncookies=1` and `vm.swappiness=0`,
   turns swap off (now and in `/etc/fstab`), and sets sshd to keys only, no root login, no X11
   forwarding (reloaded, then a new SSH connection must log in before the play goes on);
2. installs Docker Engine and the compose plugin from Docker's apt repository, with log rotation in
   `/etc/docker/daemon.json` (json-file, 5 files of 50 MB per container), and Tailscale from Tailscale's;
3. joins the tailnet as `prudence-prod` with Tailscale SSH, only when an auth key is given (`make deploy
   TS_AUTHKEY=...` or the gitignored `.tailscale-authkey` here; written to a root-only file for
   `tailscale up` and deleted after), then serves Postgres to the tailnet (`tailscale serve --bg
   --tcp=5432 tcp://127.0.0.1:5432`); without a key the join is skipped and the summary says so;
4. sets ufw (deny incoming, allow outgoing, 22/tcp open while `ssh_public` is true, everything on
   `tailscale0`), enabled only once the SSH rule exists, and fail2ban's sshd jail (a 1 h ban after 5
   failures in 10 minutes). Docker publishes ports past ufw, so the compose file publishes on 127.0.0.1 only
   (the app on 3000, Postgres on 5432). `ssh_public=false` in `inventory.ini` closes 22 to the internet,
   and the playbook refuses unless it runs over the tailnet (`ansible_host=prudence-prod`);
5. replaces `/opt/scam-shield` with the archive (rsync `--delete`, keeping `.infra/prod/.env` and the
   Postgres data in `.infra/prod/_volumes/postgres`) and writes `GIT_SHA`;
6. writes `.infra/prod/.env` (mode 600, root only, never logged): `MASTER_KEY` read from the laptop's
   `config/master.key`, `POSTGRES_PASSWORD` generated on the host at the first deploy and kept after,
   `BASE_URL=https://heyprudence.com`, `TRUST_PROXY=true`, `LOG_LEVEL=info`, `GIT_SHA`;
7. `docker compose up -d --build --wait` (the sha is the image's `APP_VERSION`), the migrations, then
   waits until `/api/health` answers `db: ok` with the deployed sha;
8. installs the daily backup: `prudence-backup.timer` (03:00 host time) runs `.infra/prod/scripts/backup.sh`
   (`pg_dump -Fc` into `/var/backups/prudence/<date>.dump`, mode 600, 30 days kept, one journal line,
   `HEARTBEAT_BACKUP_URL` pinged when set), and takes the first dump unless one from today exists.

```bash
cp inventory.example.ini inventory.ini   # the host's address and user
make deploy                              # from the repository root
make deploy TS_AUTHKEY=tskey-auth-...    # once: joins the tailnet (the key is single use)
make logs | make prod-status | make prod-shell
make backup-now | make backup-pull       # a dump now; the latest one copied to .runtime/backups/
```

No Ansible vault: the laptop sends the master key, read from `config/master.key` (the team's encrypted
credentials ride inside the image), and a Tailscale auth key when one is given. After the playbook,
`make deploy` stores `PROD_DATABASE_URL` in the team's credentials once, piped from the host's `.env`.
`scam_shield_source=git` swaps the archive for a clone of `scam_shield_repo` at `scam_shield_branch`, for
when the repository is public.
