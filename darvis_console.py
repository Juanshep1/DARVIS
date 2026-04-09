#!/usr/bin/env python3
"""
D.A.R.V.I.S. Console — macOS desktop app with holographic orb.
Compact mode: floating orb + status. Click to expand.
Expanded mode: full console with chat, voice, commands, settings.
"""

import os
import sys
import math
import threading
import time
import re
import queue

sys.path.insert(0, os.path.dirname(__file__))

try:
    import objc
    from AppKit import (
        NSApplication, NSWindow, NSView, NSColor, NSBezierPath,
        NSWindowStyleMaskBorderless, NSWindowStyleMaskTitled,
        NSWindowStyleMaskClosable, NSWindowStyleMaskMiniaturizable,
        NSWindowStyleMaskResizable, NSBackingStoreBuffered,
        NSFloatingWindowLevel, NSNormalWindowLevel,
        NSScreen, NSTimer, NSEvent, NSFont,
        NSTextField, NSTextView, NSScrollView,
        NSButton, NSBezelStyleRounded,
    )
    from Foundation import NSRect, NSPoint, NSSize, NSMakeRect, NSDate, NSAttributedString, NSMutableAttributedString
except ImportError as e:
    print(f"PyObjC required ({e}). Install: pip3 install pyobjc-framework-Cocoa pyobjc-framework-Quartz")
    sys.exit(1)

# ── Theme (matching browser) ──────────────────────────────────────────────────
BG = (0.02, 0.02, 0.03, 1.0)
BG_CARD = (0.047, 0.047, 0.07, 0.95)
CYAN = (0.0, 0.9, 1.0)
ORANGE = (1.0, 0.67, 0.25)
RED = (1.0, 0.32, 0.32)
GREEN = (0.0, 0.9, 0.46)
TEXT = (0.78, 0.79, 0.82)
DIM = (0.33, 0.33, 0.38)
FONT = "Menlo"

COMPACT_SIZE = 250
ORB_RADIUS = 80

# ── Backend imports ───────────────────────────────────────────────────────────
brain = None
tts = None
ear = None
ollama_key = ""
elevenlabs_key = ""
gemini_key = ""
audio_mode = "classic"
backend_ready = False


def init_backend():
    """Initialize darvis.py components in background."""
    global brain, tts, ear, ollama_key, elevenlabs_key, gemini_key, backend_ready
    try:
        from darvis import (
            Brain, Ear, ElevenLabsVoice, load_env, get_key, load_settings,
            check_ollama_cloud, select_model, select_initial_voice,
            OLLAMA_URL, ELEVENLABS_URL,
        )

        env = load_env()
        ollama_key = env.get("OLLAMA_API_KEY", os.environ.get("OLLAMA_API_KEY", ""))
        elevenlabs_key = env.get("ELEVENLABS_API_KEY", os.environ.get("ELEVENLABS_API_KEY", ""))
        gemini_key = env.get("GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY", ""))

        settings = load_settings()
        saved_model = settings.get("model", "")
        saved_voice = settings.get("voice_id", "")

        brain_inst = Brain(api_key=ollama_key, model=saved_model or "glm-5")
        tts_inst = ElevenLabsVoice(api_key=elevenlabs_key)
        if saved_voice:
            tts_inst.set_voice(saved_voice)
        ear_inst = Ear()
        ear_inst.init_mic()

        brain = brain_inst
        tts = tts_inst
        ear = ear_inst
        backend_ready = True
    except Exception as e:
        print(f"Backend init error: {e}")
        backend_ready = False


# ── Holographic Orb View ──────────────────────────────────────────────────────

