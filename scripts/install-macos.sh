#!/usr/bin/env bash
# Agent-Dev one-click macOS installer
# Installs Node.js 22, agent-dev, configures proxy, and sets up daemon auto-start.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

AGENT_DEV_HOME="${AGENT_DEV_HOME:-$HOME/.agent-dev}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/agent-dev}"
DAEMON_PORT="${DAEMON_PORT:-3737}"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║          Agent-Dev macOS Installer                ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Verify macOS
# ---------------------------------------------------------------------------
info "Checking system..."
if [[ "$(uname)" != "Darwin" ]]; then
  error "This installer is for macOS only. Detected: $(uname)"
  exit 1
fi
success "macOS detected ($(sw_vers -productVersion 2>/dev/null || echo 'unknown'))"

# ---------------------------------------------------------------------------
# Step 2: Install Homebrew if missing
# ---------------------------------------------------------------------------
if ! command -v brew &>/dev/null; then
  info "Homebrew not found. Installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for this session
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -f /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  success "Homebrew installed"
else
  success "Homebrew found ($(brew --version | head -1))"
fi

# ---------------------------------------------------------------------------
# Step 3: Install fnm (Node version manager) if missing
# ---------------------------------------------------------------------------
if ! command -v fnm &>/dev/null; then
  info "Installing fnm (Node version manager)..."
  brew install fnm
  # Configure fnm shell integration
  FNM_INIT='eval "$(fnm env --use-on-cd)"'
  for shell_rc in ~/.zshrc ~/.bashrc ~/.bash_profile; do
    if [[ -f "$shell_rc" ]] && ! grep -q "fnm env" "$shell_rc"; then
      echo "$FNM_INIT" >> "$shell_rc"
      info "Added fnm init to $shell_rc"
    fi
  done
  eval "$(fnm env)"
  success "fnm installed"
else
  success "fnm found"
  eval "$(fnm env)"
fi

# ---------------------------------------------------------------------------
# Step 4: Install Node.js 22
# ---------------------------------------------------------------------------
info "Checking Node.js version..."
if fnm list 2>/dev/null | grep -q "v22"; then
  success "Node.js 22 already installed"
else
  info "Installing Node.js 22..."
  fnm install 22
  success "Node.js 22 installed"
fi
fnm use 22
NODE_VERSION="$(node --version)"
success "Active Node.js: $NODE_VERSION"

# ---------------------------------------------------------------------------
# Step 5: Clone or locate agent-dev
# ---------------------------------------------------------------------------
if [[ -d "$PROJECT_DIR/.git" ]]; then
  INSTALL_DIR="$PROJECT_DIR"
  info "Using existing agent-dev repository at $INSTALL_DIR"
else
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Found existing agent-dev at $INSTALL_DIR"
  else
    info "Cloning agent-dev to $INSTALL_DIR..."
    git clone https://github.com/bayernjf/agent-dev.git "$INSTALL_DIR"
    success "Cloned agent-dev"
  fi
fi

cd "$INSTALL_DIR"

# ---------------------------------------------------------------------------
# Step 6: Install dependencies and build
# ---------------------------------------------------------------------------
info "Installing dependencies..."
npm ci
success "Dependencies installed"

info "Building..."
npm run build
success "Build complete"

# ---------------------------------------------------------------------------
# Step 7: Create data directory and env config
# ---------------------------------------------------------------------------
mkdir -p "$AGENT_DEV_HOME"

ENV_FILE="$AGENT_DEV_HOME/env"
if [[ ! -f "$ENV_FILE" ]]; then
  info "Creating environment config at $ENV_FILE..."
  cat > "$ENV_FILE" <<'EOF'
# Agent-Dev environment configuration
# This file is sourced by the daemon launcher.

# Node.js (ensure fnm is initialized)
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env)" 2>/dev/null || true
fnm use 22 2>/dev/null || true

