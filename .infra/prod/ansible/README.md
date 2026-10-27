# Scam Shield on a host (Ansible)

**Status: a skeleton, untested on a real host.** It has only been linted and read; the first real run will need fixes.

`playbook.yml` sets up one Debian or Ubuntu host: Docker Engine and the compose plugin from Docker's apt repository,
the repository cloned at `scam_shield_branch` into `/opt/scam-shield`, the compose environment written from the vault
(`.infra/prod/.env`, mode 600, never logged), `docker compose up -d --build --wait` on `.infra/prod/docker-compose.yml`,
the migrations, then a GET on `/api/health`.

```bash
cp inventory.example.ini inventory.ini                     # your host and user (inventory.ini is ignored by git)
ansible-vault create group_vars/scam_shield/vault.yml      # vault_master_key, vault_postgres_password
ansible-playbook -i inventory.ini playbook.yml --ask-vault-pass
```

- `vault_master_key` is the content of `config/master.key` (64 hex characters); it opens the `config/credentials.enc`
  baked into the image. `vault_postgres_password`: letters and digits only (it is embedded in `DATABASE_URL`).
- The app listens on `127.0.0.1:3000` on the host: put a TLS reverse proxy (Caddy, nginx) in front and set
  `scam_shield_base_url` to the public `https://` URL, or Google sign-in will not work.
- Data: `/opt/scam-shield/.infra/prod/_volumes/postgres`. Back it up before `docker compose down -v`.
- Redeploy: run the playbook again (it pulls the branch and rebuilds). Logs: `docker compose -f ... logs -f app`.
