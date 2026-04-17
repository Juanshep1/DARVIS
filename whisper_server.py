#!/usr/bin/env python3
"""
Local Whisper STT server for Spectra on Raspberry Pi.
Accepts audio via POST and returns transcribed text.

Usage:
    pip install faster-whisper flask
    python whisper_server.py

Endpoints:
    POST /transcribe  — upload WAV/WebM audio, get text back
    GET  /health      — liveness check
"""

import io
import os
import tempfile
from flask import Flask, request, jsonify

app = Flask(__name__)

# Lazy-load the model so startup is fast
_model = None
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "tiny")  # tiny | base | small


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        # Use int8 on CPU for Pi performance
        _model = WhisperModel(
            MODEL_SIZE,
            device="cpu",
            compute_type="int8",
        )
        print(f"[whisper] Loaded model: {MODEL_SIZE} (int8 CPU)")
    return _model


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "model": MODEL_SIZE})


@app.route("/transcribe", methods=["POST"])
def transcribe():
    # Accept raw audio in the body or as a file upload
    if request.content_type and "multipart" in request.content_type:
        f = request.files.get("audio") or request.files.get("file")
        if not f:
            return jsonify({"error": "no audio file"}), 400
        audio_bytes = f.read()
    else:
        audio_bytes = request.get_data()

    if not audio_bytes or len(audio_bytes) < 100:
        return jsonify({"error": "empty audio"}), 400

    # Write to a temp file (faster-whisper needs a file path)
    suffix = ".webm" if b"webm" in audio_bytes[:32] else ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        model = get_model()
        segments, info = model.transcribe(
            tmp_path,
            language="en",
            beam_size=3,
            vad_filter=True,
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return jsonify({
            "text": text,
            "language": info.language,
            "duration": round(info.duration, 2),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


if __name__ == "__main__":
    port = int(os.environ.get("WHISPER_PORT", "9000"))
    print(f"[whisper] Starting on port {port} with model '{MODEL_SIZE}'")
    # Pre-load the model on startup
    get_model()
    app.run(host="0.0.0.0", port=port, threaded=True)
