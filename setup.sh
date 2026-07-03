#!/usr/bin/env bash
# setup.sh — one-shot install for mastyf.ai
set -euo pipefail

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; RESET='\033[0m'
info()    { echo -e "${BOLD}[setup]${RESET} $*"; }
success() { echo -e "${GREEN}[setup] ✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}[setup] ⚠${RESET} $*"; }
die()     { echo -e "${RED}[setup] ✗${RESET} $*"; exit 1; }
step()    { echo -e "\n${CYAN}${BOLD}── $* ${RESET}"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

OS="$(uname -s)"

# Never run under sudo — nix must use the installing user's HOME and tokens.
if [ "$(id -u)" -eq 0 ]; then
  die "Do not run setup.sh as root. Re-run as your normal user (setup will prompt for sudo only when needed)."
fi

# Portable in-place sed (GNU vs BSD/macOS).
sed_inplace() {
  if sed --version 2>/dev/null | grep -q GNU; then
    sed -i "$@"
  else
    local expr=$1
    shift
    sed -i '' "$expr" "$@"
  fi
}

# Single canonical nix develop command — no variable expansion, no quoting issues
NIX_FLAGS=(--extra-experimental-features nix-command --extra-experimental-features flakes)
NIX_DEVELOP=(nix "${NIX_FLAGS[@]}" develop "${ROOT}/config")

nix_store_ping() {
  nix "${NIX_FLAGS[@]}" store ping &>/dev/null
}

nix_daemon_running() {
  if [ "$OS" = "Darwin" ]; then
    if launchctl print system/systems.determinate.nix-daemon &>/dev/null; then
      launchctl print system/systems.determinate.nix-daemon 2>/dev/null | grep -q 'state = running'
      return
    fi
    if launchctl print system/org.nixos.nix-daemon &>/dev/null; then
      launchctl print system/org.nixos.nix-daemon 2>/dev/null | grep -q 'state = running'
      return
    fi
    return 1
  fi
  systemctl is-active --quiet nix-daemon 2>/dev/null
}

start_nix_daemon() {
  if [ "$OS" = "Darwin" ]; then
    # Determinate Nix manages 3.x (launchd). Never `sudo nix-daemon &` — it breaks HOME and sockets.
    if launchctl print system/systems.determinate.nix-daemon &>/dev/null; then
      sudo launchctl kickstart -k system/systems.determinate.nix-daemon
      return
    fi
    if launchctl print system/org.nixos.nix-daemon &>/dev/null; then
      sudo launchctl kickstart -k system/org.nixos.nix-daemon
      return
    fi
    die "Nix launchd service not found. Reinstall via: curl -sSf -L https://install.determinate.systems/nix | sh -s -- install"
  fi
  sudo systemctl start nix-daemon
}

ensure_nix_daemon() {
  if nix_store_ping; then
    success "nix-daemon reachable"
    return
  fi

  # Orphan `sudo nix-daemon &` from older setup.sh leaves a dead socket on macOS.
  if [ "$OS" = "Darwin" ] && pgrep -x nix-daemon >/dev/null 2>&1; then
    warn "Stopping orphan nix-daemon process(es) (macOS uses Determinate launchd)..."
    sudo pkill -x nix-daemon 2>/dev/null || true
    sleep 1
  fi

  if nix_daemon_running; then
    warn "Daemon launchd job is running but store ping failed — restarting via launchctl..."
  else
    warn "nix-daemon not running. Starting it..."
  fi

  start_nix_daemon
  sleep 2

  if ! nix_store_ping; then
    die "Cannot connect to nix-daemon after restart. Run manually:\n  sudo pkill -x nix-daemon\n  sudo launchctl kickstart -k system/systems.determinate.nix-daemon\n  nix store ping --extra-experimental-features 'nix-command flakes'"
  fi
  success "nix-daemon started"
}

# ── Detect shell rc file ──────────────────────────────────────────────────────
detect_shell_rc() {
  if [ "$(basename "${SHELL:-}")" = "zsh" ]; then
    echo "$HOME/.zshrc"
  else
    echo "$HOME/.bashrc"
  fi
}
SHELL_RC="$(detect_shell_rc)"

# ── 1. Install Nix if missing ─────────────────────────────────────────────────
step "Checking Nix"

if ! command -v nix &>/dev/null; then
  warn "Nix not found. Installing via Determinate Systems installer..."
  if ! command -v curl &>/dev/null; then
    die "curl is required to install Nix. Install it with your package manager and re-run."
  fi
  curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --no-confirm
  if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
    # shellcheck disable=SC1091
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
  fi
  if ! command -v nix &>/dev/null; then
    die "Nix installed but not in PATH. Open a new terminal and re-run setup.sh."
  fi
  success "Nix installed"
else
  success "Nix $(nix --version 2>/dev/null | head -1) already installed"
fi

# ── 2. Ensure nix daemon is running ──────────────────────────────────────────
step "Checking Nix daemon"

ensure_nix_daemon

# ── 3. Grant daemon socket access ────────────────────────────────────────────
step "Checking nix daemon socket access"

if getent group nix-users &>/dev/null; then
  # Multi-user install via nix-bin/apt style — uses a nix-users group
  if ! id -nG "$USER" | grep -qw nix-users; then
    warn "Adding $USER to nix-users (requires sudo)..."
    sudo usermod -aG nix-users "$USER"
    success "Added — applying via newgrp for this session..."
    NEED_SG=true
  else
    success "$USER already in nix-users"
  fi
else
  # Determinate Nix installer — daemon socket is world-accessible via systemd socket activation,
  # no special group needed. Just verify we can actually talk to it.
  success "No nix-users group required (Determinate Nix install)"
fi

if [ "${NEED_SG:-false}" = "true" ]; then
  exec sg nix-users -- bash "$0" "$@"
fi

# ── 4. Check flakes work ──────────────────────────────────────────────────────
step "Checking Nix flakes support"

NIX_CONF="${XDG_CONFIG_HOME:-$HOME/.config}/nix/nix.conf"

if ! nix_store_ping; then
  warn "Enabling flakes in $NIX_CONF..."
  mkdir -p "$(dirname "$NIX_CONF")"
  if ! grep -q "experimental-features" "$NIX_CONF" 2>/dev/null; then
    echo 'experimental-features = nix-command flakes' >> "$NIX_CONF"
    success "Flakes enabled"
  else
    warn "experimental-features already present in $NIX_CONF — check for conflicts with /etc/nix/nix.conf"
  fi
  if ! nix_store_ping; then
    ensure_nix_daemon
  fi
else
  success "Flakes available"
fi

# ── 5. Enter nix shell and build ──────────────────────────────────────────────
step "Entering nix dev shell and building"

info "This may take a few minutes on first run (downloading nixpkgs)..."

"${NIX_DEVELOP[@]}" --command bash -euo pipefail << NIXSHELL
BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
info()    { echo -e "\${BOLD}[setup]\${RESET} \$*"; }
success() { echo -e "\${GREEN}[setup] ✓\${RESET} \$*"; }
warn()    { echo -e "\${YELLOW}[setup] ⚠\${RESET} \$*"; }

cd "${ROOT}"

info "Installing dependencies..."
if ! pnpm install --frozen-lockfile; then
  warn "--frozen-lockfile failed, retrying without it..."
  pnpm install
fi

info "Approving native builds (esbuild, sharp)..."
pnpm approve-builds --yes 2>/dev/null || true

info "Rebuilding better-sqlite3 for Node \$(node --version)..."
if ! pnpm rebuild better-sqlite3; then
  warn "pnpm rebuild failed, trying npm rebuild..."
  npm rebuild better-sqlite3 || warn "better-sqlite3 rebuild failed — dashboard history may not work."
fi

info "Building all packages..."
if ! pnpm build; then
  echo ""
  echo -e "\${BOLD}Build failed.\${RESET} Common fixes:"
  echo "  • Missing package:  pnpm add <package-name>"
  echo "  • Lockfile drift:   pnpm install (without --frozen-lockfile)"
  exit 1
fi

success "Build complete!"
NIXSHELL

# ── 6. Add shell alias ────────────────────────────────────────────────────────
step "Setting up 'mastyf' alias"

# Write alias with each experimental feature as a separate flag to avoid quoting issues
ALIAS_CMD="nix --extra-experimental-features nix-command --extra-experimental-features flakes develop ${ROOT}/config --command node dist/cli.js start"
if getent group nix-users &>/dev/null; then
  ALIAS_LINE="alias mastyf='sg nix-users -c \"cd ${ROOT} && ${ALIAS_CMD}\"'"
else
  ALIAS_LINE="alias mastyf='cd ${ROOT} && ${ALIAS_CMD}'"
fi
ALIAS_MARKER="# mastyf.ai alias"

# Remove any old/broken mastyf alias first
if grep -q "mastyf" "$SHELL_RC" 2>/dev/null; then
  sed_inplace '/# mastyf.ai alias/,+1d' "$SHELL_RC"
  sed_inplace '/alias mastyf=/d' "$SHELL_RC"
fi

{
  echo ""
  echo "$ALIAS_MARKER"
  echo "$ALIAS_LINE"
} >> "$SHELL_RC"

success "Added 'mastyf' alias to $SHELL_RC"

# Apply to current session
# shellcheck disable=SC2139
if getent group nix-users &>/dev/null; then
  alias mastyf="sg nix-users -c \"cd ${ROOT} && ${ALIAS_CMD}\""
else
  alias mastyf="cd ${ROOT} && ${ALIAS_CMD}"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║       mastyf.ai is ready!            ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Start now:   ${BOLD}node dist/cli.js start${RESET}"
echo -e "  Or anywhere: ${BOLD}mastyf${RESET}  (after opening a new terminal)"
echo -e "  Dashboard:   ${BOLD}http://localhost:4000${RESET}"
echo ""
echo -e "  Alias saved to: ${SHELL_RC}"
echo ""