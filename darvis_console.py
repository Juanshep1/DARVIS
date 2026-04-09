#!/usr/bin/env python3
"""
D.A.R.V.I.S. Console — macOS desktop app with holographic orb.
Compact mode: floating orb + status. Double-click to expand.
Expanded mode: full console with ALL terminal darvis.py features.
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
    )
    from Foundation import NSMakeRect, NSPoint, NSSize, NSAttributedString, NSRange
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
WHITE = (1.0, 1.0, 1.0)
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
gemini_available = False
backend_ready = False
settings = {}
scheduler = None


def init_backend():
    global brain, tts, ear, ollama_key, elevenlabs_key, gemini_key
    global audio_mode, gemini_available, backend_ready, settings, scheduler
    try:
        from darvis import (
            Brain, Ear, ElevenLabsVoice, load_env, load_settings, save_settings,
            check_ollama_cloud, list_cloud_models, select_initial_voice,
        )

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

        # Gemini availability
        if gemini_key:
            try:
                from gemini_live import HAS_WS
                gemini_available = HAS_WS
            except ImportError:
                gemini_available = False

        # Scheduler
        try:
            from scheduler import DARVISScheduler
            scheduler = DARVISScheduler()
            scheduler.sync_from_cloud()
        except Exception:
            pass

        backend_ready = True
    except Exception as e:
        print(f"Backend init error: {e}")
        import traceback
        traceback.print_exc()
        backend_ready = False


# ── Holographic Orb View ──────────────────────────────────────────────────────

class ClickableOrbView(NSView):
    def initWithFrame_(self, frame):
        self = objc.super(ClickableOrbView, self).initWithFrame_(frame)
        if self is None:
            return None
        self.phase = 0.0
        self.state = 'idle'
        self._speak_intensity = 0.0
        self.click_callback = None
        self._drag_origin = None
        self._win_origin = None
        self.nodes = []
        self._gen()
        return self

    def _gen(self):
        import random
        golden = math.pi * (3 - math.sqrt(5))
        for i in range(90):
            y = 1 - (i / 89) * 2
            r = math.sqrt(1 - y * y)
            t = golden * i
            self.nodes.append({
                'ox': math.cos(t) * r, 'oy': y, 'oz': math.sin(t) * r,
                'pulse': random.random() * math.pi * 2,
                'size': 1.2 + random.random() * 1.8,
            })

    def mouseDown_(self, event):
        if event.clickCount() >= 2 and self.click_callback:
            self.click_callback()
        else:
            self._drag_origin = event.locationInWindow()
            w = self.window()
            if w:
                self._win_origin = w.frame().origin

    def mouseDragged_(self, event):
        if self._drag_origin and self._win_origin:
            w = self.window()
            if w:
                c = event.locationInWindow()
                w.setFrameOrigin_(NSPoint(
                    self._win_origin.x + c.x - self._drag_origin.x,
                    self._win_origin.y + c.y - self._drag_origin.y))

    def mouseUp_(self, event):
        self._drag_origin = None

    def acceptsFirstResponder(self):
        return True

    def acceptsFirstMouse_(self, event):
        return True

    def drawRect_(self, rect):
        NSColor.clearColor().set()
        NSBezierPath.fillRect_(rect)
        w, h = rect.size.width, rect.size.height
        cx, cy = w / 2, h / 2
        R = min(w, h) * 0.38
        cd = R * 0.6

        self.phase += 0.015 + self._speak_intensity * 0.015
        if self.state == 'speaking':
            self._speak_intensity = min(self._speak_intensity + 0.1, 1.2)
        else:
            self._speak_intensity *= 0.95
        si = self._speak_intensity

        cols = {'idle': (0.31, 0.71, 1.0), 'thinking': (1.0, 0.67, 0.25),
                'speaking': (0.0, 0.9, 1.0), 'listening': (1.0, 0.32, 0.32)}
        cr, cg, cb = cols.get(self.state, (0.31, 0.71, 1.0))

        # Center glow
        for i in range(12, 0, -1):
            f = i / 12.0
            s = R * 0.6 * f
            a = (0.06 + si * 0.08) * (1 - f)
            NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, a).set()
            NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(cx-s, cy-s, s*2, s*2)).fill()

        ry, rx = self.phase, math.sin(self.phase * 0.3) * 0.3
        cy_, sy_ = math.cos(ry), math.sin(ry)
        cx_, sx_ = math.cos(rx), math.sin(rx)
        proj = []
        for n in self.nodes:
            x = n['ox']*cy_ - n['oz']*sy_
            z = n['ox']*sy_ + n['oz']*cy_
            y = n['oy']*cx_ - z*sx_
            z2 = n['oy']*sx_ + z*cx_
            d = 1 + si * (0.15 + math.sin(n['pulse'] + self.phase*5)*0.1)
            sc = 1/(1+z2*0.3)
            proj.append((cx+x*R*sc*d, cy+y*R*sc*d, z2, n['pulse'], sc, n['size']))
        proj.sort(key=lambda p: p[2])

        for i in range(len(proj)):
            for j in range(i+1, len(proj)):
                dx, dy = proj[i][0]-proj[j][0], proj[i][1]-proj[j][1]
                dd = math.sqrt(dx*dx+dy*dy)
                if dd < cd:
                    dep = (proj[i][2]+proj[j][2]+2)/4
                    a = (1-dd/cd)*0.3*max(0, dep)
                    NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, a).set()
                    p = NSBezierPath.bezierPath()
                    p.moveToPoint_(NSPoint(proj[i][0], proj[i][1]))
                    p.lineToPoint_(NSPoint(proj[j][0], proj[j][1]))
                    p.setLineWidth_(0.5)
                    p.stroke()

        t = self.phase * 2
        for sx, sy, depth, pulse, scale, nsz in proj:
            al = max(0, (depth+1.5)/2.5)
            pa = 0.5 + math.sin(pulse+t)*0.3
            sz = nsz*scale*(1+si*0.5)
            g = sz*3
            NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, al*0.1*pa).set()
            NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(sx-g, sy-g, g*2, g*2)).fill()
            NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, al*0.8*pa).set()
            NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(sx-sz, sy-sz, sz*2, sz*2)).fill()
            c = sz*0.4
            NSColor.colorWithCalibratedRed_green_blue_alpha_(1, 1, 1, al*0.6*pa).set()
            NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(sx-c, sy-c, c*2, c*2)).fill()

    def isOpaque(self):
        return False


# ── Custom Styled Views ───────────────────────────────────────────────────────

class GlowBackgroundView(NSView):
    """Dark background with subtle radial glow from center-top."""

    def drawRect_(self, rect):
        w, h = rect.size.width, rect.size.height
        # Base background
        NSColor.colorWithCalibratedRed_green_blue_alpha_(0.02, 0.02, 0.03, 1).set()
        NSBezierPath.fillRect_(rect)
        # Radial glow — cyan tint from top center
        for i in range(20, 0, -1):
            frac = i / 20.0
            radius = max(w, h) * 0.5 * frac
            alpha = 0.012 * (1 - frac)
            cx, cy = w / 2, h * 0.85
            NSColor.colorWithCalibratedRed_green_blue_alpha_(0.1, 0.4, 0.7, alpha).set()
            NSBezierPath.bezierPathWithOvalInRect_(
                NSMakeRect(cx - radius, cy - radius, radius * 2, radius * 2)
            ).fill()
        # Subtle bottom glow — purple tint
        for i in range(15, 0, -1):
            frac = i / 15.0
            radius = w * 0.4 * frac
            alpha = 0.008 * (1 - frac)
            NSColor.colorWithCalibratedRed_green_blue_alpha_(0.42, 0.39, 1.0, alpha).set()
            NSBezierPath.bezierPathWithOvalInRect_(
                NSMakeRect(w * 0.5 - radius, -radius * 0.5, radius * 2, radius * 2)
            ).fill()

    def isOpaque(self):
        return True


class GlowLineView(NSView):
    """Horizontal line with center glow effect."""

    def drawRect_(self, rect):
        w = rect.size.width
        cy = rect.size.height / 2
        # Gradient line: transparent -> cyan -> transparent
        steps = 40
        for i in range(steps):
            frac = i / (steps - 1)
            # Bell curve alpha
            alpha = math.exp(-((frac - 0.5) ** 2) / 0.05) * 0.25
            x = frac * w
            seg_w = w / steps + 1
            NSColor.colorWithCalibratedRed_green_blue_alpha_(0.0, 0.7, 0.9, alpha).set()
            NSBezierPath.fillRect_(NSMakeRect(x, cy - 0.5, seg_w, 1))
        # Base dim line across full width
        NSColor.colorWithCalibratedRed_green_blue_alpha_(1, 1, 1, 0.04).set()
        NSBezierPath.fillRect_(NSMakeRect(0, cy - 0.5, w, 1))

    def isOpaque(self):
        return False


class RoundedCardView(NSView):
    """Dark card with rounded corners, subtle border, and inner shadow."""

    def drawRect_(self, rect):
        w, h = rect.size.width, rect.size.height
        r = 10  # corner radius
        inset = NSMakeRect(0.5, 0.5, w - 1, h - 1)
        path = NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(inset, r, r)
        # Fill
        NSColor.colorWithCalibratedRed_green_blue_alpha_(0.035, 0.035, 0.055, 0.95).set()
        path.fill()
        # Border glow
        NSColor.colorWithCalibratedRed_green_blue_alpha_(0.0, 0.5, 0.7, 0.12).set()
        path.setLineWidth_(1)
        path.stroke()
        # Inner top highlight
        NSColor.colorWithCalibratedRed_green_blue_alpha_(1, 1, 1, 0.02).set()
        NSBezierPath.fillRect_(NSMakeRect(r, h - 2, w - r * 2, 1))

    def isOpaque(self):
        return False


class StyledButton(NSButton):
    """Custom drawn button with colored border and glow on hover."""

    _color = (0.0, 0.9, 1.0)
    _label = ""

    def initWithFrame_label_color_(self, frame, label, color):
        self = objc.super(StyledButton, self).initWithFrame_(frame)
        if self is None:
            return None
        self._color = color
        self._label = label
        self.setTitle_("")
        self.setBordered_(False)
        self.setWantsLayer_(True)
        return self

    def drawRect_(self, rect):
        w, h = rect.size.width, rect.size.height
        cr, cg, cb = self._color

        # Background
        r = 8
        inset = NSMakeRect(0.5, 0.5, w - 1, h - 1)
        path = NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(inset, r, r)
        NSColor.colorWithCalibratedRed_green_blue_alpha_(0.05, 0.05, 0.08, 0.9).set()
        path.fill()

        # Colored border
        NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, 0.3).set()
        path.setLineWidth_(1)
        path.stroke()

        # Label
        font = NSFont.fontWithName_size_(FONT, 9)
        attrs = {
            NSFontAttributeName: font,
            NSForegroundColorAttributeName: NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, 0.9),
        }
        text = NSAttributedString.alloc().initWithString_attributes_(self._label, attrs)
        tw = text.size().width
        th = text.size().height
        text.drawAtPoint_(NSPoint((w - tw) / 2, (h - th) / 2 - 1))

    def isOpaque(self):
        return False

    def acceptsFirstMouse_(self, event):
        return True


# ── Console App ───────────────────────────────────────────────────────────────

class AppController(NSView):
    """NSObject subclass so NSTimer/actions target an ObjC-compatible object."""

    def initWithApp_(self, darvis_app):
        self = objc.super(AppController, self).initWithFrame_(NSMakeRect(0, 0, 0, 0))
        if self is None:
            return None
        self.d = darvis_app
        return self

    def tick_(self, timer):
        self.d.tick_(timer)

    def drain_(self, timer):
        self.d.drain_(timer)

    def checkScheduler_(self, timer):
        self.d.checkScheduler_(timer)

    def sendMessage_(self, sender):
        self.d.sendMessage_(sender)

    def toggleMic_(self, sender):
        self.d.toggleMic_(sender)

    def fixSelf_(self, sender):
        self.d.fixSelf_(sender)

    def collapseWindow_(self, sender):
        self.d.collapseWindow_(sender)

    def showHelp_(self, sender):
        self.d.showHelp_(sender)


class DarvisConsoleApp:
    def __init__(self):
        self.app = NSApplication.sharedApplication()
        self.app.setActivationPolicy_(0)
        self.expanded = False
        self.orb_state = 'idle'
        self.mq = queue.Queue()
        self.listening = False
        self.chat_history = []

        # ObjC-compatible controller for timer/action targets
        self.ctrl = AppController.alloc().initWithApp_(self)

        threading.Thread(target=self._init_backend, daemon=True).start()
        self._build_compact()

        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            1.0/30.0, self.ctrl, 'tick:', None, True)
        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            0.1, self.ctrl, 'drain:', None, True)
        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            30.0, self.ctrl, 'checkScheduler:', None, True)

    def _init_backend(self):
        init_backend()
        self.mq.put(('ui', lambda: self._update_compact_status()))
        if backend_ready:
            self.mq.put(('system', f"Backend ready. Model: {brain.model} | Voice: {tts.voice_name}"))
            if gemini_available:
                self.mq.put(('system', "Gemini Live Audio available (/gemini)"))

    def _update_compact_status(self):
        if hasattr(self, 'compact_status') and self.compact_status:
            self.compact_status.setStringValue_(brain.model if backend_ready else "Connecting...")

    # ── Compact Mode ──────────────────────────────────────────────────────────

    def _build_compact(self):
        screen = NSScreen.mainScreen().frame()
        x = screen.size.width - COMPACT_W - 30

        self.window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(x, 60, COMPACT_W, COMPACT_H),
            NSWindowStyleMaskBorderless, NSBackingStoreBuffered, False)
        self.window.setLevel_(NSFloatingWindowLevel)
        self.window.setOpaque_(False)
        self.window.setBackgroundColor_(NSColor.clearColor())
        self.window.setHasShadow_(False)

        content = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, COMPACT_W, COMPACT_H))
        content.addSubview_(self._lbl(NSMakeRect(0, COMPACT_H-25, COMPACT_W, 18),
                                       "D . A . R . V . I . S .", 8, BLUE, 1))
        orb_sz = 200
        self.orb_view = ClickableOrbView.alloc().initWithFrame_(
            NSMakeRect((COMPACT_W-orb_sz)/2, 55, orb_sz, orb_sz))
        self.orb_view.state = self.orb_state
        self.orb_view.click_callback = lambda: self._expand()
        content.addSubview_(self.orb_view)

        self.compact_status = self._lbl(NSMakeRect(0, 30, COMPACT_W, 16),
            brain.model if backend_ready else "Initializing...", 9, TEXT, 1)
        content.addSubview_(self.compact_status)
        content.addSubview_(self._lbl(NSMakeRect(0, 10, COMPACT_W, 14),
            "Double-click to open console", 8, DIM, 1))

        self.window.setContentView_(content)
        self.window.makeKeyAndOrderFront_(None)
        self.app.activateIgnoringOtherApps_(True)
        self.expanded = False

    # ── Expanded Mode ─────────────────────────────────────────────────────────

    def _expand(self):
        self.expanded = True
        screen = NSScreen.mainScreen().frame()
        ew, eh = 850, 650
        self.window.setStyleMask_(
            NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
            NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
        self.window.setTitle_("D.A.R.V.I.S. Console")
        self.window.setLevel_(NSNormalWindowLevel)
        self.window.setOpaque_(True)
        self.window.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*BG))
        self.window.setHasShadow_(True)
        self.window.setMinSize_(NSSize(600, 450))
        self.window.setFrame_display_animate_(
            NSMakeRect((screen.size.width-ew)/2, (screen.size.height-eh)/2, ew, eh), True, True)
        self._build_expanded(ew, eh)

    def _build_expanded(self, w, h):
        # Account for title bar — content area is smaller
        ch_total = h - 28  # Title bar ~28px
        c = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, w, ch_total))

        # ── Background with subtle radial glow ──
        bg_view = GlowBackgroundView.alloc().initWithFrame_(NSMakeRect(0, 0, w, ch_total))
        c.addSubview_(bg_view)

        # ── Header bar ──
        hy = ch_total - 35
        c.addSubview_(self._lbl(NSMakeRect(20, hy + 6, 220, 18),
                                 "D . A . R . V . I . S .", 10, CYAN, 0))
        info = f"{brain.model}  ·  {tts.voice_name}  ·  {audio_mode.upper()}" if backend_ready else "Connecting..."
        self.header_info = self._lbl(NSMakeRect(240, hy + 6, w - 260, 18), info, 9, DIM)
        self.header_info.setAlignment_(2)
        c.addSubview_(self.header_info)

        # Glowing separator line
        sep = GlowLineView.alloc().initWithFrame_(NSMakeRect(20, hy, w - 40, 2))
        c.addSubview_(sep)

        # ── Orb (centered, proper positioning) ──
        orb_sz = 110
        oy = hy - orb_sz - 12
        self.orb_view = ClickableOrbView.alloc().initWithFrame_(
            NSMakeRect((w - orb_sz) / 2, oy, orb_sz, orb_sz))
        self.orb_view.state = self.orb_state
        c.addSubview_(self.orb_view)

        # Status with glow color matching orb state
        self.status_label = self._lbl(NSMakeRect(0, oy - 18, w, 14), self._state_txt(), 9, DIM, 1)
        c.addSubview_(self.status_label)

        # ── Chat transcript with styled card ──
        chat_top = oy - 32
        chat_bottom = 90
        chat_h = max(chat_top - chat_bottom, 80)

        # Card backing with rounded corners and border glow
        card = RoundedCardView.alloc().initWithFrame_(
            NSMakeRect(14, chat_bottom - 2, w - 28, chat_h + 4))
        c.addSubview_(card)

        scroll = NSScrollView.alloc().initWithFrame_(NSMakeRect(16, chat_bottom, w - 32, chat_h))
        scroll.setHasVerticalScroller_(True)
        scroll.setBorderType_(0)
        scroll.setDrawsBackground_(False)
        scroll.setScrollerStyle_(1)  # Overlay scroller

        self.chat_view = NSTextView.alloc().initWithFrame_(NSMakeRect(0, 0, w - 50, chat_h))
        self.chat_view.setEditable_(False)
        self.chat_view.setSelectable_(True)
        self.chat_view.setRichText_(True)
        self.chat_view.setDrawsBackground_(True)
        self.chat_view.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.035, 0.035, 0.055, 1))
        self.chat_view.setFont_(NSFont.fontWithName_size_(FONT, 12))
        self.chat_view.setTextContainerInset_(NSSize(12, 10))
        scroll.setDocumentView_(self.chat_view)
        c.addSubview_(scroll)

        # Replay history
        for s, t, col in self.chat_history:
            self._chat_raw(s, t, col)

        # ── Input row with styled field ──
        iy = 48
        inp_w = w - 310

        # Input card background
        inp_card = RoundedCardView.alloc().initWithFrame_(NSMakeRect(14, iy - 2, inp_w + 4, 36))
        c.addSubview_(inp_card)

        self.input_field = NSTextField.alloc().initWithFrame_(NSMakeRect(16, iy, inp_w, 32))
        self.input_field.setPlaceholderString_("Talk to DARVIS...")
        self.input_field.setTextColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.9, 0.92, 0.95, 1))
        self.input_field.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.04, 0.04, 0.06, 1))
        self.input_field.setFont_(NSFont.fontWithName_size_(FONT, 12))
        self.input_field.setFocusRingType_(1)
        self.input_field.setBordered_(False)
        self.input_field.setTarget_(self.ctrl)
        self.input_field.setAction_(b"sendMessage:")
        c.addSubview_(self.input_field)

        # ── Styled buttons ──
        bx = w - 286
        btn_specs = [
            (56, "SEND",   b"sendMessage:",    CYAN),
            (46, "MIC",    b"toggleMic:",      GREEN if self.listening else BLUE),
            (40, "FIX",    b"fixSelf:",        ORANGE),
            (50, "MINI",   b"collapseWindow:", DIM),
            (32, "?",      b"showHelp:",       DIM),
        ]
        for bw, label, action, color in btn_specs:
            btn = StyledButton.alloc().initWithFrame_label_color_(
                NSMakeRect(bx, iy, bw, 32), label, color)
            btn.setTarget_(self.ctrl)
            btn.setAction_(action)
            c.addSubview_(btn)
            bx += bw + 4

        # ── Bottom status bar ──
        # Separator
        sep2 = GlowLineView.alloc().initWithFrame_(NSMakeRect(20, 34, w - 40, 1))
        c.addSubview_(sep2)

        bar = f"MODE: {audio_mode.upper()}"
        if gemini_available:
            bar += "  ·  GEMINI READY"
        bar += f"  ·  MIC {'ON' if self.listening else 'OFF'}"
        bar += f"  ·  /help for commands"
        self.bottom_label = self._lbl(NSMakeRect(20, 12, w - 40, 14), bar, 7, DIM, 1)
        c.addSubview_(self.bottom_label)

        self.window.setContentView_(c)
        self.input_field.becomeFirstResponder()

    def _collapse(self):
        self.expanded = False
        self.window.setStyleMask_(NSWindowStyleMaskBorderless)
        screen = NSScreen.mainScreen().frame()
        self.window.setFrame_display_animate_(
            NSMakeRect(screen.size.width-COMPACT_W-30, 60, COMPACT_W, COMPACT_H), True, True)

        content = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, COMPACT_W, COMPACT_H))
        content.addSubview_(self._lbl(NSMakeRect(0, COMPACT_H-25, COMPACT_W, 18),
                                       "D . A . R . V . I . S .", 8, BLUE, 1))
        orb_sz = 200
        self.orb_view = ClickableOrbView.alloc().initWithFrame_(
            NSMakeRect((COMPACT_W-orb_sz)/2, 55, orb_sz, orb_sz))
        self.orb_view.state = self.orb_state
        self.orb_view.click_callback = lambda: self._expand()
        content.addSubview_(self.orb_view)
        self.compact_status = self._lbl(NSMakeRect(0, 30, COMPACT_W, 16),
            brain.model if backend_ready else "...", 9, TEXT, 1)
        content.addSubview_(self.compact_status)
        content.addSubview_(self._lbl(NSMakeRect(0, 10, COMPACT_W, 14),
            "Double-click to expand", 8, DIM, 1))

        self.window.setLevel_(NSFloatingWindowLevel)
        self.window.setOpaque_(False)
        self.window.setBackgroundColor_(NSColor.clearColor())
        self.window.setHasShadow_(False)
        self.window.setContentView_(content)

    # ── Timers ────────────────────────────────────────────────────────────────

    def tick_(self, timer):
        self.orb_view.setNeedsDisplay_(True)

    def drain_(self, timer):
        while not self.mq.empty():
            try:
                k, d = self.mq.get_nowait()
                if k == 'ui' and callable(d):
                    d()
                elif k == 'response':
                    self._chat("DARVIS", d, TEXT)
                elif k == 'user':
                    self._chat("You", d, CYAN)
                elif k == 'system':
                    self._chat("System", d, ORANGE)
                elif k == 'state':
                    self.orb_state = d
                    self.orb_view.state = d
                    if hasattr(self, 'status_label') and self.status_label:
                        self.status_label.setStringValue_(self._state_txt())
            except queue.Empty:
                break

    def checkScheduler_(self, timer):
        if not backend_ready or not scheduler:
            return
        threading.Thread(target=self._run_scheduler, daemon=True).start()

    def _run_scheduler(self):
        from darvis import extract_and_run_commands
        try:
            scheduler.check_and_run(brain, extract_and_run_commands, None, tts)
        except Exception:
            pass

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _lbl(self, frame, text, size, color, align=0):
        l = NSTextField.alloc().initWithFrame_(frame)
        l.setStringValue_(text)
        l.setTextColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(*color, 1))
        l.setFont_(NSFont.fontWithName_size_(FONT, size))
        l.setBezeled_(False)
        l.setDrawsBackground_(False)
        l.setEditable_(False)
        l.setSelectable_(False)
        l.setAlignment_(align)
        return l

    def _btn(self, frame, title, action):
        b = NSButton.alloc().initWithFrame_(frame)
        b.setTitle_(title)
        b.setBezelStyle_(NSBezelStyleRounded)
        b.setFont_(NSFont.fontWithName_size_(FONT, 10))
        b.setTarget_(self.ctrl)
        b.setAction_(action)
        return b

    def _state_txt(self):
        return {'idle': 'Ready', 'thinking': 'Thinking...', 'speaking': 'Speaking...', 'listening': 'Listening...'}.get(self.orb_state, 'Ready')

    def _chat(self, sender, text, color):
        self.chat_history.append((sender, text, color))
        self._chat_raw(sender, text, color)

    def _chat_raw(self, sender, text, color):
        if not hasattr(self, 'chat_view') or not self.chat_view:
            return
        st = self.chat_view.textStorage()
        attrs = {
            NSFontAttributeName: NSFont.fontWithName_size_(FONT, 12),
            NSForegroundColorAttributeName: NSColor.colorWithCalibratedRed_green_blue_alpha_(*color, 1),
        }
        pre = "\n" if st.length() > 0 else ""
        s = NSAttributedString.alloc().initWithString_attributes_(f"{pre}{sender}: {text}", attrs)
        st.appendAttributedString_(s)
        self.chat_view.scrollRangeToVisible_(NSRange(st.length(), 0))

    def _update_header(self):
        if hasattr(self, 'header_info') and self.header_info and backend_ready:
            self.header_info.setStringValue_(
                f"Model: {brain.model}  |  Voice: {tts.voice_name}  |  Mode: {audio_mode}")
        if hasattr(self, 'bottom_label') and self.bottom_label:
            bar = f"Mode: {audio_mode.upper()}"
            if gemini_available:
                bar += " | Gemini: ready"
            bar += f" | Mic: {'on' if self.listening else 'off'}"
            self.bottom_label.setStringValue_(bar)

    # ── Command Handler ───────────────────────────────────────────────────────

    def sendMessage_(self, sender):
        if not hasattr(self, 'input_field') or not self.input_field:
            return
        text = self.input_field.stringValue().strip()
        if not text:
            return
        self.input_field.setStringValue_("")

        if not backend_ready:
            self._chat("System", "Backend not ready yet.", ORANGE)
            return

        lower = text.lower().strip()

        # ── Slash commands (matching terminal darvis.py exactly) ──

        if lower in ("goodbye", "exit", "quit"):
            self._chat("DARVIS", "Goodbye, sir. I'll be here if you need me.", TEXT)
            if tts:
                threading.Thread(target=lambda: (tts.speak("Goodbye, sir."), time.sleep(2), os._exit(0)), daemon=True).start()
            else:
                self.app.terminate_(None)
            return

        if lower in ("/type", "/text"):
            self.listening = False
            self.mq.put(('state', 'idle'))
            self._chat("System", "Mic off — text only. /listen to resume.", GREEN)
            self._update_header()
            return

        if lower in ("/listen", "/mic"):
            if ear and ear._mic_available:
                self.listening = True
                self.mq.put(('state', 'listening'))
                self._chat("System", "Mic on — listening. /type to pause.", GREEN)
                self._update_header()
                threading.Thread(target=self._listen_loop, daemon=True).start()
            else:
                self._chat("System", "No microphone available.", RED)
            return

        if lower == "/gemini":
            global audio_mode
            if gemini_available:
                audio_mode = "gemini"
                self._chat("System", "Gemini Live Audio mode. /classic to switch back.", GREEN)
                self._update_header()
            else:
                self._chat("System", "Gemini not available — set GEMINI_API_KEY and install websockets.", RED)
            return

        if lower == "/classic":
            audio_mode = "classic"
            self._chat("System", "Classic mode (Ollama + ElevenLabs).", GREEN)
            self._update_header()
            return

        if lower.startswith("/browse "):
            goal = text[8:].strip()
            if goal and gemini_key:
                self._chat("System", f"Launching browser agent: {goal}", BLUE)
                threading.Thread(target=self._browse_thread, args=(goal,), daemon=True).start()
            elif not gemini_key:
                self._chat("System", "No GEMINI_API_KEY — add it to .env", RED)
            else:
                self._chat("System", "Usage: /browse <goal>", DIM)
            return

        if lower == "/voices" or lower.startswith("/voice "):
            if lower.startswith("/voice ") and len(lower) > 7:
                arg = text.split(None, 1)[1]
                from darvis import ElevenLabsVoice as ELV
                matched = False
                for name, info in ELV.PRESET_VOICES.items():
                    if arg.lower() == name:
                        tts.set_voice(info["id"])
                        matched = True
                        break
                if not matched:
                    tts.set_voice(arg)
                from darvis import save_settings as ss
                settings["voice_id"] = tts.voice_id
                ss(settings)
                self._chat("System", f"Voice: {tts.voice_name}", GREEN)
                self._update_header()
                threading.Thread(target=lambda: tts.speak("Voice updated. How do I sound, sir?"), daemon=True).start()
            else:
                from darvis import ElevenLabsVoice as ELV
                names = ", ".join(f"{n} ({v['desc']})" for n, v in ELV.PRESET_VOICES.items())
                self._chat("System", f"Available voices: {names}\n\nUse /voice NAME to switch.", DIM)
            return

        if lower in ("/models", "/model", "/m") or lower.startswith("/model "):
            if lower.startswith("/model ") and len(lower) > 7:
                new_model = text.split(None, 1)[1]
            else:
                from darvis import list_cloud_models
                models = list_cloud_models(ollama_key)
                self._chat("System", f"Available models: {', '.join(models[:15])}\n\nUse /model NAME to switch.", DIM)
                return
            brain.model = new_model
            from darvis import save_settings as ss
            settings["model"] = new_model
            ss(settings)
            self._chat("System", f"Model: {new_model}", GREEN)
            self._update_header()
            return

        if lower == "/briefing":
            self._chat("System", "Running briefing...", BLUE)
            threading.Thread(target=self._briefing_thread, daemon=True).start()
            return

        if lower == "/fix":
            self._run_fix()
            return

        if lower == "/compact":
            self._collapse()
            return

        if lower == "/help":
            self.showHelp_(None)
            return

        # ── Regular message ───────────────────────────────────────────────────
        self._chat("You", text, CYAN)
        self.mq.put(('state', 'thinking'))
        threading.Thread(target=self._think_thread, args=(text,), daemon=True).start()

    # ── Background Threads ────────────────────────────────────────────────────

    def _think_thread(self, user_input):
        try:
            from darvis import extract_and_run_commands
            response = brain.think(user_input)

            cmd_results = extract_and_run_commands(response)
            if cmd_results:
                self.mq.put(('system', f"Executed {len(cmd_results)} command(s)"))
                context = "\n".join(cmd_results)
                response = brain.think(
                    "(Report the results naturally. Be concise.)", context=context)

            display = re.sub(r'```command\s*\n.*?\n```', '', response, flags=re.DOTALL).strip()
            if not display:
                display = response.strip()

            self.mq.put(('response', display))
            self.mq.put(('state', 'speaking'))

            # TTS — Gemini mode uses Gemini TTS, classic uses ElevenLabs
            if audio_mode == "gemini" and gemini_available:
                try:
                    from gemini_live import run_gemini_text_turn
                    run_gemini_text_turn(
                        api_key=gemini_key,
                        text=f"Say this exactly: {display}",
                        system_instruction="You are DARVIS. Speak naturally in a British accent.",
                    )
                except Exception:
                    if tts:
                        tts.speak(display)
                        tts.wait_for_speech()
            elif tts:
                tts.speak(display)
                tts.wait_for_speech()

            self.mq.put(('state', 'idle'))
        except Exception as e:
            self.mq.put(('system', f"Error: {e}"))
            self.mq.put(('state', 'idle'))

    def _listen_loop(self):
        while self.listening:
            try:
                text = ear.listen()
                if text and self.listening:
                    self.listening = False
                    self.mq.put(('user', text))
                    self.mq.put(('state', 'thinking'))
                    self._update_header()
                    self._think_thread(text)
                    return
            except Exception:
                time.sleep(0.5)

    def _browse_thread(self, goal):
        self.mq.put(('state', 'thinking'))
        try:
            if ear:
                ear.suppressed = True
            from computer_use import run_agent
            summary = run_agent(gemini_key, goal)
            self.mq.put(('response', f"Agent complete: {summary}"))
            if tts:
                tts.speak(summary)
                tts.wait_for_speech()
        except Exception as e:
            self.mq.put(('system', f"Agent error: {e}"))
        finally:
            if ear:
                ear.suppressed = False
            self.mq.put(('state', 'idle'))

    def _briefing_thread(self):
        self.mq.put(('state', 'thinking'))
        try:
            from darvis import extract_and_run_commands
            resp = brain.think("""Do ALL of these NOW with command blocks:
1. fetch_url https://wttr.in/?format=%C+%t+%h+%w to get weather
2. search_web for today's top news
3. Create a briefing file on Desktop called DARVIS_Briefing.txt with date, time, weather, and top 5 news stories with summaries
4. Open that file with open_file
5. Navigate Safari to https://news.google.com""")
            results = extract_and_run_commands(resp)
            context = "\n".join(results) if results else ""
            summary = brain.think(
                f"You just ran a briefing. Results:\n{context}\n\n"
                "Give a spoken briefing: greeting, weather, 2-3 news stories summarized. 5-7 sentences. No command blocks."
            )
            summary = re.sub(r'```command\s*\n.*?\n```', '', summary, flags=re.DOTALL).strip()
            if summary:
                self.mq.put(('response', summary))
                self.mq.put(('state', 'speaking'))
                if tts:
                    tts.speak(summary)
                    tts.wait_for_speech()
        except Exception as e:
            self.mq.put(('system', f"Briefing error: {e}"))
        self.mq.put(('state', 'idle'))

    # ── Fix Yourself ──────────────────────────────────────────────────────────

    def fixSelf_(self, sender):
        if not backend_ready:
            self._chat("System", "Backend not ready.", ORANGE)
            return
        self._run_fix()

    def _run_fix(self):
        self._chat("System", "Running diagnostics...", ORANGE)
        self.mq.put(('state', 'thinking'))
        threading.Thread(target=self._fix_thread, daemon=True).start()

    def _fix_thread(self):
        from darvis import check_ollama_cloud, list_cloud_models
        results = []
        fixed = []

        if check_ollama_cloud(ollama_key):
            models = list_cloud_models(ollama_key)
            results.append(f"Ollama Cloud: OK ({brain.model})" if brain.model in models
                          else f"Ollama Cloud: online, model '{brain.model}' not found")
        else:
            results.append("Ollama Cloud: UNREACHABLE")

        if tts:
            voices = tts.fetch_voices()
            results.append(f"ElevenLabs: OK ({tts.voice_name})" if voices else "ElevenLabs: UNREACHABLE")

        results.append("Gemini: " + ("available" if gemini_available else "key " + ("present" if gemini_key else "missing")))

        if ear and ear._mic_available:
            results.append("Microphone: OK")
        elif ear and ear.init_mic():
            results.append("Microphone: reinitialized")
            fixed.append("reinitialized mic")
        else:
            results.append("Microphone: NOT AVAILABLE")

        if ear and getattr(ear, 'suppressed', False):
            ear.suppressed = False
            fixed.append("unblocked mic")

        fix_str = ", ".join(fixed) if fixed else "No issues"
        self.mq.put(('system', "DIAGNOSTICS:\n" + "\n".join(results) + f"\nFixed: {fix_str}"))
        self.mq.put(('state', 'idle'))

        if tts:
            fail = sum(1 for r in results if "UNREACHABLE" in r or "NOT AVAILABLE" in r)
            tts.speak(f"Diagnostics complete. {fail} issues found." if fail else "All systems nominal, sir.")

    # ── Other Actions ─────────────────────────────────────────────────────────

    def toggleMic_(self, sender):
        if not backend_ready or not ear:
            self._chat("System", "Backend not ready.", ORANGE)
            return
        if self.listening:
            self.listening = False
            self.mq.put(('state', 'idle'))
            self._chat("System", "Mic off.", DIM)
        else:
            self.listening = True
            self.mq.put(('state', 'listening'))
            self._chat("System", "Listening... speak now.", GREEN)
            threading.Thread(target=self._listen_loop, daemon=True).start()
        self._update_header()

    def showHelp_(self, sender):
        self._chat("System",
            "/listen — start mic  |  /type — stop mic\n"
            "/gemini — Gemini Live Audio  |  /classic — Ollama + ElevenLabs\n"
            "/voice NAME — change voice  |  /voices — list voices\n"
            "/model NAME — change model  |  /models — list models\n"
            "/browse GOAL — browser agent  |  /briefing — news briefing\n"
            "/fix — diagnostics  |  /compact — minimize to orb\n"
            "goodbye — exit", DIM)

    def collapseWindow_(self, sender):
        self._collapse()

    def run(self):
        self.app.run()


if __name__ == "__main__":
    app = DarvisConsoleApp()
    app.run()
