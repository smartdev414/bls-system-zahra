#!/usr/bin/env bash
# One-time setup of a fresh OVH server (Ubuntu 22.04/24.04). Run as root:
#
#   scp deploy/bootstrap-server.sh deploy/app.env.example root@SERVER:/root/
#   ssh root@SERVER 'bash /root/bootstrap-server.sh classroom.tms.webcam "ssh-ed25519 AAAA… github-actions"'
#
# Installs Docker, a firewall and automatic security updates, creates the
# "deploy" user the CI pipeline logs in as, and prepares /opt/bls.
set -euo pipefail

DOMAIN="${1:?usage: bootstrap-server.sh <domain> '<CI public ssh key>'}"
CI_KEY="${2:?usage: bootstrap-server.sh <domain> '<CI public ssh key>'}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/smartdev414/bls-system}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl ufw fail2ban unattended-upgrades

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# Firewall: SSH + web only. (Docker-published ports: only 80/443 are public;
# Postgres is bound to 127.0.0.1 in docker-compose.yml.)
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

dpkg-reconfigure -f noninteractive unattended-upgrades

# CI deploy user
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "$CI_KEY" /home/deploy/.ssh/authorized_keys 2>/dev/null || echo "$CI_KEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 750 -o deploy -g deploy /opt/bls /opt/bls/backups

if [ ! -f /opt/bls/.env ]; then
  cat > /opt/bls/.env <<EOF
DOMAIN=$DOMAIN
IMAGE_REPO=$IMAGE_REPO
POSTGRES_PASSWORD=$(openssl rand -hex 24)
# Optional off-site copy of nightly backups (a PRIVATE bucket):
BACKUP_S3_URI=
EOF
fi

if [ ! -f /opt/bls/app.env ]; then
  if [ -f /root/app.env.example ]; then cp /root/app.env.example /opt/bls/app.env; else touch /opt/bls/app.env; fi
  sed -i "s/^CRON_SECRET=.*/CRON_SECRET=$(openssl rand -hex 24)/" /opt/bls/app.env
fi
chown deploy:deploy /opt/bls/.env /opt/bls/app.env
chmod 600 /opt/bls/.env /opt/bls/app.env

# Nightly database backup at 03:15 server time
echo "15 3 * * * deploy /opt/bls/backup.sh >> /opt/bls/backups/backup.log 2>&1" > /etc/cron.d/bls-backup

echo
echo "Done. Next: fill in /opt/bls/app.env (the app's secrets), then run the CI deploy."
