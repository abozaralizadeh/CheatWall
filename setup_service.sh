#!/usr/bin/env bash
# CheatWall VM setup and update. Run it from the project folder as root. Every later run updates and restarts.
#
# Standalone (a VM of its own):
#   sudo ./setup_service.sh                              installs Node, Chromium and the service
#   sudo CHEATWALL_DOMAIN=example.com ./setup_service.sh  also installs Caddy for HTTPS on that domain
#   Logs: journalctl -u cheatwall.service -f   Log file: /var/lib/cheatwall/logs/cheatwall.log (rotated, 10 MB x 5)
#
# Shared VM, behind an nginx you already run, under a path such as /cheatwall/:
#   sudo SERVICE_NAME=idea-cheatwall PORT=8603 BASE_PATH=/cheatwall/ \
#        NGINX_SNIPPET=/etc/nginx/max.d/cheatwall.conf ./setup_service.sh
#   No apt, no Caddy, no firewall, no certbot. It runs the app in place from this folder as the folder's owner,
#   keeps ./.env, and writes two nginx files: NGINX_SNIPPET and /etc/nginx/conf.d/<service>-limits.conf.
#   If nginx -t fails, both are put back as they were. Your server block must include the snippet folder.
#   Logs: journalctl -u <service> -f   Log file: ./logs/cheatwall.log (rotated, 10 MB x 5)
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run as root: sudo ./setup_service.sh" >&2; exit 1; fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log() { echo "==> $*"; }
fail() { echo "STOP: $*" >&2; exit 1; }

