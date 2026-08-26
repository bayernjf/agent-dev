#!/usr/bin/env bash
# Agent-Dev auto-update script
# Checks for updates and applies them.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

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
echo "║       Agent-Dev Auto Update                  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Step 1: Check git status
info "Checking git status..."
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  warn "You have uncommitted changes. Please commit or stash them before updating."
  git status --short
  exit 1
fi

# Step 2: Fetch latest
info "Fetching latest changes..."
git fetch origin

# Step 3: Check if behind
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse '@{u}' 2>/dev/null || echo "$LOCAL")
BASE=$(git merge-base HEAD '@{u}' 2>/dev/null || echo "$LOCAL")

if [ "$LOCAL" = "$REMOTE" ]; then
  success "Already up to date."
  exit 0
fi

if [ "$LOCAL" = "$BASE" ]; then
  BEHIND=$(git rev-list --count HEAD..'@{u}')
  info "New version available: $BEHIND commit(s) behind."
  git log --oneline HEAD..'@{u}' | head -10
  echo ""

  read -p "Apply update? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    info "Update cancelled."
    exit 0
  fi

  # Step 4: Pull
  info "Pulling latest changes..."
  git pull --ff-only

  # Step 5: Install dependencies
  info "Installing dependencies..."
  npm install

  # Step 6: Build
  info "Building..."
  npm run build

  success "Update complete! Restart the daemon to apply changes."
  echo ""
  echo "  npm run dev"
  echo ""
else
  warn "Local branch has diverged from remote. Manual merge required."
  git status
  exit 1
fi
