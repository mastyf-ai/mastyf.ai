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

# Single canonical nix develop command — no variable expansion, no quoting issues
NIX_DEVELOP="nix --extra-experimental-features nix-command --extra-experimental-features flakes develop ${ROOT}/config"

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

if ! systemctl is-active --quiet nix-daemon 2>/dev/null; then
  warn "nix-daemon not running. Starting it..."
  sudo systemctl start nix-daemon 2>/dev/null || sudo nix-daemon &
  sleep 2
  success "nix-daemon started"
else
  success "nix-daemon is running"
fi

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

if ! nix --extra-experimental-features "nix-command flakes" store ping &>/dev/null; then
  warn "Enabling flakes in $NIX_CONF..."
  mkdir -p "$(dirname "$NIX_CONF")"
  if ! grep -q "experimental-features" "$NIX_CONF" 2>/dev/null; then
    echo 'experimental-features = nix-command flakes' >> "$NIX_CONF"
    success "Flakes enabled"
  else
    warn "experimental-features already present in $NIX_CONF — check for conflicts with /etc/nix/nix.conf"
  fi
else
  success "Flakes available"
fi

# ── 5. Enter nix shell and build ──────────────────────────────────────────────
step "Entering nix dev shell and building"

info "This may take a few minutes on first run (downloading nixpkgs)..."

$NIX_DEVELOP --command bash -euo pipefail << NIXSHELL
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
  sed -i '/# mastyf.ai alias/,+1d' "$SHELL_RC"
  sed -i '/alias mastyf=/d' "$SHELL_RC"
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