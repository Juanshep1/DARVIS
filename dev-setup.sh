#!/bin/bash
# D.A.R.V.I.S. — Developer setup for Android (Termux)
# After this, just type: darvis-dev
# Then tell Claude Code what to fix. It handles code, deploy, commit, push.
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
echo "  Developer Setup — tell Claude what to fix, it handles the rest"
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
echo "  [1/7] Installing system packages..."
if [ "$PLATFORM" = "termux" ]; then
    pkg update -y
    pkg install -y python git nodejs-lts openssh termux-api gh 2>/dev/null || true
elif [ "$PLATFORM" = "mac" ]; then
    which python3 >/dev/null || brew install python3
    which node >/dev/null || brew install node
    which git >/dev/null || brew install git
    which gh >/dev/null || brew install gh
elif [ "$PLATFORM" = "linux" ]; then
    sudo apt update
    sudo apt install -y python3 python3-pip git nodejs npm
    # Install gh CLI
    if ! which gh >/dev/null 2>&1; then
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
        sudo apt update && sudo apt install -y gh
    fi
fi

# ── Clone / update repo ──
echo ""
echo "  [2/7] Setting up DARVIS repo..."
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
echo "  [3/7] Installing Python packages..."
pip install rich SpeechRecognition 2>/dev/null || pip3 install rich SpeechRecognition 2>/dev/null || true

# ── API keys ──
if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" << 'KEYS'
OLLAMA_API_KEY=0305bcb541ec4980bc99bb1aa77a3d12.lIr9I8Ir2oj-S26Bo1745Kcu
ELEVENLABS_API_KEY=sk_fc66616221fcc7b5f374a38e485815297965f2fc7baf4f7b
KEYS
    echo "  ✓ API keys written"
fi

# ── Git + GitHub auth ──
echo ""
echo "  [4/7] Setting up Git + GitHub..."
git config --global user.name "Juanshep1" 2>/dev/null || true
git config --global user.email "shephard_juan@yahoo.com" 2>/dev/null || true

# Authenticate with GitHub CLI — this lets Claude Code push without tokens
if which gh >/dev/null 2>&1; then
    if ! gh auth status >/dev/null 2>&1; then
        echo ""
        echo "  GitHub login required (one time only)."
        echo "  This lets Claude Code push code for you."
        echo ""
        gh auth login
    else
        echo "  ✓ Already logged into GitHub"
    fi
    # Set gh as the git credential helper so push just works
    gh auth setup-git 2>/dev/null || true
else
    echo "  ⚠ gh CLI not available — you'll need to set up git credentials manually"
    git config --global credential.helper store
fi

# ── Netlify CLI ──
echo ""
echo "  [5/7] Installing Netlify CLI..."
npm install -g netlify-cli 2>/dev/null || true

# Link Netlify site
if [ ! -d "$INSTALL_DIR/site/.netlify" ]; then
    echo "  Linking Netlify site..."
    cd "$INSTALL_DIR/site"
    netlify link --name darvis1 2>/dev/null || echo "  ⚠ Run 'netlify login' then 'netlify link --name darvis1' in ~/DARVIS/site"
    cd "$INSTALL_DIR"
fi
echo "  ✓ Netlify CLI ready"

# ── Claude Code ──
echo ""
echo "  [6/7] Installing Claude Code..."
npm install -g @anthropic-ai/claude-code 2>/dev/null || true
echo "  ✓ Claude Code installed"

# ── Shell aliases ──
echo ""
echo "  [7/7] Setting up shortcuts..."
SHELL_RC="$HOME/.bashrc"
[ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"

# Remove old aliases and rewrite
sed -i '/# DARVIS shortcuts/d; /alias darvis=/d; /alias darvis-web=/d; /alias darvis-dev=/d; /alias darvis-deploy=/d' "$SHELL_RC" 2>/dev/null || true

cat >> "$SHELL_RC" << 'ALIASES'

# DARVIS shortcuts
alias darvis='cd ~/DARVIS && python3 darvis.py'
alias darvis-web='cd ~/DARVIS && python3 web.py'
alias darvis-dev='cd ~/DARVIS && claude'
alias darvis-deploy='cd ~/DARVIS/site && netlify deploy --prod --dir=public --functions=netlify/functions'
ALIASES

echo "  ✓ Aliases added"

echo ""
echo "  ══════════════════════════════════════════════════"
echo "  ✓ Everything is set up!"
echo ""
echo "  To work on DARVIS, just run:"
echo ""
echo "    darvis-dev"
echo ""
echo "  Then tell Claude what you need:"
echo "    'fix the voice cutting out on mobile'"
echo "    'add a dark mode toggle'"
echo "    'the search isnt working, fix it'"
echo ""
echo "  Claude Code will edit the code, deploy to Netlify,"
echo "  commit, and push to GitHub — all automatically."
echo ""
echo "  Run: source $SHELL_RC"
echo "  ══════════════════════════════════════════════════"
echo ""
