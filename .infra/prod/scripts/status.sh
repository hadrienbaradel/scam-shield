#!/usr/bin/env bash
# make prod-status: the OVH host at a glance, never a secret (run as root over SSH; _product/docs/ops.md).
APP_DIR=${APP_DIR:-/opt/scam-shield}
DEST=${BACKUP_DIR:-/var/backups/prudence}
compose=(docker compose -f "$APP_DIR/.infra/prod/docker-compose.yml")

echo "== deployed commit: $(cat "$APP_DIR/GIT_SHA" 2>/dev/null || echo 'unknown (no GIT_SHA file)')"
echo "== containers"
"${compose[@]}" ps --all --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}' 2>&1
echo "== health (GET 127.0.0.1:3000/api/health)"
curl -sS -m 5 http://127.0.0.1:3000/api/health 2>&1; echo
echo "== disk"
df -h / | tail -n 1
du -sh "$APP_DIR/.infra/prod/_volumes/postgres" "$DEST" 2>/dev/null
echo "== backups"
last=$(find "$DEST" -maxdepth 1 -name '*.dump' -printf '%f\n' 2>/dev/null | sort | tail -n 1)
echo "latest dump: ${last:-none}"
journalctl -u prudence-backup.service -t prudence-backup -n 1 -o cat --no-pager 2>/dev/null
systemctl list-timers prudence-backup.timer --no-pager 2>/dev/null | sed -n '1,2p'
echo "== tailnet"
if command -v tailscale >/dev/null; then tailscale status --self=true --peers=false 2>&1 | head -n 3; tailscale serve status 2>&1 | head -n 3; else echo "tailscale not installed"; fi
echo "== firewall"
ufw status | sed -n '1,12p'
fail2ban-client status sshd 2>&1 | grep -E 'Currently|Total' | sed 's/^[ |`-]*//'
echo "== memory and swap"
free -g | sed -n '1,3p'
swapon --show | sed 's/^/  /'; [ -z "$(swapon --show)" ] && echo "swap: off"
