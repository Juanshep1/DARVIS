"""
S.P.E.C.T.R.A. Gemini Live Audio — real-time speech-to-speech via WebSocket.
Handles bidirectional audio streaming with Gemini's native audio model.
Falls back gracefully if connection fails.
"""

import asyncio
import base64
import json
import struct
import threading
import os
import sys
import tempfile
import subprocess
from pathlib import Path

IS_MAC = sys.platform == "darwin"
IS_TERMUX = os.path.isdir("/data/data/com.termux") or "TERMUX_VERSION" in os.environ

try:
    import websockets
    HAS_WS = True
except ImportError:
    HAS_WS = False

try:
    import pyaudio
    HAS_PYAUDIO = True
except ImportError:
    HAS_PYAUDIO = False

GEMINI_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
DEFAULT_MODEL = "gemini-2.5-flash-native-audio-latest"
INPUT_RATE = 16000
OUTPUT_RATE = 24000
CHUNK_SIZE = 4096


class GeminiLiveSession:
    """Manages a bidirectional audio session with Gemini Live API."""

    def __init__(self, api_key: str, system_instruction: str = "",
                 voice_name: str = "Kore", model: str = DEFAULT_MODEL):
        self.api_key = api_key
        self.model = model
        self.system_instruction = system_instruction
        self.voice_name = voice_name
        self.ws = None
        self.connected = False
        self._audio_queue = asyncio.Queue()
        self._text_parts = []
        self._turn_complete = asyncio.Event()
        self._stop = asyncio.Event()

    async def connect(self) -> bool:
        """Connect to Gemini Live API and send setup."""
        if not HAS_WS:
            return False

        url = f"{GEMINI_WS_URL}?key={self.api_key}"
        try:
            self.ws = await asyncio.wait_for(
                websockets.connect(url, max_size=10 * 1024 * 1024),
                timeout=10,
            )
        except Exception as e:
            print(f"  [Gemini] Connection failed: {e}")
            return False

        # Send setup
        setup = {
            "setup": {
                "model": f"models/{self.model}",
                "generation_config": {
                    "response_modalities": ["AUDIO"],
                    "speech_config": {
                        "voice_config": {
                            "prebuilt_voice_config": {"voice_name": self.voice_name}
                        }
                    },
                },
                "system_instruction": {
                    "parts": [{"text": self.system_instruction}]
                },
            }
        }
        await self.ws.send(json.dumps(setup))

        # Wait for setupComplete
        try:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=10)
            msg = json.loads(raw)
            if msg.get("setupComplete") is not None:
                self.connected = True
                return True
        except Exception as e:
            print(f"  [Gemini] Setup failed: {e}")

        return False

    async def send_audio(self, pcm_bytes: bytes):
        """Send raw PCM audio (16kHz, 16-bit, mono) to Gemini."""
        if not self.ws or not self.connected:
            return
        b64 = base64.b64encode(pcm_bytes).decode()
        await self.ws.send(json.dumps({
            "realtimeInput": {
                "mediaChunks": [{
                    "data": b64,
                    "mimeType": "audio/pcm;rate=16000",
                }]
            }
        }))

    async def send_text(self, text: str):
        """Send a text message (for typed input in Gemini mode)."""
        if not self.ws or not self.connected:
            return
        self._turn_complete.clear()
        self._text_parts = []
        await self.ws.send(json.dumps({
            "clientContent": {
                "turns": [{"role": "user", "parts": [{"text": text}]}],
                "turnComplete": True,
            }
        }))

    async def receive_loop(self):
        """Process incoming messages from Gemini. Runs until stop."""
        try:
            async for raw in self.ws:
                if self._stop.is_set():
                    break
                try:
                    msg = json.loads(raw)

                    if msg.get("serverContent"):
                        parts = msg["serverContent"].get("modelTurn", {}).get("parts", [])
                        for part in parts:
                            if part.get("inlineData", {}).get("mimeType", "").startswith("audio"):
                                audio_bytes = base64.b64decode(part["inlineData"]["data"])
                                await self._audio_queue.put(audio_bytes)
                            if part.get("text"):
                                self._text_parts.append(part["text"])

                        if msg["serverContent"].get("turnComplete"):
                            await self._audio_queue.put(None)  # sentinel
                            self._turn_complete.set()

                except json.JSONDecodeError:
                    pass
        except websockets.exceptions.ConnectionClosed:
            self.connected = False

    async def get_audio_chunk(self) -> bytes | None:
        """Get next audio chunk (None = turn complete)."""
        return await self._audio_queue.get()

    def get_text(self) -> str:
        """Get accumulated text from the current turn."""
        return "".join(self._text_parts)

    async def wait_turn_complete(self):
        """Wait until the model finishes its turn."""
        await self._turn_complete.wait()
        self._turn_complete.clear()

    async def close(self):
        """Close the WebSocket connection."""
        self._stop.set()
        if self.ws:
            await self.ws.close()
            self.ws = None
        self.connected = False


