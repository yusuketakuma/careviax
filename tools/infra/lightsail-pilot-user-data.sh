#!/bin/bash
set -euo pipefail

dnf update -y
dnf install -y docker
systemctl enable --now docker

install -d -m 0700 /opt/phos
cat >/opt/phos/README.txt <<'PHOS_README'
PH-OS pilot host bootstrap is complete.

Next steps:
1. Write /opt/phos/.env from approved runtime secrets.
2. Pull the approved PH-OS container image.
3. Run the container with --env-file /opt/phos/.env and publish port 80 to 3000.

Do not store long-lived AWS access keys on this host.
PHOS_README
