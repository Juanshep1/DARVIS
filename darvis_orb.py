#!/usr/bin/env python3
"""
D.A.R.V.I.S. Floating Orb — Always-on macOS holographic orb widget.
A small floating sphere that represents the terminal DARVIS.
Click to expand a dropdown for voice/text input.
"""

import tkinter as tk
import threading
import math
import time
import subprocess
import os
import sys

# Add parent dir for imports
sys.path.insert(0, os.path.dirname(__file__))

ORB_SIZE = 80
CANVAS_SIZE = ORB_SIZE + 40  # Extra space for glow
DROPDOWN_W = 320
DROPDOWN_H = 200

class FloatingOrb:
    def __init__(self):
        self.root = tk.Tk()
        self.root.overrideredirect(True)  # No title bar
        self.root.attributes('-topmost', True)  # Always on top
        self.root.attributes('-alpha', 0.95)
        self.root.configure(bg='black')

        # Transparent background on macOS
        try:
            self.root.attributes('-transparent', True)
            self.root.config(bg='systemTransparent')
        except:
            pass

        # Position bottom-right
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        self.orb_x = screen_w - CANVAS_SIZE - 20
        self.orb_y = screen_h - CANVAS_SIZE - 60
        self.root.geometry(f"{CANVAS_SIZE}x{CANVAS_SIZE}+{self.orb_x}+{self.orb_y}")

        # Canvas for orb
        self.canvas = tk.Canvas(self.root, width=CANVAS_SIZE, height=CANVAS_SIZE,
                                bg='black', highlightthickness=0, bd=0)
        self.canvas.pack()

        # State
        self.state = 'idle'  # idle, thinking, speaking, listening
        self.expanded = False
        self.dropdown = None
        self.phase = 0
        self.nodes = []
        self.dragging = False
        self.drag_start_x = 0
        self.drag_start_y = 0

        # Generate sphere nodes (fibonacci)
        self._generate_nodes()

        # Bindings
        self.canvas.bind('<Button-1>', self._on_click)
        self.canvas.bind('<B1-Motion>', self._on_drag)
        self.canvas.bind('<ButtonPress-1>', self._on_press)

        # Start render loop
        self._draw()

    def _generate_nodes(self):
        golden = math.pi * (3 - math.sqrt(5))
        count = 40
        self.nodes = []
        for i in range(count):
            y = 1 - (i / (count - 1)) * 2
            r = math.sqrt(1 - y * y)
            theta = golden * i
            self.nodes.append({
                'ox': math.cos(theta) * r,
                'oy': y,
                'oz': math.sin(theta) * r,
                'pulse': i * 0.3,
            })

    def _draw(self):
        self.canvas.delete('all')
        cx, cy = CANVAS_SIZE // 2, CANVAS_SIZE // 2
        radius = ORB_SIZE // 2

        self.phase += 0.02

        # Color based on state
        colors = {
            'idle': (80, 180, 255),
            'thinking': (255, 171, 64),
            'speaking': (0, 229, 255),
            'listening': (255, 82, 82),
        }
        r, g, b = colors.get(self.state, (80, 180, 255))

        # Outer glow
        for i in range(3):
            alpha = 30 - i * 10
            size = radius + 10 + i * 5
            color = f'#{min(r+40,255):02x}{min(g+40,255):02x}{min(b+40,255):02x}'
            self.canvas.create_oval(
                cx - size, cy - size, cx + size, cy + size,
                fill='', outline=color, width=1
            )

        # Project and draw nodes
        rot_y = self.phase
        rot_x = math.sin(self.phase * 0.3) * 0.3
        cos_y, sin_y = math.cos(rot_y), math.sin(rot_y)
        cos_x, sin_x = math.cos(rot_x), math.sin(rot_x)

        projected = []
        for n in self.nodes:
            x = n['ox'] * cos_y - n['oz'] * sin_y
            z = n['ox'] * sin_y + n['oz'] * cos_y
            y = n['oy'] * cos_x - z * sin_x
            z2 = n['oy'] * sin_x + z * cos_x

            # Speak distortion
            dist = 1.0
            if self.state == 'speaking':
                dist += 0.15 * math.sin(n['pulse'] + self.phase * 3)

            scale = 1 / (1 + z2 * 0.3)
            sx = cx + x * radius * scale * dist
            sy = cy + y * radius * scale * dist
            projected.append((sx, sy, z2, n['pulse']))

        # Draw connections
        for i in range(len(projected)):
            for j in range(i + 1, len(projected)):
                dx = projected[i][0] - projected[j][0]
                dy = projected[i][1] - projected[j][1]
                dist = math.sqrt(dx * dx + dy * dy)
                if dist < 35:
                    depth = (projected[i][2] + projected[j][2] + 2) / 4
                    alpha = int(max(0, min(80, (1 - dist / 35) * 80 * depth)))
                    color = f'#{min(r,255):02x}{min(g,255):02x}{min(b,255):02x}'
                    self.canvas.create_line(
                        projected[i][0], projected[i][1],
                        projected[j][0], projected[j][1],
                        fill=color, width=1
                    )

        # Draw nodes
        for sx, sy, depth, pulse in projected:
            alpha = (depth + 1.5) / 2.5
            p = 0.5 + math.sin(pulse + self.phase * 2) * 0.3
            size = 2 * (1 + (0.3 if self.state == 'speaking' else 0))
            brightness = int(min(255, alpha * p * 255))
            color = f'#{min(r * brightness // 255, 255):02x}{min(g * brightness // 255, 255):02x}{min(b * brightness // 255, 255):02x}'
            self.canvas.create_oval(sx - size, sy - size, sx + size, sy + size, fill=color, outline='')

        self.root.after(33, self._draw)  # ~30fps

    def _on_press(self, event):
        self.drag_start_x = event.x_root - self.root.winfo_x()
        self.drag_start_y = event.y_root - self.root.winfo_y()
        self.dragging = False

    def _on_drag(self, event):
        self.dragging = True
        x = event.x_root - self.drag_start_x
        y = event.y_root - self.drag_start_y
        self.root.geometry(f"+{x}+{y}")
        if self.dropdown:
            self.dropdown.geometry(f"+{x}+{y - DROPDOWN_H - 5}")

    def _on_click(self, event):
        if self.dragging:
            self.dragging = False
            return
        if self.expanded:
            self._close_dropdown()
        else:
            self._open_dropdown()

    def _open_dropdown(self):
        self.expanded = True
        x = self.root.winfo_x()
        y = self.root.winfo_y()

        self.dropdown = tk.Toplevel(self.root)
        self.dropdown.overrideredirect(True)
        self.dropdown.attributes('-topmost', True)
        self.dropdown.configure(bg='#0a0a0f')
        self.dropdown.geometry(f"{DROPDOWN_W}x{DROPDOWN_H}+{x - DROPDOWN_W + CANVAS_SIZE}+{y - DROPDOWN_H - 5}")

        # Title
        title = tk.Label(self.dropdown, text="D.A.R.V.I.S.", font=("Menlo", 10, "bold"),
                         fg="#4a90d9", bg="#0a0a0f")
        title.pack(pady=(10, 5))

        # Text input
        self.input_var = tk.StringVar()
        entry = tk.Entry(self.dropdown, textvariable=self.input_var,
                         font=("Menlo", 12), fg="#e0e0e0", bg="#151520",
                         insertbackground="#4a90d9", relief="flat", bd=8)
        entry.pack(fill='x', padx=12, pady=5)
        entry.bind('<Return>', self._send_text)
        entry.focus_set()

        # Buttons
        btn_frame = tk.Frame(self.dropdown, bg="#0a0a0f")
        btn_frame.pack(fill='x', padx=12, pady=5)

        voice_btn = tk.Button(btn_frame, text="🎤 Voice", font=("Menlo", 10),
                              fg="#00E676", bg="#151520", relief="flat", bd=4,
                              command=self._toggle_voice)
        voice_btn.pack(side='left', expand=True, fill='x', padx=2)

        restart_btn = tk.Button(btn_frame, text="🔄 Restart", font=("Menlo", 10),
                                fg="#FFAB40", bg="#151520", relief="flat", bd=4,
                                command=self._restart_darvis)
        restart_btn.pack(side='left', expand=True, fill='x', padx=2)

        close_btn = tk.Button(btn_frame, text="✕ Close", font=("Menlo", 10),
                              fg="#FF5252", bg="#151520", relief="flat", bd=4,
                              command=self._close_dropdown)
        close_btn.pack(side='left', expand=True, fill='x', padx=2)

        # Status
        self.status_label = tk.Label(self.dropdown, text="Ready", font=("Menlo", 8),
                                     fg="#555", bg="#0a0a0f")
        self.status_label.pack(pady=(5, 10))

    def _close_dropdown(self):
        self.expanded = False
        if self.dropdown:
            self.dropdown.destroy()
            self.dropdown = None

    def _send_text(self, event=None):
        text = self.input_var.get().strip()
        if not text:
            return
        self.input_var.set("")
        self.state = 'thinking'
        if self.status_label:
            self.status_label.config(text="Thinking...")

        def _process():
            try:
                # Send to DARVIS chat API
                import urllib.request
                import json
                payload = json.dumps({"message": text}).encode()
                req = urllib.request.Request(
                    "https://darvis1.netlify.app/api/chat",
                    data=payload, method="POST",
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read().decode())
                    reply = data.get("reply", "No response")

                self.state = 'speaking'
                self.root.after(0, lambda: self._show_reply(reply))

                # TTS
                try:
                    tts_payload = json.dumps({"text": reply}).encode()
                    tts_req = urllib.request.Request(
                        "https://darvis1.netlify.app/api/tts",
                        data=tts_payload, method="POST",
                        headers={"Content-Type": "application/json"},
                    )
                    with urllib.request.urlopen(tts_req, timeout=30) as tts_resp:
                        audio = tts_resp.read()
                        if len(audio) > 100:
                            import tempfile
                            tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
                            tmp.write(audio)
                            tmp.close()
                            subprocess.run(["afplay", tmp.name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                            os.unlink(tmp.name)
                except Exception:
                    pass

                self.state = 'idle'
                self.root.after(0, lambda: self.status_label.config(text="Ready") if self.status_label else None)

            except Exception as e:
                self.state = 'idle'
                self.root.after(0, lambda: self._show_reply(f"Error: {e}"))

        threading.Thread(target=_process, daemon=True).start()

    def _show_reply(self, text):
        if self.status_label:
            self.status_label.config(text=text[:60] + ("..." if len(text) > 60 else ""))

    def _toggle_voice(self):
        self.state = 'listening'
        if self.status_label:
            self.status_label.config(text="Listening... (speak now)")
        # Use macOS dictation
        threading.Thread(target=self._voice_input, daemon=True).start()

    def _voice_input(self):
        try:
            import speech_recognition as sr
            r = sr.Recognizer()
            with sr.Microphone() as source:
                r.adjust_for_ambient_noise(source, duration=0.5)
                audio = r.listen(source, timeout=8, phrase_time_limit=15)
            text = r.recognize_google(audio)
            self.root.after(0, lambda: self.input_var.set(text))
            self.root.after(100, lambda: self._send_text())
        except Exception:
            self.state = 'idle'
            self.root.after(0, lambda: self.status_label.config(text="Voice failed") if self.status_label else None)

    def _restart_darvis(self):
        if self.status_label:
            self.status_label.config(text="Restarting DARVIS...")
        subprocess.Popen(
            ["osascript", "-e", 'tell application "Terminal" to do script "cd ~/darvis && python3 darvis.py"'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    app = FloatingOrb()
    app.run()
