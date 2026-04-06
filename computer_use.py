"""
D.A.R.V.I.S. Computer Use Agent — Gemini-powered browser automation.
Uses Playwright for headless browser control and Gemini Computer Use API
for visual understanding and action planning.
Screenshots stream to Netlify Blobs for cross-device viewing.
"""

import asyncio
import base64
import json
import urllib.request
import urllib.error
import os
import sys
from pathlib import Path

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta"
COMPUTER_USE_MODEL = "gemini-2.5-flash"  # Vision-capable model for screenshot analysis
VIEWPORT_W = 1280
VIEWPORT_H = 800
GRID_SIZE = 1000  # Gemini uses 1000x1000 coordinate grid
MAX_STEPS = 20
CLOUD_URL = "https://darvis1.netlify.app"

import re as _re

# Common site shortcuts for instant navigation
SITE_SHORTCUTS = {
    "amazon": "https://www.amazon.com",
    "youtube": "https://www.youtube.com",
    "google": "https://www.google.com",
    "espn": "https://www.espn.com",
    "ebay": "https://www.ebay.com",
    "walmart": "https://www.walmart.com",
    "netflix": "https://www.netflix.com",
    "twitter": "https://x.com",
    "x.com": "https://x.com",
    "reddit": "https://www.reddit.com",
    "wikipedia": "https://en.wikipedia.org",
    "google flights": "https://www.google.com/travel/flights",
    "gmail": "https://mail.google.com",
}

def _extract_start_url(goal: str) -> str | None:
    """Extract a URL or known site from the goal for instant navigation."""
    lower = goal.lower()
    # Check for explicit URLs
    url_match = _re.search(r'https?://\S+', goal)
    if url_match:
        return url_match.group(0).rstrip('.,;!?)')
    # Check for known site names (longest match first so "google flights" beats "google")
    for name in sorted(SITE_SHORTCUTS.keys(), key=len, reverse=True):
        if name in lower:
            return SITE_SHORTCUTS[name]
    return None

CAPTCHA_KEYWORDS = [
    "captcha", "robot", "verify you", "human verification", "security check",
    "challenge", "not a robot", "prove you", "unusual traffic",
    "access denied", "please verify",
]

try:
    from playwright.async_api import async_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False


