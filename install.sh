#!/bin/bash
# D.A.R.V.I.S. — One-command installer
# Works on macOS, Linux, and Android (Termux)

set -e

echo ""
echo "  ██████╗  █████╗ ██████╗ ██╗   ██╗██╗███████╗"
echo "  ██╔══██╗██╔══██╗██╔══██╗██║   ██║██║██╔════╝"
echo "  ██║  ██║███████║██████╔╝██║   ██║██║███████╗"
echo "  ██║  ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║"
echo "  ██████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║"
echo "  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝"
echo ""
echo "  Installing D.A.R.V.I.S..."
echo ""

# Detect platform
if [ -d "/data/data/com.termux" ] || [ -n "$TERMUX_VERSION" ]; then
    PLATFORM="termux"
elif [ "$(uname)" = "Darwin" ]; then
    PLATFORM="mac"
else
    PLATFORM="linux"
fi

echo "  Platform: $PLATFORM"

# Install system deps
if [ "$PLATFORM" = "termux" ]; then
    pkg update -y
    pkg install python git -y
    pkg install termux-api -y 2>/dev/null || true
elif [ "$PLATFORM" = "mac" ]; then
    which python3 >/dev/null || brew install python3
    which pip3 >/dev/null || brew install python3
elif [ "$PLATFORM" = "linux" ]; then
    which python3 >/dev/null || sudo apt install -y python3 python3-pip
fi

# Clone or update
INSTALL_DIR="$HOME/DARVIS"
if [ -d "$INSTALL_DIR" ]; then
    echo "  Updating existing install..."
    cd "$INSTALL_DIR"
    git pull
else
    echo "  Downloading DARVIS..."
    git clone https://github.com/Juanshep1/DARVIS.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install Python deps
echo "  Installing Python packages..."
pip install rich SpeechRecognition 2>/dev/null || pip3 install rich SpeechRecognition

# Install PyAudio on macOS (needs portaudio)
if [ "$PLATFORM" = "mac" ]; then
    brew list portaudio >/dev/null 2>&1 || brew install portaudio
    pip3 install pyaudio 2>/dev/null || true
fi

# Write API keys
cat > "$INSTALL_DIR/.env" << 'KEYS'
OLLAMA_API_KEY=0305bcb541ec4980bc99bb1aa77a3d12.lIr9I8Ir2oj-S26Bo1745Kcu
ELEVENLABS_API_KEY=sk_fc66616221fcc7b5f374a38e485815297965f2fc7baf4f7b
KEYS

echo ""
echo "  ✓ DARVIS installed at $INSTALL_DIR"
echo "  ✓ API keys configured"
echo ""
echo "  Commands:"
echo ""
echo "    darvis        — terminal mode"
echo "    darvis-web    — web dashboard (http://localhost:3000)"
echo ""

# Create shortcut aliases
SHELL_RC="$HOME/.bashrc"
[ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"
if ! grep -q "alias darvis=" "$SHELL_RC" 2>/dev/null; then
    echo "alias darvis='cd $INSTALL_DIR && python3 darvis.py'" >> "$SHELL_RC"
    echo "alias darvis-web='cd $INSTALL_DIR && python3 web.py'" >> "$SHELL_RC"
    echo "  ✓ Added 'darvis' and 'darvis-web' shortcuts to $SHELL_RC"
fi

echo "  Starting DARVIS..."
echo ""
python3 darvis.py
