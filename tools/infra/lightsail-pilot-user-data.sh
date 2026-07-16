#!/bin/bash
set -euo pipefail

dnf update -y
dnf install -y docker nginx
systemctl enable --now docker nginx

install -d -m 0700 /opt/phos
cat >/opt/phos/README.txt <<'PHOS_README'
PH-OS pilot host bootstrap is complete.

Next steps:
1. Write /opt/phos/.env from approved runtime secrets.
2. Pull the approved PH-OS container image.
3. Install tools/infra/ph-os-nginx.conf as /etc/nginx/conf.d/ph-os.conf.
4. Run the container with --env-file /opt/phos/.env and publish only 127.0.0.1:3000:3000.

Do not store long-lived AWS access keys on this host.
Do not expose the application container port directly; Nginx is the sole trusted XFF writer.
PHOS_README
