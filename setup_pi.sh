#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# SPECTRA — Raspberry Pi Local Setup Script
# Installs: Ollama (LLM) + Whisper (STT) + Piper (TTS) + Spectra
# Target: Raspberry Pi 5 (8GB) with Raspberry Pi OS 64-bit
# ═══════════════════════════════════════════════════════════════════

set -e
echo "═══════════════════════════════════════════════════════"
echo " SPECTRA LOCAL — Raspberry Pi Setup"
echo "═══════════════════════════════════════════════════════"

# ── 1. System dependencies ────────────────────────────────────────
echo "[1/6] Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3 python3-pip python3-venv \
    ffmpeg portaudio19-dev \
    git curl wget

# ── 2. Install Ollama ─────────────────────────────────────────────
echo "[2/6] Installing Ollama..."
if ! command -v ollama &> /dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
    echo "[ollama] Installed"
else
    echo "[ollama] Already installed"
fi

# Start Ollama service
sudo systemctl enable ollama 2>/dev/null || true
sudo systemctl start ollama 2>/dev/null || true
sleep 3

# Pull the model — llama3.2:3b fits in 8GB RAM
echo "[2/6] Pulling llama3.2:3b (this takes 5-10 min on first run)..."
ollama pull llama3.2:3b

# ── 3. Python virtual environment ─────────────────────────────────
echo "[3/6] Setting up Python environment..."
cd "$(dirname "$0")"
VENV_DIR=".venv"
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"

pip install --upgrade pip -q
pip install -q \
    faster-whisper \
    flask \
    requests \
    rich \
    sounddevice \
    numpy

# Try to install piper-tts (may fail on some ARM builds)
pip install -q piper-tts 2>/dev/null || echo "[piper] piper-tts install failed — TTS will use browser SpeechSynthesis instead"

# ── 4. Create environment config ──────────────────────────────────
echo "[4/6] Writing local environment config..."
ENV_FILE=".env.local"
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << 'ENVEOF'
# Spectra Local Mode — Raspberry Pi
SPECTRA_LOCAL=1
OLLAMA_LOCAL_URL=http://localhost:11434/api
OLLAMA_LOCAL_MODEL=llama3.2:3b
WHISPER_URL=http://localhost:9000
WHISPER_MODEL=tiny
PIPER_URL=http://localhost:9001
PIPER_VOICE=en_GB-alan-medium
WEB_PORT=2414
ENVEOF
    echo "[config] Created $ENV_FILE"
else
    echo "[config] $ENV_FILE already exists, keeping it"
fi

# ── 5. Create systemd services ────────────────────────────────────
echo "[5/6] Creating systemd services..."

# Whisper STT service
sudo tee /etc/systemd/system/spectra-whisper.service > /dev/null << EOF
[Unit]
Description=Spectra Whisper STT Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
Environment=WHISPER_MODEL=tiny
Environment=WHISPER_PORT=9000
ExecStart=$(pwd)/$VENV_DIR/bin/python $(pwd)/whisper_server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Piper TTS service
sudo tee /etc/systemd/system/spectra-piper.service > /dev/null << EOF
[Unit]
Description=Spectra Piper TTS Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
Environment=PIPER_VOICE=en_GB-alan-medium
Environment=PIPER_PORT=9001
ExecStart=$(pwd)/$VENV_DIR/bin/python $(pwd)/piper_tts_server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Spectra web dashboard service
sudo tee /etc/systemd/system/spectra-web.service > /dev/null << EOF
[Unit]
Description=Spectra Web Dashboard (Local)
After=network.target ollama.service spectra-whisper.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
EnvironmentFile=$(pwd)/.env.local
ExecStart=$(pwd)/$VENV_DIR/bin/python $(pwd)/web.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable spectra-whisper spectra-piper spectra-web 2>/dev/null || true

# ── 6. Start everything ──────────────────────────────────────────
echo "[6/6] Starting services..."
sudo systemctl start spectra-whisper || echo "[whisper] Start deferred — first run will download model"
sudo systemctl start spectra-piper || echo "[piper] Start deferred — first run will download voice"
sudo systemctl start spectra-web || echo "[web] Start deferred"

echo ""
echo "═══════════════════════════════════════════════════════"
echo " SPECTRA LOCAL — Setup Complete"
echo "═══════════════════════════════════════════════════════"
echo ""
echo " Services:"
echo "   Ollama LLM    → http://localhost:11434  (llama3.2:3b)"
echo "   Whisper STT   → http://localhost:9000   (tiny model)"
echo "   Piper TTS     → http://localhost:9001   (alan-medium)"
echo "   Spectra Web   → http://localhost:2414   (browser UI)"
echo ""
echo " Terminal mode:"
echo "   source .venv/bin/activate"
echo "   SPECTRA_LOCAL=1 python darvis.py"
echo ""
echo " Test commands:"
echo "   curl http://localhost:11434/api/tags"
echo "   curl http://localhost:9000/health"
echo "   curl http://localhost:9001/health"
echo "   curl http://localhost:2414"
echo ""
echo " Manage:"
echo "   sudo systemctl status spectra-whisper spectra-piper spectra-web"
echo "   sudo journalctl -u spectra-whisper -f"
echo ""
