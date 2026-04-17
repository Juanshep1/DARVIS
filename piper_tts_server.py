#!/usr/bin/env python3
"""
Local Piper TTS server for Spectra on Raspberry Pi.
Neural text-to-speech that runs entirely on-device.

Setup:
    pip install piper-tts flask
    # Models auto-download on first use (~20MB each)

Usage:
    python piper_tts_server.py

Endpoints:
    POST /speak  { "text": "hello", "voice": "en_GB-alan-medium" }
    GET  /speak?text=hello&voice=en_GB-alan-medium
    GET  /voices — list installed voices
    GET  /health
"""

import io
import os
import wave
import struct
from flask import Flask, request, jsonify, Response

app = Flask(__name__)

# Default voice — British male, medium quality, good for Pi 5
DEFAULT_VOICE = os.environ.get("PIPER_VOICE", "en_GB-alan-medium")

_synthesizer = None
_current_voice = None


def get_synth(voice=None):
    global _synthesizer, _current_voice
    voice = voice or DEFAULT_VOICE
    if _synthesizer is None or _current_voice != voice:
        from piper import PiperVoice
        # Piper auto-downloads voice models to ~/.local/share/piper_tts/
        _synthesizer = PiperVoice.load(voice)
        _current_voice = voice
        print(f"[piper] Loaded voice: {voice}")
    return _synthesizer


def synth_wav(text, voice=None):
    """Synthesize text to WAV bytes."""
    synth = get_synth(voice)
    # Piper returns raw int16 PCM samples
    audio = synth.synthesize(text)
    # Wrap in a WAV container
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(synth.config.sample_rate)
        wf.writeframes(audio)
    buf.seek(0)
    return buf.read()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "voice": DEFAULT_VOICE})


@app.route("/voices", methods=["GET"])
def voices():
    # Well-known Piper voices good for Spectra
    return jsonify({
        "voices": [
            {"id": "en_GB-alan-medium", "name": "Alan (British male)", "lang": "en-GB"},
            {"id": "en_GB-alba-medium", "name": "Alba (British female)", "lang": "en-GB"},
            {"id": "en_GB-aru-medium", "name": "Aru (British male)", "lang": "en-GB"},
            {"id": "en_US-lessac-medium", "name": "Lessac (US male)", "lang": "en-US"},
            {"id": "en_US-amy-medium", "name": "Amy (US female)", "lang": "en-US"},
            {"id": "en_US-ryan-medium", "name": "Ryan (US male)", "lang": "en-US"},
            {"id": "en_US-joe-medium", "name": "Joe (US male)", "lang": "en-US"},
            {"id": "en_AU-karen-medium", "name": "Karen (Australian)", "lang": "en-AU"},
        ],
        "current": DEFAULT_VOICE,
    })


@app.route("/speak", methods=["GET", "POST"])
def speak():
    if request.method == "GET":
        text = request.args.get("text", "")
        voice = request.args.get("voice", DEFAULT_VOICE)
    else:
        body = request.get_json(silent=True) or {}
        text = body.get("text", "")
        voice = body.get("voice", DEFAULT_VOICE)

    text = text.strip()
    if not text:
        return jsonify({"error": "no text"}), 400

    # Clean markdown
    import re
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"[*_`#\[\]()]", "", text)
    text = " ".join(text.split()).strip()[:2000]

    try:
        wav_bytes = synth_wav(text, voice)
        return Response(wav_bytes, mimetype="audio/wav", headers={
            "Cache-Control": "no-cache",
            "Content-Length": str(len(wav_bytes)),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PIPER_PORT", "9001"))
    print(f"[piper] Starting on port {port} with voice '{DEFAULT_VOICE}'")
    # Pre-load voice on startup
    try:
        get_synth()
    except Exception as e:
        print(f"[piper] Voice pre-load failed (will retry on first request): {e}")
    app.run(host="0.0.0.0", port=port, threaded=True)
