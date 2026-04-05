#!/bin/bash
# D.A.R.V.I.S. — Developer setup for Android (Termux)
# Installs everything needed to develop + deploy from your phone:
#   - DARVIS + dependencies
#   - Git (with GitHub auth)
#   - Node.js + Netlify CLI
#   - Claude Code (AI coding assistant)
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/Juanshep1/DARVIS/main/dev-setup.sh | bash

set -e

echo ""
echo "  ██████╗  █████╗ ██████╗ ██╗   ██╗██╗███████╗"
echo "  ██╔══██╗██╔══██╗██╔══██╗██║   ██║██║██╔════╝"
echo "  ██║  ██║███████║██████╔╝██║   ██║██║███████╗"
echo "  ██║  ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║"
echo "  ██████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║"
echo "  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝"
echo ""
echo "  Developer Setup — Code on Android, push to GitHub"
echo ""

# ── Platform check ──
if [ -d "/data/data/com.termux" ] || [ -n "$TERMUX_VERSION" ]; then
    PLATFORM="termux"
elif [ "$(uname)" = "Darwin" ]; then
    PLATFORM="mac"
else
    PLATFORM="linux"
fi
echo "  Platform: $PLATFORM"

# ── System packages ──
echo ""
echo "  [1/6] Installing system packages..."
if [ "$PLATFORM" = "termux" ]; then
    pkg update -y
    pkg install -y python git nodejs-lts openssh termux-api 2>/dev/null || true
elif [ "$PLATFORM" = "mac" ]; then
    which python3 >/dev/null || brew install python3
    which node >/dev/null || brew install node
    which git >/dev/null || brew install git
elif [ "$PLATFORM" = "linux" ]; then
    sudo apt update
    sudo apt install -y python3 python3-pip git nodejs npm
fi

# ── Clone / update repo ──
echo ""
echo "  [2/6] Setting up DARVIS repo..."
INSTALL_DIR="$HOME/DARVIS"
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "  Repo exists, pulling latest..."
    cd "$INSTALL_DIR"
    git pull origin main
else
    echo "  Cloning from GitHub..."
    git clone https://github.com/Juanshep1/DARVIS.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# ── Python deps ──
echo ""
echo "  [3/6] Installing Python packages..."
pip install rich SpeechRecognition 2>/dev/null || pip3 install rich SpeechRecognition 2>/dev/null || true

# ── API keys ──
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo ""
    echo "  [3.5] Setting up API keys..."
    cat > "$INSTALL_DIR/.env" << 'KEYS'
OLLAMA_API_KEY=0305bcb541ec4980bc99bb1aa77a3d12.lIr9I8Ir2oj-S26Bo1745Kcu
ELEVENLABS_API_KEY=sk_fc66616221fcc7b5f374a38e485815297965f2fc7baf4f7b
KEYS
    echo "  ✓ API keys written to .env"
fi

# ── Git config ──
echo ""
echo "  [4/6] Configuring Git..."
if [ -z "$(git config --global user.name)" ]; then
    git config --global user.name "Juanshep1"
fi
if [ -z "$(git config --global user.email)" ]; then
    git config --global user.email "shephard_juan@yahoo.com"
fi

# Set up GitHub credential caching so you don't have to type your password every push
git config --global credential.helper store
echo "  ✓ Git configured (user: $(git config --global user.name))"
echo ""
echo "  To authenticate with GitHub, you'll need a Personal Access Token:"
echo "    1. Go to: https://github.com/settings/tokens"
echo "    2. Generate a token with 'repo' scope"
echo "    3. On your first 'git push', use your GitHub username"
echo "       and paste the token as your password"
echo "    4. It'll be saved — you won't need to enter it again"
echo ""

# ── Netlify CLI ──
echo "  [5/6] Installing Netlify CLI..."
npm install -g netlify-cli 2>/dev/null || true
echo "  ✓ Netlify CLI installed"
echo ""
echo "  To deploy from Termux, run:"
echo "    cd ~/DARVIS/site && netlify login && netlify link --name darvis1"
echo ""

# ── Claude Code ──
echo "  [6/6] Installing Claude Code..."
npm install -g @anthropic-ai/claude-code 2>/dev/null || true
echo "  ✓ Claude Code installed"
echo ""

# ── Shell aliases ──
SHELL_RC="$HOME/.bashrc"
[ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"

# Add aliases if not present
if ! grep -q "alias darvis=" "$SHELL_RC" 2>/dev/null; then
    cat >> "$SHELL_RC" << 'ALIASES'

# DARVIS shortcuts
alias darvis='cd ~/DARVIS && python3 darvis.py'
alias darvis-web='cd ~/DARVIS && python3 web.py'
alias darvis-dev='cd ~/DARVIS && claude'
alias darvis-deploy='cd ~/DARVIS/site && netlify deploy --prod --dir=public --functions=netlify/functions'
ALIASES
    echo "  ✓ Added shell aliases"
fi

echo ""
echo "  ══════════════════════════════════════════════════"
echo "  ✓ Dev environment ready!"
echo ""
echo "  Commands:"
echo "    darvis         — Run DARVIS (terminal assistant)"
echo "    darvis-web     — Run local web dashboard"
echo "    darvis-dev     — Open Claude Code in the DARVIS repo"
echo "    darvis-deploy  — Deploy to Netlify (darvis1.netlify.app)"
echo ""
echo "  Workflow:"
echo "    1. darvis-dev        → opens Claude Code"
echo "    2. Make changes      → Claude writes/edits code"
echo "    3. git add . && git commit -m 'your message'"
echo "    4. git push          → pushes to GitHub"
echo "    5. darvis-deploy     → deploys browser version"
echo ""
echo "  First time? Run: source $SHELL_RC"
echo "  ══════════════════════════════════════════════════"
echo ""
