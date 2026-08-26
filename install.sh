#!/usr/bin/env bash
# Agent-Dev macOS Installer
# One-click setup for external users.
#
# What this does:
# 1. Check and install Homebrew (if missing)
# 2. Check and install Node.js 22+ (via fnm)
# 3. Check and install Git
# 4. Check and install GitHub CLI
# 5. Install Agent-Dev dependencies
# 6. Run environment doctor to verify setup

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       Agent-Dev macOS Installer              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ---------------------------------------------------------------------------
# 1. Homebrew
# ---------------------------------------------------------------------------
info "Checking Homebrew..."
if command -v brew &> /dev/null; then
  success "Homebrew is installed: $(brew --version | head -1)"
else
  warn "Homebrew is not installed. Installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for this session
  if [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -f /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  success "Homebrew installed"
fi

# ---------------------------------------------------------------------------
# 2. Node.js 22+ (via fnm)
# ---------------------------------------------------------------------------
info "Checking Node.js..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ]; then
    success "Node.js $NODE_VERSION detected (>=22 required)"
  else
    warn "Node.js $NODE_VERSION is too old (need >=22). Upgrading..."
    if command -v fnm &> /dev/null; then
      fnm install 22
      fnm use 22
    else
      info "Installing fnm (Node version manager)..."
      brew install fnm
      eval "$(fnm env)"
      fnm install 22
      fnm use 22
    fi
    success "Node.js upgraded to $(node --version)"
  fi
else
  warn "Node.js is not installed. Installing via fnm..."
  if ! command -v fnm &> /dev/null; then
    info "Installing fnm..."
    brew install fnm
  fi
  eval "$(fnm env)"
  fnm install 22
  fnm use 22
  success "Node.js $(node --version) installed"
fi

# Ensure fnm is in shell config
if [ -f ~/.zshrc ] && ! grep -q "fnm env" ~/.zshrc 2>/dev/null; then
  info "Adding fnm to ~/.zshrc..."
  echo '# fnm (Node version manager)' >> ~/.zshrc
  echo 'eval "$(fnm env --use-on-cd)"' >> ~/.zshrc
  success "fnm added to ~/.zshrc"
fi

# ---------------------------------------------------------------------------
# 3. Git
# ---------------------------------------------------------------------------
info "Checking Git..."
if command -v git &> /dev/null; then
  success "Git is installed: $(git --version)"
else
  warn "Git is not installed. Installing..."
  brew install git
  success "Git installed"
fi

# ---------------------------------------------------------------------------
# 4. GitHub CLI
# ---------------------------------------------------------------------------
info "Checking GitHub CLI..."
if command -v gh &> /dev/null; then
  success "GitHub CLI is installed: $(gh --version | head -1)"
  if gh auth status &> /dev/null; then
    success "GitHub CLI is authenticated"
  else
    warn "GitHub CLI is not authenticated. Run 'gh auth login' after installation."
  fi
else
  warn "GitHub CLI is not installed. Installing..."
  brew install gh
  success "GitHub CLI installed. Run 'gh auth login' to authenticate."
fi

# ---------------------------------------------------------------------------
# 5. Install Agent-Dev dependencies
# ---------------------------------------------------------------------------
info "Installing Agent-Dev dependencies..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
npm install
success "Dependencies installed"

# ---------------------------------------------------------------------------
# 6. Run doctor
# ---------------------------------------------------------------------------
echo ""
info "Running environment doctor..."
echo ""
npx tsx -e "
import { runDoctor, formatDoctorSummary } from './packages/agent-runtime/src/doctor.ts';
const report = await runDoctor();
console.log(formatDoctorSummary(report));
" 2>/dev/null || warn "Doctor check skipped (run 'npm run doctor' later)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       Installation Complete!                  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. If not already: run 'gh auth login' to authenticate GitHub"
echo "  2. Run 'npm run dev' to start Agent-Dev"
echo "  3. Open http://localhost:5173 in your browser"
echo "  4. Run 'npm run doctor' anytime to check your environment"
echo ""