def play_pcm_24k(pcm_bytes: bytes):
    """Play raw 24kHz 16-bit mono PCM audio."""
    tmp = tempfile.NamedTemporaryFile(suffix=".raw", delete=False)
    tmp.write(pcm_bytes)
    tmp.close()

    if IS_MAC:
        # Convert PCM to WAV on the fly, then play
        wav_path = tmp.name + ".wav"
        _pcm_to_wav(tmp.name, wav_path, OUTPUT_RATE)
        subprocess.run(["afplay", wav_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            os.unlink(wav_path)
        except OSError:
            pass
    elif IS_TERMUX:
        wav_path = tmp.name + ".wav"
        _pcm_to_wav(tmp.name, wav_path, OUTPUT_RATE)
        subprocess.run(["termux-media-player", "play", wav_path],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            os.unlink(wav_path)
        except OSError:
            pass
    elif HAS_PYAUDIO:
        p = pyaudio.PyAudio()
        stream = p.open(format=pyaudio.paInt16, channels=1, rate=OUTPUT_RATE, output=True)
        stream.write(pcm_bytes)
        stream.stop_stream()
        stream.close()
        p.terminate()

    try:
        os.unlink(tmp.name)
    except OSError:
        pass


def _pcm_to_wav(pcm_path: str, wav_path: str, sample_rate: int):
    """Convert raw PCM to WAV format."""
    pcm_data = Path(pcm_path).read_bytes()
    num_channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = len(pcm_data)

    with open(wav_path, "wb") as f:
        # RIFF header
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        # fmt chunk
        f.write(b"fmt ")
        f.write(struct.pack("<I", 16))
        f.write(struct.pack("<HHIIHH", 1, num_channels, sample_rate, byte_rate, block_align, bits_per_sample))
        # data chunk
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(pcm_data)


def run_gemini_text_turn(api_key: str, text: str, system_instruction: str,
                         voice_name: str = "Kore", model: str = DEFAULT_MODEL,
                         on_text=None, on_audio=None) -> str:
    """
    Run a single text→audio turn with Gemini Live API synchronously.
    Returns the text response. Calls on_audio(pcm_bytes) for each audio chunk.
    """
    async def _run():
        session = GeminiLiveSession(api_key, system_instruction, voice_name, model)
        ok = await session.connect()
        if not ok:
            return None

        # Start receive loop in background
        recv_task = asyncio.create_task(session.receive_loop())

        # Send text
        await session.send_text(text)

        # Collect audio chunks
        all_audio = bytearray()
        while True:
            chunk = await session.get_audio_chunk()
            if chunk is None:
                break
            all_audio.extend(chunk)
            if on_audio:
                on_audio(bytes(chunk))

        text_response = session.get_text()
        await session.close()
        recv_task.cancel()

        # Play collected audio
        if all_audio:
            play_pcm_24k(bytes(all_audio))

        return text_response

    try:
        return asyncio.run(_run())
    except Exception as e:
        print(f"  [Gemini] Error: {e}")
        return None
