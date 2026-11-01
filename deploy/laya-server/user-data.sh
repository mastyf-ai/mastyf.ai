#!/bin/bash
# First-boot setup for the shared Laya server (Amazon Linux 2023, x86_64). provision.sh fills in
# the __PLACEHOLDERS__. Its output goes to /var/log/cloud-init-output.log, so never echo a
# parameter value here, and never turn on set -x.
set -euo pipefail

REGION=__REGION__
LAYA_PACKAGE='laya[serve] @ git+https://github.com/Koustav-github/laya.git@ffc142012af63d015fa19f05f29f9c5ff329a2cc'
CADDY_VERSION=2.11.7
CADDY_SHA512=a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7

param() {
  aws ssm get-parameter --region "$REGION" --name "/mastyf/laya/shared/$1" --with-decryption \
    --query Parameter.Value --output text
}

dnf install -y python3.11 git tar

# The loaded model takes about 3.5 GB. On this 4 GB instance, without swap, the first calls froze
# the whole machine.
dd if=/dev/zero of=/swapfile bs=1M count=6144 status=none
chmod 600 /swapfile
mkswap /swapfile >/dev/null
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/90-laya.conf
sysctl -qw vm.swappiness=10

useradd --system --home-dir /opt/laya/home --shell /sbin/nologin laya
install -d -o laya -g laya /opt/laya/home
install -d /opt/laya/model /etc/laya

python3.11 -m venv /opt/laya/venv
/opt/laya/venv/bin/pip install --quiet --upgrade pip
/opt/laya/venv/bin/pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu
/opt/laya/venv/bin/pip install --quiet "$LAYA_PACKAGE" fastapi uvicorn python-multipart huggingface_hub

# The token lives only in this command's environment; the service never gets it.
HF_TOKEN="$(param hf-token)" /opt/laya/venv/bin/hf download "$(param model-repo)" \
  --revision "$(param model-revision)" --local-dir /opt/laya/model --quiet >/dev/null
rm -rf /opt/laya/model/.cache
chmod -R a+rX /opt/laya/model

umask 077
cat > /etc/laya/env <<EOF
LAYA_API_KEY=$(param secret)
LAYA_EXTRA_MODELS='{"mastyf": "/opt/laya/model"}'
LAYA_MODELS=mastyf
LAYA_DEFAULT_MODEL=mastyf
LAYA_HOST=127.0.0.1
LAYA_PORT=8077
LAYA_THREADS=2
LAYA_DEVICE=cpu
EOF
chmod 600 /etc/laya/env
umask 022

echo '__LAYA_SERVICE_B64__' | base64 -d > /etc/systemd/system/laya-serve.service

curl -fsSLo /tmp/caddy.tar.gz \
  "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz"
echo "$CADDY_SHA512  /tmp/caddy.tar.gz" | sha512sum -c -
tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy
rm -f /tmp/caddy.tar.gz
useradd --system --home-dir /var/lib/caddy --create-home --shell /sbin/nologin caddy
install -d /etc/caddy
echo '__CADDYFILE_B64__' | base64 -d > /etc/caddy/Caddyfile

cat > /etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
Environment=HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
Restart=always
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now laya-serve caddy