class OrbView(NSView):
    """Draws the holographic wireframe sphere (matching browser exactly)."""

    def initWithFrame_(self, frame):
        self = objc.super(OrbView, self).initWithFrame_(frame)
        if self is None:
            return None
        self.phase = 0.0
        self.state = 'idle'
        self._speak_intensity = 0.0
        self.nodes = []
        self._generate_nodes()
        return self

    def _generate_nodes(self):
        import random
        golden = math.pi * (3 - math.sqrt(5))
        count = 90
        for i in range(count):
            y = 1 - (i / (count - 1)) * 2
            r = math.sqrt(1 - y * y)
            theta = golden * i
            self.nodes.append({
                'ox': math.cos(theta) * r,
                'oy': y,
                'oz': math.sin(theta) * r,
                'pulse': random.random() * math.pi * 2,
                'size': 1.2 + random.random() * 1.8,
            })

    def drawRect_(self, rect):
        NSColor.clearColor().set()
        NSBezierPath.fillRect_(rect)

        w = rect.size.width
        h = rect.size.height
        cx, cy = w / 2, h / 2
        radius = min(w, h) * 0.38
        connection_dist = radius * 0.6

        self.phase += 0.015 + self._speak_intensity * 0.015
        if self.state == 'speaking':
            self._speak_intensity = min(self._speak_intensity + 0.1, 1.2)
        else:
            self._speak_intensity *= 0.95
        si = self._speak_intensity

        colors = {
            'idle': (0.31, 0.71, 1.0),
            'thinking': (1.0, 0.67, 0.25),
            'speaking': (0.0, 0.9, 1.0),
            'listening': (1.0, 0.32, 0.32),
        }
        cr, cg, cb = colors.get(self.state, (0.31, 0.71, 1.0))

        # Center glow
        glow_r = radius * 0.6
        for i in range(12, 0, -1):
            frac = i / 12.0
            s = glow_r * frac
            a = (0.06 + si * 0.08) * (1 - frac)
            NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, a).set()
            NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(cx - s, cy - s, s * 2, s * 2)).fill()

        # Project
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
            dist = 1 + si * (0.15 + math.sin(n['pulse'] + self.phase * 5) * 0.1)
            scale = 1 / (1 + z2 * 0.3)
            sx = cx + x * radius * scale * dist
            sy = cy + y * radius * scale * dist
            projected.append((sx, sy, z2, n['pulse'], scale, n['size']))

        projected.sort(key=lambda p: p[2])

        # Connections
        for i in range(len(projected)):
            for j in range(i + 1, len(projected)):
                dx = projected[i][0] - projected[j][0]
                dy = projected[i][1] - projected[j][1]
                d = math.sqrt(dx * dx + dy * dy)
                if d < connection_dist:
                    depth = (projected[i][2] + projected[j][2] + 2) / 4
                    a = (1 - d / connection_dist) * 0.3 * max(0, depth)
                    NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, a).set()
                    path = NSBezierPath.bezierPath()
                    path.moveToPoint_(NSPoint(projected[i][0], projected[i][1]))
                    path.lineToPoint_(NSPoint(projected[j][0], projected[j][1]))
                    path.setLineWidth_(0.5)
                    path.stroke()

        # Nodes
        t = self.phase * 2
        for sx, sy, depth, pulse, scale, node_size in projected:
            alpha = max(0, (depth + 1.5) / 2.5)
            pa = 0.5 + math.sin(pulse + t) * 0.3
            sz = node_size * scale * (1 + si * 0.5)

            g = sz * 3
            NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, alpha * 0.1 * pa).set()
            NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(sx - g, sy - g, g * 2, g * 2)).fill()

            NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, alpha * 0.8 * pa).set()
            NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(sx - sz, sy - sz, sz * 2, sz * 2)).fill()

            c = sz * 0.4
            NSColor.colorWithCalibratedRed_green_blue_alpha_(1, 1, 1, alpha * 0.6 * pa).set()
            NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(sx - c, sy - c, c * 2, c * 2)).fill()

    def isOpaque(self):
        return False

    def acceptsFirstResponder(self):
        return True


# ── Input Field Delegate ──────────────────────────────────────────────────────

class InputDelegate:
    """Handles Enter key in NSTextField."""
    def __init__(self, callback):
        self.callback = callback

    def control_textView_doCommandBySelector_(self, control, textView, selector):
        if selector == b"insertNewline:":
            self.callback()
            return True
        return False


