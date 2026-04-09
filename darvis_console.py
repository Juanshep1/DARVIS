#!/usr/bin/env python3
"""
D.A.R.V.I.S. Console — macOS desktop app with holographic orb.
Compact mode: floating orb + status. Double-click to expand.
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
        NSFontAttributeName, NSForegroundColorAttributeName,
        NSTrackingArea, NSTrackingActiveAlways, NSTrackingMouseEnteredAndExited,
    )
    from Foundation import NSRect, NSPoint, NSSize, NSMakeRect, NSDate, NSAttributedString, NSMutableAttributedString, NSRange
except ImportError as e:
    print(f"PyObjC required ({e}). Install: pip3 install pyobjc-framework-Cocoa pyobjc-framework-Quartz")
    sys.exit(1)

# ── Theme ─────────────────────────────────────────────────────────────────────
BG = (0.02, 0.02, 0.03, 1.0)
BG_CARD = (0.047, 0.047, 0.07, 0.95)
CYAN = (0.0, 0.9, 1.0)
BLUE = (0.31, 0.71, 1.0)
ORANGE = (1.0, 0.67, 0.25)
RED = (1.0, 0.32, 0.32)
GREEN = (0.0, 0.9, 0.46)
TEXT = (0.78, 0.79, 0.82)
DIM = (0.33, 0.33, 0.38)
FONT = "Menlo"

COMPACT_W = 260
COMPACT_H = 310

# ── Globals ───────────────────────────────────────────────────────────────────
brain = None
tts = None
ear = None
ollama_key = ""
elevenlabs_key = ""
gemini_key = ""
audio_mode = "classic"
backend_ready = False
console_app = None  # Set after init


def init_backend():
    global brain, tts, ear, ollama_key, elevenlabs_key, gemini_key, backend_ready
    try:
        from darvis import Brain, Ear, ElevenLabsVoice, load_env, load_settings

        env = load_env()
        ollama_key = env.get("OLLAMA_API_KEY", os.environ.get("OLLAMA_API_KEY", ""))
        elevenlabs_key = env.get("ELEVENLABS_API_KEY", os.environ.get("ELEVENLABS_API_KEY", ""))
        gemini_key = env.get("GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY", ""))

        settings = load_settings()

        brain = Brain(api_key=ollama_key, model=settings.get("model", "") or "glm-5")
        tts = ElevenLabsVoice(api_key=elevenlabs_key)
        if settings.get("voice_id"):
            tts.set_voice(settings["voice_id"])
        ear = Ear()
        ear.init_mic()
        backend_ready = True
    except Exception as e:
        print(f"Backend init error: {e}")
        import traceback
        traceback.print_exc()
        backend_ready = False


# ── Clickable Orb View ────────────────────────────────────────────────────────

class ClickableOrbView(NSView):
    """Holographic wireframe sphere. Accepts clicks for expand/collapse."""

    def initWithFrame_(self, frame):
        self = objc.super(ClickableOrbView, self).initWithFrame_(frame)
        if self is None:
            return None
        self.phase = 0.0
        self.state = 'idle'
        self._speak_intensity = 0.0
        self.click_callback = None
        self.drag_callback = None
        self._drag_origin = None
        self._win_origin = None
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
                'ox': math.cos(theta) * r, 'oy': y, 'oz': math.sin(theta) * r,
                'pulse': random.random() * math.pi * 2,
                'size': 1.2 + random.random() * 1.8,
            })

    def mouseDown_(self, event):
        if event.clickCount() >= 2:
            if self.click_callback:
                self.click_callback()
        else:
            # Start drag
            self._drag_origin = event.locationInWindow()
            win = self.window()
            if win:
                self._win_origin = win.frame().origin

    def mouseDragged_(self, event):
        if self._drag_origin is not None and self._win_origin is not None:
            win = self.window()
            if win:
                cur = event.locationInWindow()
                dx = cur.x - self._drag_origin.x
                dy = cur.y - self._drag_origin.y
                new_x = self._win_origin.x + dx
                new_y = self._win_origin.y + dy
                win.setFrameOrigin_(NSPoint(new_x, new_y))

    def mouseUp_(self, event):
        self._drag_origin = None
        self._win_origin = None

    def acceptsFirstResponder(self):
        return True

    def acceptsFirstMouse_(self, event):
        return True

    def drawRect_(self, rect):
        NSColor.clearColor().set()
        NSBezierPath.fillRect_(rect)

        w = rect.size.width
        h = rect.size.height
        cx, cy = w / 2, h / 2
        radius = min(w, h) * 0.38
        conn_dist = radius * 0.6

        self.phase += 0.015 + self._speak_intensity * 0.015
        if self.state == 'speaking':
            self._speak_intensity = min(self._speak_intensity + 0.1, 1.2)
        else:
            self._speak_intensity *= 0.95
        si = self._speak_intensity

        colors = {
            'idle': (0.31, 0.71, 1.0), 'thinking': (1.0, 0.67, 0.25),
            'speaking': (0.0, 0.9, 1.0), 'listening': (1.0, 0.32, 0.32),
        }
        cr, cg, cb = colors.get(self.state, (0.31, 0.71, 1.0))

        # Center glow
        gr = radius * 0.6
        for i in range(12, 0, -1):
            frac = i / 12.0
            s = gr * frac
            a = (0.06 + si * 0.08) * (1 - frac)
            NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, a).set()
            NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(cx - s, cy - s, s * 2, s * 2)).fill()

        # Project
        ry = self.phase
        rx = math.sin(self.phase * 0.3) * 0.3
        cy_, sy_ = math.cos(ry), math.sin(ry)
        cx_, sx_ = math.cos(rx), math.sin(rx)

        projected = []
        for n in self.nodes:
            x = n['ox'] * cy_ - n['oz'] * sy_
            z = n['ox'] * sy_ + n['oz'] * cy_
            y = n['oy'] * cx_ - z * sx_
            z2 = n['oy'] * sx_ + z * cx_
            dist = 1 + si * (0.15 + math.sin(n['pulse'] + self.phase * 5) * 0.1)
            scale = 1 / (1 + z2 * 0.3)
            projected.append((
                cx + x * radius * scale * dist,
                cy + y * radius * scale * dist,
                z2, n['pulse'], scale, n['size']
            ))
        projected.sort(key=lambda p: p[2])

        # Connections
        for i in range(len(projected)):
            for j in range(i + 1, len(projected)):
                dx = projected[i][0] - projected[j][0]
                dy = projected[i][1] - projected[j][1]
                d = math.sqrt(dx * dx + dy * dy)
                if d < conn_dist:
                    dep = (projected[i][2] + projected[j][2] + 2) / 4
                    a = (1 - d / conn_dist) * 0.3 * max(0, dep)
                    NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, a).set()
                    p = NSBezierPath.bezierPath()
                    p.moveToPoint_(NSPoint(projected[i][0], projected[i][1]))
                    p.lineToPoint_(NSPoint(projected[j][0], projected[j][1]))
                    p.setLineWidth_(0.5)
                    p.stroke()

        # Nodes
        t = self.phase * 2
        for sx, sy, depth, pulse, scale, nsz in projected:
            alpha = max(0, (depth + 1.5) / 2.5)
            pa = 0.5 + math.sin(pulse + t) * 0.3
            sz = nsz * scale * (1 + si * 0.5)
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


# ── Console App ───────────────────────────────────────────────────────────────

class DarvisConsoleApp:
    def __init__(self):
        self.app = NSApplication.sharedApplication()
        self.app.setActivationPolicy_(0)  # Regular app (shows in Dock)
        self.expanded = False
        self.orb_state = 'idle'
        self.mq = queue.Queue()
        self.listening = False
        self.chat_history = []  # Keep history across compact/expand

        # Init backend
        self.backend_thread = threading.Thread(target=self._init_backend, daemon=True)
        self.backend_thread.start()

        # Build compact window
        self._build_compact()

        # Timers
        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            1.0 / 30.0, self, 'tick:', None, True)
        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            0.1, self, 'drain:', None, True)

    def _init_backend(self):
        init_backend()
        model_name = brain.model if backend_ready else "error"
        self.mq.put(('ui', lambda: self._update_compact_status()))
        if backend_ready:
            self.mq.put(('system', f"Backend ready. Model: {model_name}"))

    def _update_compact_status(self):
        if hasattr(self, 'compact_status') and self.compact_status:
            txt = f"{brain.model}" if backend_ready else "Connecting..."
            self.compact_status.setStringValue_(txt)
        if hasattr(self, 'compact_hint') and self.compact_hint:
            self.compact_hint.setStringValue_("Double-click orb to open console")

    # ── Compact Mode ──────────────────────────────────────────────────────────

    def _build_compact(self):
        screen = NSScreen.mainScreen().frame()
        x = screen.size.width - COMPACT_W - 30
        y = 60

        self.window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(x, y, COMPACT_W, COMPACT_H),
            NSWindowStyleMaskBorderless,
            NSBackingStoreBuffered, False)
        self.window.setLevel_(NSFloatingWindowLevel)
        self.window.setOpaque_(False)
        self.window.setBackgroundColor_(NSColor.clearColor())
        self.window.setHasShadow_(False)
        self.window.setIgnoresMouseEvents_(False)

        content = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, COMPACT_W, COMPACT_H))

        # Title
        title = self._make_label(NSMakeRect(0, COMPACT_H - 25, COMPACT_W, 18),
                                 "D . A . R . V . I . S .", 8, BLUE, center=True)
        content.addSubview_(title)

        # Orb
        orb_sz = 200
        orb_x = (COMPACT_W - orb_sz) / 2
        self.orb_view = ClickableOrbView.alloc().initWithFrame_(
            NSMakeRect(orb_x, 55, orb_sz, orb_sz))
        self.orb_view.state = self.orb_state
        self.orb_view.click_callback = lambda: self._expand()
        content.addSubview_(self.orb_view)

        # Status (model name)
        self.compact_status = self._make_label(
            NSMakeRect(0, 30, COMPACT_W, 16),
            "Initializing..." if not backend_ready else brain.model,
            9, TEXT, center=True)
        content.addSubview_(self.compact_status)

        # Hint
        self.compact_hint = self._make_label(
            NSMakeRect(0, 10, COMPACT_W, 14),
            "Double-click orb to open console", 8, DIM, center=True)
        content.addSubview_(self.compact_hint)

        self.window.setContentView_(content)
        self.window.makeKeyAndOrderFront_(None)
        self.app.activateIgnoringOtherApps_(True)
        self.expanded = False

    # ── Expanded Mode ─────────────────────────────────────────────────────────

    def _expand(self):
        self.expanded = True
        screen = NSScreen.mainScreen().frame()
        ew, eh = 850, 650
        ex = (screen.size.width - ew) / 2
        ey = (screen.size.height - eh) / 2

        self.window.setStyleMask_(
            NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
            NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
        self.window.setTitle_("D.A.R.V.I.S. Console")
        self.window.setLevel_(NSNormalWindowLevel)
        self.window.setOpaque_(True)
        self.window.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*BG))
        self.window.setHasShadow_(True)
        self.window.setMinSize_(NSSize(600, 450))
        self.window.setFrame_display_animate_(NSMakeRect(ex, ey, ew, eh), True, True)

        self._build_expanded(ew, eh)

    def _build_expanded(self, w, h):
        content = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, w, h))

        # ── Header bar ──
        header_y = h - 40
        title = self._make_label(NSMakeRect(15, header_y + 5, 200, 20),
                                 "D . A . R . V . I . S .", 9, BLUE)
        content.addSubview_(title)

        model_txt = f"Model: {brain.model}  |  Voice: {tts.voice_name if tts else '...'}" if backend_ready else "Connecting..."
        self.header_info = self._make_label(NSMakeRect(220, header_y + 5, w - 240, 20),
                                            model_txt, 9, DIM)
        self.header_info.setAlignment_(2)  # Right align
        content.addSubview_(self.header_info)

        # Separator
        sep = NSView.alloc().initWithFrame_(NSMakeRect(15, header_y - 1, w - 30, 1))
        sep.setWantsLayer_(True)
        sep.layer().setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(1, 1, 1, 0.06).CGColor())
        content.addSubview_(sep)

        # ── Orb (smaller in expanded) ──
        orb_sz = 130
        orb_x = (w - orb_sz) / 2
        orb_y = header_y - orb_sz - 10
        self.orb_view = ClickableOrbView.alloc().initWithFrame_(
            NSMakeRect(orb_x, orb_y, orb_sz, orb_sz))
        self.orb_view.state = self.orb_state
        self.orb_view.click_callback = None  # No action in expanded
        content.addSubview_(self.orb_view)

        # Status below orb
        self.status_label = self._make_label(
            NSMakeRect(0, orb_y - 22, w, 16), self._status_text(), 10, DIM, center=True)
        content.addSubview_(self.status_label)

        # ── Chat transcript ──
        chat_top = orb_y - 40
        chat_bottom = 100
        chat_h = chat_top - chat_bottom
        if chat_h < 50:
            chat_h = 50

        scroll = NSScrollView.alloc().initWithFrame_(NSMakeRect(15, chat_bottom, w - 30, chat_h))
        scroll.setHasVerticalScroller_(True)
        scroll.setBorderType_(0)
        scroll.setDrawsBackground_(True)
        scroll.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*BG_CARD))

        self.chat_view = NSTextView.alloc().initWithFrame_(NSMakeRect(0, 0, w - 45, chat_h))
        self.chat_view.setEditable_(False)
        self.chat_view.setSelectable_(True)
        self.chat_view.setRichText_(True)
        self.chat_view.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*BG_CARD))
        self.chat_view.setFont_(NSFont.fontWithName_size_(FONT, 12))
        self.chat_view.setTextContainerInset_(NSSize(10, 10))
        scroll.setDocumentView_(self.chat_view)
        content.addSubview_(scroll)

        # Replay chat history
        for sender, text, color in self.chat_history:
            self._append_chat_raw(sender, text, color)

        # ── Input row ──
        input_y = 55
        self.input_field = NSTextField.alloc().initWithFrame_(NSMakeRect(15, input_y, w - 310, 32))
        self.input_field.setPlaceholderString_("Talk to DARVIS... (Enter to send)")
        self.input_field.setTextColor_(NSColor.whiteColor())
        self.input_field.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.06, 0.06, 0.10, 1))
        self.input_field.setFont_(NSFont.fontWithName_size_(FONT, 12))
        self.input_field.setFocusRingType_(1)
        self.input_field.setBordered_(True)
        self.input_field.setTarget_(self)
        self.input_field.setAction_(b"sendMessage:")
        content.addSubview_(self.input_field)

        # Buttons
        bx = w - 290
        content.addSubview_(self._make_btn(NSMakeRect(bx, input_y, 55, 32), "Send", b"sendMessage:"))
        bx += 60
        self.mic_btn = self._make_btn(NSMakeRect(bx, input_y, 50, 32), "Mic", b"toggleMic:")
        content.addSubview_(self.mic_btn)
        bx += 55
        content.addSubview_(self._make_btn(NSMakeRect(bx, input_y, 45, 32), "Fix", b"fixSelf:"))
        bx += 50
        content.addSubview_(self._make_btn(NSMakeRect(bx, input_y, 70, 32), "Compact", b"collapseWindow:"))

        # ── Bottom bar ──
        bar_txt = f"Mode: {audio_mode.upper()}"
        if ear and ear._mic_available:
            bar_txt += "  |  Mic: ready"
        bar_txt += f"  |  /fix /compact"
        self.bottom_label = self._make_label(NSMakeRect(15, 15, w - 30, 16), bar_txt, 8, DIM, center=True)
        content.addSubview_(self.bottom_label)

        # Separator above input
        sep2 = NSView.alloc().initWithFrame_(NSMakeRect(15, input_y + 40, w - 30, 1))
        sep2.setWantsLayer_(True)
        sep2.layer().setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(1, 1, 1, 0.04).CGColor())
        content.addSubview_(sep2)

        self.window.setContentView_(content)
        self.input_field.becomeFirstResponder()

    def _collapse(self):
        self.expanded = False
        self.window.setStyleMask_(NSWindowStyleMaskBorderless)
        screen = NSScreen.mainScreen().frame()
        x = screen.size.width - COMPACT_W - 30
        self.window.setFrame_display_animate_(
            NSMakeRect(x, 60, COMPACT_W, COMPACT_H), True, True)

        # Rebuild compact content
        content = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, COMPACT_W, COMPACT_H))

        title = self._make_label(NSMakeRect(0, COMPACT_H - 25, COMPACT_W, 18),
                                 "D . A . R . V . I . S .", 8, BLUE, center=True)
        content.addSubview_(title)

        orb_sz = 200
        orb_x = (COMPACT_W - orb_sz) / 2
        self.orb_view = ClickableOrbView.alloc().initWithFrame_(
            NSMakeRect(orb_x, 55, orb_sz, orb_sz))
        self.orb_view.state = self.orb_state
        self.orb_view.click_callback = lambda: self._expand()
        content.addSubview_(self.orb_view)

        self.compact_status = self._make_label(
            NSMakeRect(0, 30, COMPACT_W, 16),
            brain.model if backend_ready else "...", 9, TEXT, center=True)
        content.addSubview_(self.compact_status)

        self.compact_hint = self._make_label(
            NSMakeRect(0, 10, COMPACT_W, 14),
            "Double-click to expand", 8, DIM, center=True)
        content.addSubview_(self.compact_hint)

        self.window.setLevel_(NSFloatingWindowLevel)
        self.window.setOpaque_(False)
        self.window.setBackgroundColor_(NSColor.clearColor())
        self.window.setHasShadow_(False)
        self.window.setContentView_(content)

    # ── Timer callbacks ───────────────────────────────────────────────────────

    def tick_(self, timer):
        self.orb_view.setNeedsDisplay_(True)

    def drain_(self, timer):
        while not self.mq.empty():
            try:
                kind, data = self.mq.get_nowait()
                if kind == 'ui' and callable(data):
                    data()
                elif kind == 'response':
                    self._append_chat("DARVIS", data, TEXT)
                elif kind == 'user':
                    self._append_chat("You", data, CYAN)
                elif kind == 'system':
                    self._append_chat("System", data, ORANGE)
                elif kind == 'state':
                    self.orb_state = data
                    self.orb_view.state = data
                    if hasattr(self, 'status_label') and self.status_label:
                        self.status_label.setStringValue_(self._status_text())
            except queue.Empty:
                break

    # ── UI Helpers ────────────────────────────────────────────────────────────

    def _make_label(self, frame, text, size, color, center=False):
        lbl = NSTextField.alloc().initWithFrame_(frame)
        lbl.setStringValue_(text)
        lbl.setTextColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*color, 1))
        lbl.setFont_(NSFont.fontWithName_size_(FONT, size))
        lbl.setBezeled_(False)
        lbl.setDrawsBackground_(False)
        lbl.setEditable_(False)
        lbl.setSelectable_(False)
        if center:
            lbl.setAlignment_(1)
        return lbl

    def _make_btn(self, frame, title, action):
        btn = NSButton.alloc().initWithFrame_(frame)
        btn.setTitle_(title)
        btn.setBezelStyle_(NSBezelStyleRounded)
        btn.setFont_(NSFont.fontWithName_size_(FONT, 10))
        btn.setTarget_(self)
        btn.setAction_(action)
        return btn

    def _status_text(self):
        states = {'idle': 'Ready', 'thinking': 'Thinking...', 'speaking': 'Speaking...', 'listening': 'Listening...'}
        return states.get(self.orb_state, 'Ready')

    def _append_chat(self, sender, text, color):
        self.chat_history.append((sender, text, color))
        self._append_chat_raw(sender, text, color)

    def _append_chat_raw(self, sender, text, color):
        if not hasattr(self, 'chat_view') or self.chat_view is None:
            return
        storage = self.chat_view.textStorage()
        attrs = {
            NSFontAttributeName: NSFont.fontWithName_size_(FONT, 12),
            NSForegroundColorAttributeName: NSColor.colorWithCalibratedRed_green_blue_alpha_(*color, 1),
        }
        prefix = "\n" if storage.length() > 0 else ""
        line = f"{prefix}{sender}: {text}"
        attr_str = NSAttributedString.alloc().initWithString_attributes_(line, attrs)
        storage.appendAttributedString_(attr_str)
        rng = NSRange(storage.length(), 0)
        self.chat_view.scrollRangeToVisible_(rng)

    # ── Actions ───────────────────────────────────────────────────────────────

    def sendMessage_(self, sender):
        if not hasattr(self, 'input_field') or not self.input_field:
            return
        text = self.input_field.stringValue().strip()
        if not text:
            return
        self.input_field.setStringValue_("")

        if not backend_ready:
            self._append_chat("System", "Backend not ready yet.", ORANGE)
            return

        lower = text.lower()
        if lower == "/fix":
            self._run_fix()
            return
        if lower == "/compact":
            self._collapse()
            return
        if lower.startswith("/model "):
            new_model = text[7:].strip()
            brain.model = new_model
            from darvis import save_settings
            save_settings({"model": new_model, "voice_id": tts.voice_id if tts else ""})
            self._append_chat("System", f"Switched model to: {new_model}", GREEN)
            if hasattr(self, 'header_info'):
                self.header_info.setStringValue_(f"Model: {brain.model}  |  Voice: {tts.voice_name if tts else '...'}")
            return
        if lower == "/help":
            self._append_chat("System",
                "/fix — run diagnostics\n"
                "/compact — collapse to orb\n"
                "/model NAME — switch model\n"
                "/help — show this", DIM)
            return

        self._append_chat("You", text, CYAN)
        self.orb_view.state = 'thinking'
        self.orb_state = 'thinking'
        if hasattr(self, 'status_label') and self.status_label:
            self.status_label.setStringValue_("Thinking...")

        threading.Thread(target=self._think_thread, args=(text,), daemon=True).start()

    def _think_thread(self, user_input):
        try:
            from darvis import extract_and_run_commands
            response = brain.think(user_input)

            cmd_results = extract_and_run_commands(response)
            if cmd_results:
                context = "\n".join(cmd_results)
                self.mq.put(('system', f"Commands executed: {len(cmd_results)} result(s)"))
                response = brain.think(
                    "(Report the results naturally. Be concise.)", context=context)

            display = re.sub(r'```command\s*\n.*?\n```', '', response, flags=re.DOTALL).strip()
            if not display:
                display = response.strip()

            self.mq.put(('response', display))
            self.mq.put(('state', 'speaking'))

            if tts:
                tts.speak(display)
                time.sleep(0.5)
                while getattr(tts, '_speaking', False):
                    time.sleep(0.2)

            self.mq.put(('state', 'idle'))

        except Exception as e:
            self.mq.put(('system', f"Error: {e}"))
            self.mq.put(('state', 'idle'))

    def toggleMic_(self, sender):
        if not backend_ready or not ear:
            self._append_chat("System", "Backend not ready.", ORANGE)
            return

        if self.listening:
            self.listening = False
            self.mq.put(('state', 'idle'))
            self._append_chat("System", "Mic stopped.", DIM)
        else:
            self.listening = True
            self.mq.put(('state', 'listening'))
            self._append_chat("System", "Listening... speak now.", GREEN)
            threading.Thread(target=self._listen_loop, daemon=True).start()

    def _listen_loop(self):
        while self.listening:
            try:
                text = ear.listen()
                if text and self.listening:
                    self.listening = False
                    self.mq.put(('user', text))
                    self.mq.put(('state', 'thinking'))
                    self._think_thread(text)
                    return
            except Exception:
                time.sleep(0.5)

    def fixSelf_(self, sender):
        if not backend_ready:
            self._append_chat("System", "Backend not ready.", ORANGE)
            return
        self._run_fix()

    def _run_fix(self):
        self._append_chat("System", "Running diagnostics...", ORANGE)
        self.mq.put(('state', 'thinking'))
        threading.Thread(target=self._fix_thread, daemon=True).start()

    def _fix_thread(self):
        from darvis import check_ollama_cloud, list_cloud_models
        results = []
        fixed = []

        if check_ollama_cloud(ollama_key):
            models = list_cloud_models(ollama_key)
            if brain.model in models:
                results.append(f"Ollama Cloud: OK ({brain.model})")
            else:
                results.append(f"Ollama Cloud: online, model '{brain.model}' not in list")
        else:
            results.append("Ollama Cloud: UNREACHABLE")

        if tts:
            voices = tts.fetch_voices()
            results.append(f"ElevenLabs: OK ({tts.voice_name})" if voices else "ElevenLabs: UNREACHABLE")

        results.append("Gemini key: " + ("present" if gemini_key else "not configured"))

        if ear and ear._mic_available:
            results.append("Microphone: available")
        elif ear:
            if ear.init_mic():
                results.append("Microphone: reinitialized")
                fixed.append("reinitialized mic")
            else:
                results.append("Microphone: NOT AVAILABLE")

        if ear and getattr(ear, 'suppressed', False):
            ear.suppressed = False
            fixed.append("unblocked mic")

        summary = "\n".join(results)
        fix_str = ", ".join(fixed) if fixed else "No issues found"
        self.mq.put(('system', f"DIAGNOSTICS COMPLETE:\n{summary}\nFixed: {fix_str}"))
        self.mq.put(('state', 'idle'))

        if tts:
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
    console_app = DarvisConsoleApp()
    console_app.run()
