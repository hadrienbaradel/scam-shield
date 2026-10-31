# Prudence on the OVH host (Ansible)

`make deploy` runs `playbook.yml` from a laptop against the host in `inventory.ini` (gitignored; copy
`inventory.example.ini`). The repository is private, so the host never clones it: `make deploy` ships
`git archive HEAD` of the local checkout (tracked files only; uncommitted changes are not deployed and
a warning says so) with its sha, and the playbook:

1. sets apt to never prompt (`DEBIAN_FRONTEND=noninteractive`, needrestart in automatic mode);
2. installs Docker Engine and the compose plugin from Docker's apt repository, with log rotation in
   `/etc/docker/daemon.json` (json-file, 5 files of 50 MB per container);
3. replaces `/opt/scam-shield` with the archive (rsync `--delete`, keeping `.infra/prod/.env` and the
   Postgres data in `.infra/prod/_volumes/postgres`) and writes `GIT_SHA`;
4. writes `.infra/prod/.env` (mode 600, root only, never logged): `MASTER_KEY` read from the laptop's
   `config/master.key`, `POSTGRES_PASSWORD` generated on the host at the first deploy and kept after,
   `BASE_URL=https://heyprudence.com`, `TRUST_PROXY=true`, `LOG_LEVEL=info`, `GIT_SHA`;
5. `docker compose up -d --build --wait` (the sha is the image's `APP_VERSION`), the migrations, then
   waits until `/api/health` answers `db: ok` with the deployed sha.

```bash
cp inventory.example.ini inventory.ini   # the host's address and user
make deploy                              # from the repository root
```

No Ansible vault: the only secret the laptop sends is the master key, read from `config/master.key`
(the team's encrypted credentials ride inside the image). `scam_shield_source=git` swaps the archive
for a clone of `scam_shield_repo` at `scam_shield_branch`, for when the repository is public.
