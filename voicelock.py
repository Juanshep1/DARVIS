"""
S.P.E.C.T.R.A. Voice Biometric Lock — only respond to owner's voice.
Uses MFCC feature extraction + cosine similarity for speaker verification.
"""

import io
import wave
import struct
import math
import json
from pathlib import Path

VOICEPRINT_PATH = Path(__file__).parent / "voiceprint.json"
THRESHOLD = 0.70  # Cosine similarity threshold for match


class VoiceLock:
    def __init__(self):
        self.voiceprint = None
        self.locked = False
        self._load()

    def _load(self):
        if VOICEPRINT_PATH.exists():
            try:
                data = json.loads(VOICEPRINT_PATH.read_text())
                self.voiceprint = data.get("features")
            except Exception:
                pass

    def is_enrolled(self) -> bool:
        return self.voiceprint is not None

    def enroll(self, wav_bytes: bytes) -> bool:
        """Extract features from WAV audio and save as voiceprint."""
        features = self._extract_features(wav_bytes)
        if features and len(features) > 0:
            self.voiceprint = features
            VOICEPRINT_PATH.write_text(json.dumps({"features": features}))
            return True
        return False

    def verify(self, wav_bytes: bytes) -> tuple[bool, float]:
        """Compare audio against saved voiceprint. Returns (matched, score)."""
        if not self.voiceprint:
            return True, 1.0  # No voiceprint = always pass

        features = self._extract_features(wav_bytes)
        if not features:
            return False, 0.0

        score = self._cosine_similarity(self.voiceprint, features)
        return score >= THRESHOLD, score

    def _extract_features(self, wav_bytes: bytes) -> list[float] | None:
        """Extract simple spectral features from WAV audio (no scipy needed)."""
        try:
            with io.BytesIO(wav_bytes) as f:
                with wave.open(f, 'rb') as w:
                    n_channels = w.getnchannels()
                    sampwidth = w.getsampwidth()
                    framerate = w.getframerate()
                    n_frames = w.getnframes()
                    raw = w.readframes(n_frames)

            # Convert to mono float samples
            if sampwidth == 2:
                fmt = f"<{n_frames * n_channels}h"
                samples = list(struct.unpack(fmt, raw))
            else:
                return None

            # Mono mixdown
            if n_channels > 1:
                samples = [samples[i] for i in range(0, len(samples), n_channels)]

            # Normalize
            peak = max(abs(s) for s in samples) or 1
            samples = [s / peak for s in samples]

            # Split into frames and compute simple spectral features
            frame_size = int(framerate * 0.025)  # 25ms frames
            hop = int(framerate * 0.01)  # 10ms hop
            n_fft = 512

            # Compute averaged power spectrum (poor man's MFCC)
            n_bands = 20
            band_energies = [0.0] * n_bands

            frame_count = 0
            for start in range(0, len(samples) - frame_size, hop):
                frame = samples[start:start + frame_size]
                # Zero-pad to n_fft
                padded = frame + [0.0] * (n_fft - len(frame))

                # Simple DFT magnitude (first n_fft/2 bins)
                magnitudes = []
                for k in range(n_fft // 2):
                    real = sum(padded[n] * math.cos(2 * math.pi * k * n / n_fft) for n in range(n_fft))
                    imag = sum(padded[n] * math.sin(2 * math.pi * k * n / n_fft) for n in range(n_fft))
                    magnitudes.append(math.sqrt(real * real + imag * imag))

                # Accumulate into bands
                bins_per_band = len(magnitudes) // n_bands
                for b in range(n_bands):
                    band_start = b * bins_per_band
                    band_end = band_start + bins_per_band
                    band_energies[b] += sum(m * m for m in magnitudes[band_start:band_end])

                frame_count += 1
                if frame_count > 100:  # Limit computation
                    break

            if frame_count == 0:
                return None

            # Normalize
            band_energies = [e / frame_count for e in band_energies]
            total = sum(band_energies) or 1
            return [e / total for e in band_energies]

        except Exception:
            return None

    @staticmethod
    def _cosine_similarity(a: list[float], b: list[float]) -> float:
        if len(a) != len(b) or not a:
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        mag_a = math.sqrt(sum(x * x for x in a))
        mag_b = math.sqrt(sum(x * x for x in b))
        if mag_a == 0 or mag_b == 0:
            return 0.0
        return dot / (mag_a * mag_b)
