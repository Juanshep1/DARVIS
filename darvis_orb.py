#!/usr/bin/env python3
"""
S.P.E.C.T.R.A. Floating Orb — Always-on macOS widget.
Uses native macOS APIs via PyObjC for true transparency.
"""

import subprocess
import os
import sys
import math
import threading
import time

sys.path.insert(0, os.path.dirname(__file__))

try:
    import objc
    from AppKit import (
        NSApplication, NSWindow, NSView, NSColor, NSBezierPath,
        NSWindowStyleMaskBorderless, NSBackingStoreBuffered,
        NSFloatingWindowLevel, NSScreen, NSTimer, NSRunLoop,
        NSEvent, NSLeftMouseDragged, NSFont, NSMutableParagraphStyle,
        NSTextAlignmentCenter, NSTextField, NSButton, NSBezelStyleRounded,
    )
    from Foundation import NSRect, NSPoint, NSSize, NSMakeRect, NSDate
    HAS_OBJC = True
except ImportError:
    HAS_OBJC = False

if not HAS_OBJC:
    print("PyObjC not installed. Install with: pip3 install pyobjc-framework-Cocoa pyobjc-framework-Quartz")
    print("Falling back to simple mode...")
    # Fallback: just run spectra.py
    os.execvp("python3", ["python3", os.path.join(os.path.dirname(__file__), "spectra.py")])

ORB_RADIUS = 80
WINDOW_SIZE = 200

class OrbView(NSView):
    """Custom NSView that draws the holographic wireframe sphere."""

    def initWithFrame_(self, frame):
        self = objc.super(OrbView, self).initWithFrame_(frame)
        if self is None:
            return None
        self.phase = 0.0
        self.state = 'idle'
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
        # Clear with transparency
        NSColor.clearColor().set()
        NSBezierPath.fillRect_(rect)

        w = rect.size.width
        h = rect.size.height
        cx, cy = w / 2, h / 2
        radius = ORB_RADIUS
        connection_dist = 50

        self.phase += 0.015 + getattr(self, '_speak_intensity', 0) * 0.015
        speak_intensity = getattr(self, '_speak_intensity', 0)
        if self.state == 'speaking':
            self._speak_intensity = min(getattr(self, '_speak_intensity', 0) + 0.1, 1.2)
        else:
            self._speak_intensity = speak_intensity * 0.95
        speak_intensity = self._speak_intensity

        # Colors per state (matching browser exactly)
        colors = {
            'idle': (0.31, 0.71, 1.0),
            'thinking': (1.0, 0.67, 0.25),
            'speaking': (0.0, 0.9, 1.0),
            'listening': (1.0, 0.32, 0.32),
        }
        cr, cg, cb = colors.get(self.state, (0.31, 0.71, 1.0))

        # Center glow (matching browser radial gradient)
        glow_alpha_base = 0.06 + speak_intensity * 0.08
        glow_radius = radius * 0.6
        glow_steps = 12
        for i in range(glow_steps, 0, -1):
            frac = i / glow_steps
            size = glow_radius * frac
            alpha = glow_alpha_base * (1 - frac)
            NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, alpha).set()
            NSBezierPath.bezierPathWithOvalInRect_(
                NSMakeRect(cx - size, cy - size, size * 2, size * 2)
            ).fill()

        # Project nodes
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

            # Speak distortion — nodes push outward (matching browser)
            dist = 1 + speak_intensity * (0.15 + math.sin(n['pulse'] + self.phase * 5) * 0.1)

            scale = 1 / (1 + z2 * 0.3)
            sx = cx + x * radius * scale * dist
            sy = cy + y * radius * scale * dist
            projected.append((sx, sy, z2, n['pulse'], scale, n['size']))

        # Sort by depth for proper layering (matching browser)
        projected.sort(key=lambda p: p[2])

        # Draw connections
        for i in range(len(projected)):
            for j in range(i + 1, len(projected)):
                dx = projected[i][0] - projected[j][0]
                dy = projected[i][1] - projected[j][1]
                d = math.sqrt(dx * dx + dy * dy)
                if d < connection_dist:
                    depth = (projected[i][2] + projected[j][2] + 2) / 4
                    alpha = (1 - d / connection_dist) * 0.3 * max(0, depth)
                    NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, alpha).set()
                    path = NSBezierPath.bezierPath()
                    path.moveToPoint_(NSPoint(projected[i][0], projected[i][1]))
                    path.lineToPoint_(NSPoint(projected[j][0], projected[j][1]))
                    path.setLineWidth_(0.5)
                    path.stroke()

        # Draw nodes (matching browser: glow + core + bright center)
        t = self.phase * 2
        for sx, sy, depth, pulse, scale, node_size in projected:
            alpha = max(0, (depth + 1.5) / 2.5)
            pulse_alpha = 0.5 + math.sin(pulse + t) * 0.3
            size = node_size * scale * (1 + speak_intensity * 0.5)

            # Glow
            NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, alpha * 0.1 * pulse_alpha).set()
            g = size * 3
            NSBezierPath.bezierPathWithOvalInRect_(
                NSMakeRect(sx - g, sy - g, g * 2, g * 2)
            ).fill()

            # Core
            NSColor.colorWithCalibratedRed_green_blue_alpha_(cr, cg, cb, alpha * 0.8 * pulse_alpha).set()
            NSBezierPath.bezierPathWithOvalInRect_(
                NSMakeRect(sx - size, sy - size, size * 2, size * 2)
            ).fill()

            # Bright center
            c = size * 0.4
            NSColor.colorWithCalibratedRed_green_blue_alpha_(1, 1, 1, alpha * 0.6 * pulse_alpha).set()
            NSBezierPath.bezierPathWithOvalInRect_(
                NSMakeRect(sx - c, sy - c, c * 2, c * 2)
            ).fill()

    def isOpaque(self):
        return False

    def acceptsFirstResponder(self):
        return True