class ComputerUseAgent:
    """Controls a headless browser via Gemini Computer Use API."""

    def __init__(self, api_key: str, model: str = COMPUTER_USE_MODEL):
        self.api_key = api_key
        self.model = model
        self.browser = None
        self.page = None
        self.playwright = None
        self.history = []  # conversation history for the agent
        self.step_count = 0
        self._status = {"active": False, "goal": "", "step": 0, "thinking": "", "actions": [], "done": False}

    async def start_browser(self, headless=False, start_url=None):
        """Launch Chromium via Playwright. Visible by default so user can watch."""
        if not HAS_PLAYWRIGHT:
            raise RuntimeError("Playwright not installed. Run: pip install playwright && playwright install chromium")
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=headless,
            args=["--window-size=1280,800", "--window-position=100,100"] if not headless else [],
        )
        self.page = await self.browser.new_page(viewport={"width": VIEWPORT_W, "height": VIEWPORT_H})
        url = start_url or "https://www.google.com"
        await self.page.goto(url, wait_until="domcontentloaded")
        await self.page.wait_for_timeout(1000)

    async def screenshot(self) -> bytes:
        """Take a PNG screenshot of the current page."""
        if not self.page:
            return b""
        return await self.page.screenshot(type="png")

    async def execute_action(self, action: dict):
        """Execute a single browser action from Gemini's response."""
        act_type = action.get("type", action.get("action", ""))

        if act_type == "click":
            x = int(action.get("x", 0) * VIEWPORT_W / GRID_SIZE)
            y = int(action.get("y", 0) * VIEWPORT_H / GRID_SIZE)
            await self.page.mouse.click(x, y)
            await self.page.wait_for_timeout(500)

        elif act_type == "type":
            text = action.get("text", "")
            await self.page.keyboard.type(text, delay=50)
            await self.page.wait_for_timeout(300)

        elif act_type == "key" or act_type == "keypress":
            key = action.get("key", "")
            await self.page.keyboard.press(key)
            await self.page.wait_for_timeout(300)

        elif act_type == "scroll":
            x = int(action.get("x", 500) * VIEWPORT_W / GRID_SIZE)
            y = int(action.get("y", 500) * VIEWPORT_H / GRID_SIZE)
            direction = action.get("direction", "down")
            amount = int(action.get("amount", 3)) * 100
            delta = amount if direction == "down" else -amount
            await self.page.mouse.wheel(0, delta)
            await self.page.wait_for_timeout(500)

        elif act_type == "navigate":
            url = action.get("url", "")
            if url:
                await self.page.goto(url)
                await self.page.wait_for_timeout(1000)

        elif act_type == "wait":
            ms = int(action.get("ms", 1000))
            await self.page.wait_for_timeout(min(ms, 5000))

    async def step(self, goal: str) -> dict:
        """Run one agent loop iteration."""
        self.step_count += 1
        self._status["step"] = self.step_count

        # Take screenshot
        img_bytes = await self.screenshot()
        img_b64 = base64.b64encode(img_bytes).decode()

        # Upload screenshot to cloud for remote viewing
        self._upload_screenshot(img_bytes)

        # Check page text for CAPTCHA before even calling the API
        try:
            page_text = await self.page.text_content("body") or ""
            if any(kw in page_text.lower() for kw in CAPTCHA_KEYWORDS):
                return {"thinking": "CAPTCHA detected", "actions": [], "done": False, "captcha": True}
        except Exception:
            pass

        # Build prompt
        if self.step_count == 1:
            prompt = f"Goal: {goal}\n\nThis is a screenshot of the browser. Tell me what to click/type to accomplish the goal."
        else:
            prev_actions = json.dumps(self._status.get("actions", []))
            prompt = f"Goal: {goal}\n\nPrevious actions taken: {prev_actions}\n\nThis is the updated screenshot. Continue toward the goal, or set done=true if accomplished."

        # Single-turn API call (most reliable)
        payload = json.dumps({
            "contents": [{"parts": [
                {"inlineData": {"mimeType": "image/png", "data": img_b64}},
                {"text": f"""{prompt}

Respond with ONLY a JSON object:
{{"thinking": "what you see and your plan", "actions": [{{"type": "click", "x": 500, "y": 300}}, {{"type": "type", "text": "query"}}, {{"type": "key", "key": "Enter"}}, {{"type": "scroll", "direction": "down", "amount": 3}}], "done": false, "captcha": false, "summary": "only when done=true"}}

If you see a CAPTCHA, security check, or "verify you're human" challenge, set "captcha": true and empty actions. The user will solve it manually.

Coordinates: 0-{GRID_SIZE} scale for {VIEWPORT_W}x{VIEWPORT_H} viewport."""}
            ]}],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 1024,
            }
        }).encode()

        url = f"{GEMINI_API_URL}/models/{self.model}:generateContent?key={self.api_key}"
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            return {"thinking": f"API error: {e}", "actions": [], "done": True, "summary": "Failed due to API error"}

        # Parse response
        reply_text = ""
        for candidate in data.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                if "text" in part:
                    reply_text += part["text"]

        # Parse JSON — strip markdown fences if present
        try:
            clean = reply_text.strip()
            if clean.startswith("```"):
                clean = clean.split("\n", 1)[1] if "\n" in clean else clean[3:]
                if clean.endswith("```"):
                    clean = clean[:-3]
                clean = clean.strip()
            result = json.loads(clean)
        except json.JSONDecodeError:
            result = {"thinking": reply_text[:200], "actions": [], "done": True, "summary": "Could not parse response"}

        # Execute actions
        actions_taken = []
        for action in result.get("actions", []):
            try:
                await self.execute_action(action)
                actions_taken.append(action)
            except Exception as e:
                actions_taken.append({"type": "error", "message": str(e)})

        # Update status
        self._status.update({
            "thinking": result.get("thinking", ""),
            "actions": actions_taken,
            "done": result.get("done", False),
        })
        self._upload_status()

        return result

    async def run(self, goal: str) -> str:
        """Run the full agent loop until done or max steps."""
        self._status = {"active": True, "goal": goal, "step": 0, "thinking": "Launching browser...", "actions": [], "done": False}
        self._upload_status()

        # Extract URL from goal for instant navigation
        start_url = _extract_start_url(goal)
        await self.start_browser(start_url=start_url)

        # Upload initial screenshot immediately
        img_bytes = await self.screenshot()
        self._upload_screenshot(img_bytes)

        summary = ""
        for _ in range(MAX_STEPS):
            result = await self.step(goal)

            # CAPTCHA detected — pause for user to solve
            if result.get("captcha"):
                self._status.update({
                    "thinking": "CAPTCHA detected — please solve it in the browser window, then I'll continue.",
                    "actions": [{"type": "waiting_for_captcha"}],
                })
                self._upload_status()
                await self._wait_for_captcha_solved()
                continue  # Re-take screenshot and continue

            if result.get("done"):
                summary = result.get("summary", "Task completed.")
                break
        else:
            summary = f"Reached maximum {MAX_STEPS} steps without completing the goal."

        # Final screenshot
        img_bytes = await self.screenshot()
        self._upload_screenshot(img_bytes)

        self._status.update({"active": False, "done": True, "thinking": summary})
        self._upload_status()

        await self.stop()
        return summary

    async def _wait_for_captcha_solved(self):
        """Wait for the user to solve a CAPTCHA in the visible browser window.
        Polls the page every 2 seconds — when the URL or content changes, resume."""
        if not self.page:
            return
        initial_url = self.page.url
        print("  [Agent] Waiting for you to solve the CAPTCHA...")
        for _ in range(90):  # Max 3 minutes
            await self.page.wait_for_timeout(2000)
            # Upload current screenshot so remote viewers can see progress
            try:
                img = await self.screenshot()
                self._upload_screenshot(img)
            except Exception:
                pass
            # Check if page changed (CAPTCHA solved)
            current_url = self.page.url
            if current_url != initial_url:
                print("  [Agent] CAPTCHA solved — continuing.")
                await self.page.wait_for_timeout(1000)
                return
            # Also check if the CAPTCHA element is gone
            try:
                content = await self.page.text_content("body") or ""
                has_captcha = any(kw in content.lower() for kw in CAPTCHA_KEYWORDS)
                if not has_captcha:
                    print("  [Agent] CAPTCHA appears solved — continuing.")
                    await self.page.wait_for_timeout(1000)
                    return
            except Exception:
                pass
        print("  [Agent] CAPTCHA timeout — continuing anyway.")

    async def stop(self):
        """Close the browser."""
        if self.page:
            await self.page.close()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        self.page = None
        self.browser = None
        self.playwright = None

    def _upload_screenshot(self, png_bytes: bytes):
        """Upload screenshot to Netlify Blobs for remote viewing."""
        try:
            b64 = base64.b64encode(png_bytes).decode()
            payload = json.dumps({"screenshot": b64}).encode()
            req = urllib.request.Request(
                f"{CLOUD_URL}/api/agent/screenshot",
                data=payload, method="POST",
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass  # Non-critical — local viewing still works

    def _upload_status(self):
        """Upload agent status to Netlify Blobs."""
        try:
            payload = json.dumps(self._status).encode()
            req = urllib.request.Request(
                f"{CLOUD_URL}/api/agent/status",
                data=payload, method="POST",
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass

    @property
    def status(self):
        return self._status


def run_agent(api_key: str, goal: str, on_step=None) -> str:
    """Run the computer use agent synchronously. Returns summary."""
    async def _run():
        agent = ComputerUseAgent(api_key)
        return await agent.run(goal)

    return asyncio.run(_run())