# ── Console App ───────────────────────────────────────────────────────────────

class DarvisConsoleApp:
    def __init__(self):
        self.app = NSApplication.sharedApplication()
        self.expanded = False
        self.orb_state = 'idle'
        self.message_queue = queue.Queue()
        self.listening = False
        self.listen_thread = None

        # Init backend in background
        self.backend_thread = threading.Thread(target=self._init_backend_thread, daemon=True)
        self.backend_thread.start()

        # Create compact window
        screen = NSScreen.mainScreen().frame()
        x = screen.size.width - COMPACT_SIZE - 30
        y = 60

        self.window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(x, y, COMPACT_SIZE, COMPACT_SIZE + 30),
            NSWindowStyleMaskBorderless,
            NSBackingStoreBuffered,
            False,
        )
        self.window.setLevel_(NSFloatingWindowLevel)
        self.window.setOpaque_(False)
        self.window.setBackgroundColor_(NSColor.clearColor())
        self.window.setHasShadow_(False)
        self.window.setMovableByWindowBackground_(True)

        # Compact layout
        content = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, COMPACT_SIZE, COMPACT_SIZE + 30))

        self.orb_view = OrbView.alloc().initWithFrame_(NSMakeRect(25, 30, COMPACT_SIZE - 50, COMPACT_SIZE - 50))
        content.addSubview_(self.orb_view)

        self.compact_status = self._label(NSMakeRect(0, 5, COMPACT_SIZE, 20), "Initializing...", 9, DIM)
        content.addSubview_(self.compact_status)

        self.window.setContentView_(content)
        self.window.makeKeyAndOrderFront_(None)

        # Animation
        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            1.0 / 30.0, self, 'tick:', None, True
        )

        # Check message queue periodically
        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            0.1, self, 'checkQueue:', None, True
        )

        # Click to expand
        NSEvent.addLocalMonitorForEventsMatchingMask_handler_(1 << 0, self._handle_click)

    def _init_backend_thread(self):
        init_backend()
        self._update_main(lambda: self.compact_status.setStringValue_(
            f"Ready — {brain.model}" if backend_ready else "Backend error"
        ))

    def _update_main(self, fn):
        """Schedule a UI update on the main thread."""
        from Foundation import NSObject
        # Simple approach: use performSelectorOnMainThread via a helper
        self.message_queue.put(('ui', fn))

    def tick_(self, timer):
        self.orb_view.setNeedsDisplay_(True)

    def checkQueue_(self, timer):
        """Process queued UI updates on main thread."""
        while not self.message_queue.empty():
            try:
                msg_type, data = self.message_queue.get_nowait()
                if msg_type == 'ui' and callable(data):
                    data()
                elif msg_type == 'response':
                    self._append_chat("DARVIS", data, TEXT)
                elif msg_type == 'user':
                    self._append_chat("You", data, CYAN)
                elif msg_type == 'system':
                    self._append_chat("System", data, ORANGE)
                elif msg_type == 'state':
                    self.orb_state = data
                    self.orb_view.state = data
            except queue.Empty:
                break

    def _handle_click(self, event):
        if event.window() == self.window and not self.expanded:
            self._expand()
        return event

    # ── Compact/Expanded Toggle ───────────────────────────────────────────────

    def _expand(self):
        self.expanded = True
        screen = NSScreen.mainScreen().frame()
        ew, eh = 800, 620
        ex = (screen.size.width - ew) / 2
        ey = (screen.size.height - eh) / 2

        self.window.setStyleMask_(
            NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
            NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
        )
        self.window.setTitle_("D.A.R.V.I.S. Console")
        self.window.setLevel_(NSNormalWindowLevel)
        self.window.setOpaque_(True)
        self.window.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*BG))
        self.window.setHasShadow_(True)
        self.window.setFrame_display_animate_(NSMakeRect(ex, ey, ew, eh), True, True)

        self._build_expanded_view(ew, eh)

    def _collapse(self):
        self.expanded = False
        screen = NSScreen.mainScreen().frame()
        cx = screen.size.width - COMPACT_SIZE - 30
        cy = 60

        self.window.setStyleMask_(NSWindowStyleMaskBorderless)
        self.window.setLevel_(NSFloatingWindowLevel)
        self.window.setOpaque_(False)
        self.window.setBackgroundColor_(NSColor.clearColor())
        self.window.setHasShadow_(False)
        self.window.setMovableByWindowBackground_(True)
        self.window.setFrame_display_animate_(
            NSMakeRect(cx, cy, COMPACT_SIZE, COMPACT_SIZE + 30), True, True
        )

        content = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, COMPACT_SIZE, COMPACT_SIZE + 30))
        self.orb_view = OrbView.alloc().initWithFrame_(NSMakeRect(25, 30, COMPACT_SIZE - 50, COMPACT_SIZE - 50))
        self.orb_view.state = self.orb_state
        content.addSubview_(self.orb_view)
        status_text = f"Ready — {brain.model}" if backend_ready else "Initializing..."
        self.compact_status = self._label(NSMakeRect(0, 5, COMPACT_SIZE, 20), status_text, 9, DIM)
        content.addSubview_(self.compact_status)
        self.window.setContentView_(content)

    def _build_expanded_view(self, w, h):
        content = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, w, h))
        content.setAutoresizesSubviews_(True)

        # Orb (top center, 150x150)
        orb_size = 150
        orb_x = (w - orb_size) / 2
        self.orb_view = OrbView.alloc().initWithFrame_(NSMakeRect(orb_x, h - orb_size - 10, orb_size, orb_size))
        self.orb_view.state = self.orb_state
        content.addSubview_(self.orb_view)

        # Status label
        self.status_label = self._label(NSMakeRect(0, h - orb_size - 35, w, 18), "Ready", 10, DIM)
        content.addSubview_(self.status_label)

        # Chat transcript (NSScrollView + NSTextView)
        chat_y = 90
        chat_h = h - orb_size - 55 - chat_y
        scroll = NSScrollView.alloc().initWithFrame_(NSMakeRect(15, chat_y, w - 30, chat_h))
        scroll.setHasVerticalScroller_(True)
        scroll.setBorderType_(0)
        scroll.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*BG_CARD))

        self.chat_view = NSTextView.alloc().initWithFrame_(NSMakeRect(0, 0, w - 30, chat_h))
        self.chat_view.setEditable_(False)
        self.chat_view.setSelectable_(True)
        self.chat_view.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*BG_CARD))
        self.chat_view.setTextColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*TEXT, 1))
        self.chat_view.setFont_(NSFont.fontWithName_size_(FONT, 12))
        self.chat_view.setTextContainerInset_(NSSize(10, 10))
        scroll.setDocumentView_(self.chat_view)
        content.addSubview_(scroll)

        # Input field
        self.input_field = NSTextField.alloc().initWithFrame_(NSMakeRect(15, 50, w - 240, 30))
        self.input_field.setPlaceholderString_("Talk to DARVIS...")
        self.input_field.setTextColor_(NSColor.whiteColor())
        self.input_field.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.06, 0.06, 0.10, 1))
        self.input_field.setFont_(NSFont.fontWithName_size_(FONT, 12))
        self.input_field.setFocusRingType_(1)
        self.input_field.setBordered_(True)
        self.input_field.setTarget_(self)
        self.input_field.setAction_(b"sendMessage:")
        content.addSubview_(self.input_field)

        # Mic button
        mic_btn = self._button(NSMakeRect(w - 220, 50, 60, 30), "Mic", self, b"toggleMic:")
        content.addSubview_(mic_btn)

        # Fix Yourself button
        fix_btn = self._button(NSMakeRect(w - 155, 50, 60, 30), "Fix", self, b"fixSelf:")
        content.addSubview_(fix_btn)

        # Collapse button
        collapse_btn = self._button(NSMakeRect(w - 90, 50, 70, 30), "Compact", self, b"collapseWindow:")
        content.addSubview_(collapse_btn)

        # Bottom bar
        mode_text = f"Mode: {audio_mode.upper()}  |  Model: {brain.model if brain else '...'}"
        self.mode_label = self._label(NSMakeRect(15, 15, w - 30, 16), mode_text, 9, DIM)
        content.addSubview_(self.mode_label)

        self.window.setContentView_(content)
        self.input_field.becomeFirstResponder()

        # Show welcome
        self._append_chat("System", "Console ready. Type a message or click Mic for voice.", ORANGE)

    # ── UI Helpers ────────────────────────────────────────────────────────────

    def _label(self, frame, text, size, color):
        label = NSTextField.alloc().initWithFrame_(frame)
        label.setStringValue_(text)
        label.setTextColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*color, 1))
        label.setFont_(NSFont.fontWithName_size_(FONT, size))
        label.setBezeled_(False)
        label.setDrawsBackground_(False)
        label.setEditable_(False)
        label.setSelectable_(False)
        label.setAlignment_(1)  # Center
        return label

    def _button(self, frame, title, target, action):
        btn = NSButton.alloc().initWithFrame_(frame)
        btn.setTitle_(title)
        btn.setBezelStyle_(NSBezelStyleRounded)
        btn.setFont_(NSFont.fontWithName_size_(FONT, 10))
        btn.setTarget_(target)
        btn.setAction_(action)
        return btn

    def _append_chat(self, sender, text, color):
        """Append a message to the chat transcript."""
        if not hasattr(self, 'chat_view') or self.chat_view is None:
            return
        storage = self.chat_view.textStorage()
        attrs = {
            "NSFont": NSFont.fontWithName_size_(FONT, 12),
            "NSColor": NSColor.colorWithCalibratedRed_green_blue_alpha_(*color, 1),
        }
        line = f"\n{sender}: {text}" if storage.length() > 0 else f"{sender}: {text}"
        attr_str = NSAttributedString.alloc().initWithString_attributes_(line, attrs)
        storage.appendAttributedString_(attr_str)
        # Scroll to bottom
        self.chat_view.scrollRangeToVisible_((storage.length(), 0))

    # ── Actions ───────────────────────────────────────────────────────────────

    def sendMessage_(self, sender):
        text = self.input_field.stringValue().strip()
        if not text:
            return
        self.input_field.setStringValue_("")

        if not backend_ready:
            self._append_chat("System", "Backend not ready yet. Please wait.", ORANGE)
            return

        # Handle slash commands
        lower = text.lower()
        if lower == "/fix":
            self._run_fix()
            return
        if lower == "/compact":
            self._collapse()
            return

        self._append_chat("You", text, CYAN)
        self.orb_view.state = 'thinking'
        self.orb_state = 'thinking'
        if hasattr(self, 'status_label'):
            self.status_label.setStringValue_("Thinking...")

        threading.Thread(target=self._think_thread, args=(text,), daemon=True).start()

    def _think_thread(self, user_input):
        try:
            from darvis import extract_and_run_commands
            response = brain.think(user_input)

            # Execute command blocks
            cmd_results = extract_and_run_commands(response)
            if cmd_results:
                context = "\n".join(cmd_results)
                response = brain.think(
                    "(Report the results naturally. Be concise.)",
                    context=context,
                )

            # Clean response
            display = re.sub(r'```command\s*\n.*?\n```', '', response, flags=re.DOTALL).strip()
            if not display:
                display = response.strip()

            self.message_queue.put(('response', display))
            self.message_queue.put(('state', 'speaking'))
            self.message_queue.put(('ui', lambda: self.status_label.setStringValue_("Speaking...") if hasattr(self, 'status_label') else None))

            # TTS
            if tts:
                tts.speak(display)
                # Wait for speech to finish
                time.sleep(0.5)
                while getattr(tts, '_speaking', False):
                    time.sleep(0.2)

            self.message_queue.put(('state', 'idle'))
            self.message_queue.put(('ui', lambda: self.status_label.setStringValue_("Ready") if hasattr(self, 'status_label') else None))

        except Exception as e:
            self.message_queue.put(('system', f"Error: {e}"))
            self.message_queue.put(('state', 'idle'))

    def toggleMic_(self, sender):
        if not backend_ready or not ear:
            self._append_chat("System", "Backend not ready.", ORANGE)
            return

        if self.listening:
            self.listening = False
            self.orb_view.state = 'idle'
            self.orb_state = 'idle'
            if hasattr(self, 'status_label'):
                self.status_label.setStringValue_("Ready")
        else:
            self.listening = True
            self.orb_view.state = 'listening'
            self.orb_state = 'listening'
            if hasattr(self, 'status_label'):
                self.status_label.setStringValue_("Listening...")
            self.listen_thread = threading.Thread(target=self._listen_loop, daemon=True)
            self.listen_thread.start()

    def _listen_loop(self):
        while self.listening:
            try:
                text = ear.listen()
                if text and self.listening:
                    self.listening = False
                    self.message_queue.put(('user', text))
                    self.message_queue.put(('state', 'thinking'))
                    self.message_queue.put(('ui', lambda: self.status_label.setStringValue_("Thinking...") if hasattr(self, 'status_label') else None))
                    self._think_thread(text)
                    return
            except Exception:
                time.sleep(0.5)

    def fixSelf_(self, sender):
        if not backend_ready:
            self._append_chat("System", "Backend not ready yet.", ORANGE)
            return
        self._run_fix()

    def _run_fix(self):
        self._append_chat("System", "Running diagnostics...", ORANGE)
        self.orb_view.state = 'thinking'
        self.orb_state = 'thinking'
        threading.Thread(target=self._fix_thread, daemon=True).start()

    def _fix_thread(self):
        from darvis import check_ollama_cloud, list_cloud_models
        results = []
        fixed = []

        # 1. Ollama
        if check_ollama_cloud(ollama_key):
            models = list_cloud_models(ollama_key)
            if brain.model in models:
                results.append(f"Ollama Cloud: OK (model: {brain.model})")
            else:
                results.append(f"Ollama Cloud: online, model '{brain.model}' not found")
        else:
            results.append("Ollama Cloud: UNREACHABLE")

        # 2. ElevenLabs
        if tts:
            voices = tts.fetch_voices()
            results.append("ElevenLabs: OK" if voices else "ElevenLabs: UNREACHABLE")

        # 3. Gemini
        results.append("Gemini key: " + ("present" if gemini_key else "not configured"))

        # 4. Mic
        if ear and ear._mic_available:
            results.append("Microphone: available")
        else:
            if ear and ear.init_mic():
                results.append("Microphone: reinitialized")
                fixed.append("reinitialized mic")
            else:
                results.append("Microphone: NOT AVAILABLE")

        # 5. Reset states
        if ear and ear.suppressed:
            ear.suppressed = False
            fixed.append("unblocked mic")

        summary = "\n".join(results)
        fix_str = ", ".join(fixed) if fixed else "No issues found"
        self.message_queue.put(('system', f"DIAGNOSTICS:\n{summary}\n\nFixed: {fix_str}"))
        self.message_queue.put(('state', 'idle'))
        self.message_queue.put(('ui', lambda: self.status_label.setStringValue_("Ready") if hasattr(self, 'status_label') else None))

        if tts:
            ok = sum(1 for r in results if "OK" in r or "available" in r or "present" in r)
            fail = sum(1 for r in results if "UNREACHABLE" in r or "NOT AVAILABLE" in r)
            if fail:
                tts.speak(f"Diagnostics complete. {fail} issues found.")
            else:
                tts.speak("All systems nominal, sir.")

    def collapseWindow_(self, sender):
        self._collapse()

    def run(self):
        self.app.run()


if __name__ == "__main__":
    app = DarvisConsoleApp()
    app.run()