class SpectraOrbApp:
    def __init__(self):
        self.app = NSApplication.sharedApplication()
        self.state = 'idle'
        self.expanded = False
        self.dropdown_window = None

        # Create main orb window — fully transparent, no shadow
        screen = NSScreen.mainScreen().frame()
        x = screen.size.width - WINDOW_SIZE - 20
        y = 60  # Bottom of screen

        self.window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(x, y, WINDOW_SIZE, WINDOW_SIZE),
            NSWindowStyleMaskBorderless,
            NSBackingStoreBuffered,
            False,
        )
        self.window.setLevel_(NSFloatingWindowLevel)
        self.window.setOpaque_(False)
        self.window.setBackgroundColor_(NSColor.clearColor())
        self.window.setHasShadow_(False)
        self.window.setMovableByWindowBackground_(True)
        self.window.setIgnoresMouseEvents_(False)

        # Create orb view
        self.orb_view = OrbView.alloc().initWithFrame_(NSMakeRect(0, 0, WINDOW_SIZE, WINDOW_SIZE))
        self.window.setContentView_(self.orb_view)
        self.window.makeKeyAndOrderFront_(None)

        # Animation timer
        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            1.0 / 30.0, self, 'tick:', None, True
        )

        # Click handler
        NSEvent.addLocalMonitorForEventsMatchingMask_handler_(
            1 << 0,  # NSLeftMouseDown
            self._handle_click,
        )

    def tick_(self, timer):
        self.orb_view.setNeedsDisplay_(True)

    def _handle_click(self, event):
        # Check if click is on our orb window
        loc = event.locationInWindow()
        win_frame = self.window.frame()

        if event.window() == self.window:
            if self.expanded:
                self._close_dropdown()
            else:
                self._open_dropdown()
        return event

    def _open_dropdown(self):
        self.expanded = True
        orb_frame = self.window.frame()
        dw, dh = 300, 180
        dx = orb_frame.origin.x - dw + WINDOW_SIZE
        dy = orb_frame.origin.y + WINDOW_SIZE + 5

        self.dropdown_window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(dx, dy, dw, dh),
            NSWindowStyleMaskBorderless,
            NSBackingStoreBuffered,
            False,
        )
        self.dropdown_window.setLevel_(NSFloatingWindowLevel)
        self.dropdown_window.setOpaque_(False)
        self.dropdown_window.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.04, 0.04, 0.06, 0.95))
        self.dropdown_window.setHasShadow_(True)

        view = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, dw, dh))

        # Title
        title = NSTextField.alloc().initWithFrame_(NSMakeRect(10, dh - 30, dw - 20, 20))
        title.setStringValue_("S.P.E.C.T.R.A.")
        title.setTextColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.29, 0.56, 0.85, 1))
        title.setFont_(NSFont.fontWithName_size_("Menlo", 11))
        title.setBezeled_(False)
        title.setDrawsBackground_(False)
        title.setEditable_(False)
        title.setSelectable_(False)
        view.addSubview_(title)

        # Input field
        self.input_field = NSTextField.alloc().initWithFrame_(NSMakeRect(10, dh - 65, dw - 20, 28))
        self.input_field.setPlaceholderString_("Ask SPECTRA...")
        self.input_field.setTextColor_(NSColor.whiteColor())
        self.input_field.setBackgroundColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.08, 0.08, 0.12, 1))
        self.input_field.setFont_(NSFont.fontWithName_size_("Menlo", 12))
        self.input_field.setFocusRingType_(1)
        view.addSubview_(self.input_field)

        # Status
        self.status_field = NSTextField.alloc().initWithFrame_(NSMakeRect(10, 10, dw - 20, 16))
        self.status_field.setStringValue_("Ready — type or press Enter")
        self.status_field.setTextColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.4, 0.4, 0.4, 1))
        self.status_field.setFont_(NSFont.fontWithName_size_("Menlo", 9))
        self.status_field.setBezeled_(False)
        self.status_field.setDrawsBackground_(False)
        self.status_field.setEditable_(False)
        view.addSubview_(self.status_field)

        self.dropdown_window.setContentView_(view)
        self.dropdown_window.makeKeyAndOrderFront_(None)
        self.input_field.becomeFirstResponder()

    def _close_dropdown(self):
        self.expanded = False
        if self.dropdown_window:
            self.dropdown_window.orderOut_(None)
            self.dropdown_window = None

    def run(self):
        self.app.run()


if __name__ == "__main__":
    app = SpectraOrbApp()
    app.run()
