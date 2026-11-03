#!/usr/bin/env bash
# CheatWall VM setup and update. Run it from the project folder as root: sudo ./setup_service.sh
# First run installs everything. Every later run updates the code and restarts the service.
# Optional: CHEATWALL_DOMAIN=example.com sudo -E ./setup_service.sh   (installs Caddy for HTTPS on that domain)
# Logs: journalctl -u cheatwall.service -f      Log file copy: /var/lib/cheatwall/logs/cheatwall.log (rotated, 10 MB x 5)
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run as root: sudo ./setup_service.sh" >&2; exit 1; fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/cheatwall
DATA_DIR=/var/lib/cheatwall
ENV_DIR=/etc/cheatwall
ENV_FILE="$ENV_DIR/cheatwall.env"
SVC_USER=cheatwall
BROWSERS=/opt/cheatwall-browsers
PORT=3000
log() { echo "==> $*"; }

log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates rsync

log "Node 24"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

log "Service user and folders"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$APP_DIR" "$DATA_DIR/logs" "$ENV_DIR" "$BROWSERS"
chown -R "$SVC_USER":"$SVC_USER" "$DATA_DIR"

log "Copy the app (data, logs and .env are never touched)"
rsync -a --delete --exclude node_modules --exclude .git --exclude data --exclude logs --exclude out --exclude .env "$SRC"/ "$APP_DIR"/
cd "$APP_DIR"
npm ci --omit=dev

log "Chromium for poster rendering"
PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" npx playwright-core install --with-deps chromium
chmod -R a+rX "$BROWSERS"

log "Environment file (created once, never overwritten)"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  sed -i "s|^DATA_DIR=.*|DATA_DIR=$DATA_DIR|; s|^LOG_DIR=.*|LOG_DIR=$DATA_DIR/logs|; s|^PORT=.*|PORT=$PORT|" "$ENV_FILE"
  [[ -n "${CHEATWALL_DOMAIN:-}" ]] && sed -i "s|^TRUST_PROXY=.*|TRUST_PROXY=true|" "$ENV_FILE"
  echo "PLAYWRIGHT_BROWSERS_PATH=$BROWSERS" >> "$ENV_FILE"
  echo "Created $ENV_FILE with PROVIDER=fake. Edit it to add a real key and switch PROVIDER."
fi
chown root:"$SVC_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

log "systemd units"
cat > /etc/systemd/system/cheatwall.service <<UNIT
[Unit]
Description=CheatWall poster service
After=network.target

[Service]
User=$SVC_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/server.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/cheatwall-backup.service <<UNIT
[Unit]
Description=CheatWall nightly database backup

[Service]
Type=oneshot
User=$SVC_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning scripts/backup.ts
UNIT

cat > /etc/systemd/system/cheatwall-backup.timer <<UNIT
[Unit]
Description=CheatWall nightly backup

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

if [[ -n "${CHEATWALL_DOMAIN:-}" ]]; then
  log "Caddy for HTTPS on $CHEATWALL_DOMAIN"
  if ! command -v caddy >/dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
  printf '%s {\n  reverse_proxy 127.0.0.1:%s\n}\n' "$CHEATWALL_DOMAIN" "$PORT" > /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
else
  echo "No CHEATWALL_DOMAIN set: the service listens on 127.0.0.1:$PORT only. Put a proxy with HTTPS in front before going public."
fi

log "Start and check"
systemctl daemon-reload
systemctl enable cheatwall.service cheatwall-backup.timer
systemctl restart cheatwall.service
systemctl start cheatwall-backup.timer
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "CheatWall is up: http://127.0.0.1:$PORT"
    echo "Logs: journalctl -u cheatwall.service -f"
    exit 0
  fi
  sleep 1
done
echo "Service did not answer in 20 s. See: journalctl -u cheatwall.service -n 50" >&2
exit 1