if [[ -n "${NGINX_SNIPPET:-}" ]]; then
  # ---------------------------------------------------------------- shared VM mode
  SERVICE="${SERVICE_NAME:-cheatwall}"
  [[ "$SERVICE" =~ ^[A-Za-z0-9_-]+$ ]] || fail "SERVICE_NAME may only use letters, digits, - and _."
  BASE="${BASE_PATH:-/cheatwall/}"
  [[ "$BASE" =~ ^/([A-Za-z0-9._~-]+/)+$ ]] || fail "BASE_PATH must look like /cheatwall/ (a slash at both ends)."
  ROOT="$SRC"
  cd "$ROOT"
  RUN_USER="${SERVICE_USER:-$(stat -c %U "$ROOT")}"
  [[ "$RUN_USER" != root ]] || fail "The project folder is owned by root. Clone it as a normal user, or set SERVICE_USER."
  RUN_GROUP="$(id -gn "$RUN_USER")"
  as_user() { sudo -u "$RUN_USER" -H env PATH="$PATH" "$@"; }

  log "Checking what this VM already has (nothing gets installed)"
  missing=()
  for cmd in node npm nginx curl systemctl sudo; do command -v "$cmd" >/dev/null || missing+=("$cmd"); done
  [[ ${#missing[@]} -eq 0 ]] || fail "Missing on this VM: ${missing[*]}. Install them yourself, then run this again."
  [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]] || fail "Node 24 or newer is needed, found $(node -v)."
  grep -qE 'include\s+/etc/nginx/conf\.d/\*\.conf' /etc/nginx/nginx.conf || fail "nginx.conf does not include conf.d/*.conf, so the rate limit zone can't be added. Nothing changed."
  echo "    node $(node -v), $(nginx -v 2>&1)"

  if [[ -d .git && "${GIT_PULL:-true}" == true ]]; then
    log "Latest code"
    # Fast forward only, so local changes are never thrown away. Set GIT_PULL=false to skip.
    as_user git pull --ff-only || echo "    could not fast forward, using what is here"
  fi

  log "Settings in $ROOT/.env (kept between runs, only the lines below are set)"
  if [[ ! -f .env ]]; then
    cp .env.example .env
    echo "    created .env from .env.example with PROVIDER=fake. Add the Azure values and set PROVIDER=azure."
  fi
  chown "$RUN_USER:$RUN_GROUP" .env
  chmod 600 .env
  set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
  [[ -n "${PORT:-}" ]] && set_env PORT "$PORT"
  set_env HOST 127.0.0.1
  set_env BASE_PATH "$BASE"
  # Only nginx on this machine may tell us the visitor's address.
  set_env TRUST_PROXY 127.0.0.1
  set_env DATA_DIR "$ROOT/data"
  set_env LOG_DIR "$ROOT/logs"
  APP_PORT="$(grep -E '^PORT=' .env | cut -d= -f2)"
  [[ "$APP_PORT" =~ ^[0-9]+$ ]] || fail "PORT is not set. Pass PORT=8603 (or put it in .env)."

  log "Dependencies"
  as_user npm ci --omit=dev
  mkdir -p data logs
  chown -R "$RUN_USER:$RUN_GROUP" data logs

  log "Chromium for poster rendering"
  CHROME="$(grep -E '^CHROME_PATH=' .env | cut -d= -f2 || true)"
  if [[ -z "$CHROME" ]]; then
    for c in /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser; do
      [[ -x "$c" ]] && { CHROME="$c"; break; }
    done
  fi
  if [[ -z "$CHROME" ]]; then
    # A browser download into this folder. It needs no root and touches nothing outside the project.
    set_env PLAYWRIGHT_BROWSERS_PATH "$ROOT/.browsers"
    as_user env PLAYWRIGHT_BROWSERS_PATH="$ROOT/.browsers" npx playwright-core install chromium
    CHROME="$(as_user env PLAYWRIGHT_BROWSERS_PATH="$ROOT/.browsers" node -e "import('playwright-core').then(m => console.log(m.chromium.executablePath()))")"
  fi
  set_env CHROME_PATH "$CHROME"
  if ! as_user node -e "import('playwright-core').then(async ({ chromium }) => { const b = await chromium.launch({ executablePath: process.argv[1] }); await b.close(); })" "$CHROME" >/tmp/"$SERVICE"-chrome-test.log 2>&1; then
    tail -n 15 /tmp/"$SERVICE"-chrome-test.log >&2
    fail "Chromium at $CHROME can't start, most likely missing system libraries. This script doesn't run apt on a shared VM. If you're happy to add them: sudo npx playwright-core install-deps chromium (or apt install chromium), then run this again."
  fi
  echo "    $CHROME starts fine"

  log "systemd units: $SERVICE.service and $SERVICE-backup.timer"
  NODE_BIN="$(command -v node)"
  cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=CheatWall poster service ($SERVICE)
After=network.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$ROOT
EnvironmentFile=$ROOT/.env
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning src/server.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
  cat > "/etc/systemd/system/$SERVICE-backup.service" <<UNIT
[Unit]
Description=CheatWall nightly database backup ($SERVICE)

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$ROOT
EnvironmentFile=$ROOT/.env
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning scripts/backup.ts
UNIT
  cat > "/etc/systemd/system/$SERVICE-backup.timer" <<UNIT
[Unit]
Description=CheatWall nightly backup ($SERVICE)

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

  log "nginx: $BASE -> 127.0.0.1:$APP_PORT"
  ZONE="${SERVICE//-/_}"
  ZONE_FILE="/etc/nginx/conf.d/$SERVICE-limits.conf"
  mkdir -p "$(dirname "$NGINX_SNIPPET")"
  had_snippet=false; had_zone=false
  [[ -f "$NGINX_SNIPPET" ]] && { cp "$NGINX_SNIPPET" "$NGINX_SNIPPET.bak"; had_snippet=true; }
  [[ -f "$ZONE_FILE" ]] && { cp "$ZONE_FILE" "$ZONE_FILE.bak"; had_zone=true; }
  cat > "$ZONE_FILE" <<NGINX
# $SERVICE: rate limit zone, used by $NGINX_SNIPPET. Written by setup_service.sh in $ROOT
limit_req_zone \$binary_remote_addr zone=$ZONE:10m rate=5r/s;
NGINX
  cat > "$NGINX_SNIPPET" <<NGINX
# $SERVICE: written by setup_service.sh in $ROOT
location = ${BASE%/} { return 301 $BASE; }
location $BASE {
    limit_req zone=$ZONE burst=30 nodelay;
    limit_req_status 429;
    client_max_body_size 16k;
    proxy_pass http://127.0.0.1:$APP_PORT/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Connection "";
    # Switching a poster's colours renders it again, which can take a while.
    proxy_read_timeout 120s;
}
NGINX
  if nginx -t 2>/tmp/"$SERVICE"-nginx-test.log; then
    rm -f "$NGINX_SNIPPET.bak" "$ZONE_FILE.bak"
  else
    cat /tmp/"$SERVICE"-nginx-test.log >&2
    if $had_snippet; then mv "$NGINX_SNIPPET.bak" "$NGINX_SNIPPET"; else rm -f "$NGINX_SNIPPET"; fi
    if $had_zone; then mv "$ZONE_FILE.bak" "$ZONE_FILE"; else rm -f "$ZONE_FILE"; fi
    fail "nginx -t failed, so both nginx files were put back as they were. The service was not restarted."
  fi

  log "Start and check"
  systemctl daemon-reload
  systemctl enable "$SERVICE.service" "$SERVICE-backup.timer"
  systemctl restart "$SERVICE.service"
  systemctl start "$SERVICE-backup.timer"
  systemctl reload nginx
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
      echo "CheatWall is up on 127.0.0.1:$APP_PORT, served at $BASE"
      echo "Logs: journalctl -u $SERVICE -f   (file copy: $ROOT/logs/cheatwall.log)"
      exit 0
    fi
    sleep 1
  done
  fail "The service did not answer in 20 s. See: journalctl -u $SERVICE -n 50"
fi

# ---------------------------------------------------------------- standalone mode
APP_DIR=/opt/cheatwall
DATA_DIR=/var/lib/cheatwall
ENV_DIR=/etc/cheatwall
ENV_FILE="$ENV_DIR/cheatwall.env"
SVC_USER=cheatwall
BROWSERS=/opt/cheatwall-browsers
PORT=3000

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
rsync -a --delete --exclude node_modules --exclude .git --exclude data --exclude logs --exclude out --exclude .env --exclude .browsers "$SRC"/ "$APP_DIR"/
cd "$APP_DIR"
npm ci --omit=dev

log "Chromium for poster rendering"
PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" npx playwright-core install --with-deps chromium
chmod -R a+rX "$BROWSERS"

log "Environment file (created once, never overwritten)"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  sed -i "s|^DATA_DIR=.*|DATA_DIR=$DATA_DIR|; s|^LOG_DIR=.*|LOG_DIR=$DATA_DIR/logs|; s|^PORT=.*|PORT=$PORT|" "$ENV_FILE"
  [[ -n "${CHEATWALL_DOMAIN:-}" ]] && sed -i "s|^TRUST_PROXY=.*|TRUST_PROXY=127.0.0.1|" "$ENV_FILE"
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