# Proxy settings (uncomment and configure if behind a corporate proxy)
# export HTTPS_PROXY="http://your-proxy:port"
# export HTTP_PROXY="http://your-proxy:port"
# export NO_PROXY="localhost,127.0.0.1"

# Critical: Node.js must respect proxy env vars for cloud API calls
export NODE_USE_ENV_PROXY=1

# Daemon port
export AGENT_DEV_PORT=3737
EOF
  success "Environment config created"
else
  info "Environment config already exists at $ENV_FILE"
fi

# ---------------------------------------------------------------------------
# Step 8: Create daemon launcher script
# ---------------------------------------------------------------------------
LAUNCHER="$AGENT_DEV_HOME/start-daemon.sh"
info "Creating daemon launcher at $LAUNCHER..."
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
# Agent-Dev daemon launcher
set -euo pipefail

# Source environment config
if [[ -f "$AGENT_DEV_HOME/env" ]]; then
  source "$AGENT_DEV_HOME/env"
fi

cd "$INSTALL_DIR"
exec npm run -w @agent-dev/daemon dev
EOF
chmod +x "$LAUNCHER"
success "Daemon launcher created"

# ---------------------------------------------------------------------------
# Step 9: Set up launchd for auto-start
# ---------------------------------------------------------------------------
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$PLIST_DIR/io.agent-dev.daemon.plist"
mkdir -p "$PLIST_DIR"

info "Creating launchd plist at $PLIST_FILE..."
cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.agent-dev.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>$LAUNCHER</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$AGENT_DEV_HOME/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>$AGENT_DEV_HOME/daemon-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string>
        <key>NODE_USE_ENV_PROXY</key>
        <string>1</string>
    </dict>
</dict>
</plist>
EOF

# Load the launchd agent
if launchctl list | grep -q "io.agent-dev.daemon"; then
  info "Restarting existing daemon..."
  launchctl unload "$PLIST_FILE" 2>/dev/null || true
fi
launchctl load "$PLIST_FILE"
success "Daemon configured to auto-start via launchd"

# ---------------------------------------------------------------------------
# Step 10: Wait for daemon and verify
# ---------------------------------------------------------------------------
info "Waiting for daemon to start..."
for i in $(seq 1 15); do
  if curl -s "http://localhost:$DAEMON_PORT/api/projects" &>/dev/null; then
    success "Daemon is running on port $DAEMON_PORT"
    break
  fi
  sleep 1
  if [[ $i -eq 15 ]]; then
    warn "Daemon may not have started yet. Check logs: $AGENT_DEV_HOME/daemon.log"
  fi
done

# ---------------------------------------------------------------------------
# Step 11: Run doctor
# ---------------------------------------------------------------------------
info "Running environment doctor..."
cd "$INSTALL_DIR"
if npm run doctor 2>&1; then
  success "Doctor check complete"
else
  warn "Doctor found issues. Review the output above and fix as needed."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║          Installation Complete!                   ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Install directory:  $INSTALL_DIR"
echo "  Data directory:     $AGENT_DEV_HOME"
echo "  Daemon port:        $DAEMON_PORT"
echo "  Daemon status:      $(launchctl list | grep io.agent-dev.daemon | awk '{print $1}' || echo 'not loaded')"
echo ""
echo "  Useful commands:"
echo "    Start Studio:     cd $INSTALL_DIR && npm run dev -w @agent-dev/studio"
echo "    Start everything: cd $INSTALL_DIR && npm run dev"
echo "    Check daemon:     curl http://localhost:$DAEMON_PORT/api/projects"
echo "    View logs:        tail -f $AGENT_DEV_HOME/daemon.log"
echo "    Run doctor:       cd $INSTALL_DIR && npm run doctor"
echo "    Update:           cd $INSTALL_DIR && npm run update"
echo ""
echo "  Next: open http://localhost:5173 (Studio) to create your first project."
echo ""
