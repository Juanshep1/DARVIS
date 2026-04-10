"""
S.P.E.C.T.R.A. Proactive Alerts — background monitors that trigger notifications.
Supports: weather_change, price_threshold, news_keyword, url_change.
"""

import json
import hashlib
import datetime
import urllib.request
import urllib.error
import threading
import uuid
import re
from pathlib import Path

CLOUD_URL = "https://darvis1.netlify.app/api/alerts"
LOCAL_PATH = Path(__file__).parent / "alerts.json"
TIMEOUT = 8


class Alert:
    def __init__(self, alert_type, config, alert_id=None, last_checked=None, last_value=None, active=True):
        self.id = alert_id or str(uuid.uuid4())[:8]
        self.type = alert_type
        self.config = config  # e.g. {"keyword": "SpaceX"} or {"symbol": "AAPL", "threshold": 200, "direction": "above"}
        self.last_checked = last_checked
        self.last_value = last_value
        self.active = active

    def to_dict(self):
        return {
            "id": self.id, "type": self.type, "config": self.config,
            "last_checked": self.last_checked, "last_value": self.last_value, "active": self.active,
        }

    @classmethod
    def from_dict(cls, d):
        return cls(d["type"], d["config"], d.get("id"), d.get("last_checked"), d.get("last_value"), d.get("active", True))


class AlertMonitor:
    def __init__(self):
        self._lock = threading.Lock()
        self.alerts: list[Alert] = []
        self._load_local()

    def _load_local(self):
        if LOCAL_PATH.exists():
            try:
                data = json.loads(LOCAL_PATH.read_text())
                self.alerts = [Alert.from_dict(d) for d in data]
            except Exception:
                self.alerts = []

    def _save_local(self):
        LOCAL_PATH.write_text(json.dumps([a.to_dict() for a in self.alerts], indent=2))

    def sync_from_cloud(self):
        try:
            req = urllib.request.Request(CLOUD_URL, method="GET")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read().decode())
                cloud = data.get("alerts", [])
                if cloud:
                    with self._lock:
                        # Merge cloud alerts (cloud wins)
                        cloud_ids = {a["id"] for a in cloud}
                        self.alerts = [Alert.from_dict(d) for d in cloud]
                        self._save_local()
        except Exception:
            pass

    def _sync_to_cloud(self):
        try:
            payload = json.dumps({"replace": True, "alerts": [a.to_dict() for a in self.alerts]}).encode()
            req = urllib.request.Request(
                CLOUD_URL, data=payload, method="POST",
                headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=TIMEOUT)
        except Exception:
            pass

    def add(self, alert_type: str, config: dict) -> str:
        alert = Alert(alert_type, config)
        with self._lock:
            self.alerts.append(alert)
            self._save_local()
        threading.Thread(target=self._sync_to_cloud, daemon=True).start()
        return f"Alert [{alert.id}] added: {alert_type} — {json.dumps(config)}"

    def remove(self, alert_id: str) -> str:
        with self._lock:
            before = len(self.alerts)
            self.alerts = [a for a in self.alerts if a.id != alert_id]
            if len(self.alerts) < before:
                self._save_local()
                threading.Thread(target=self._sync_to_cloud, daemon=True).start()
                return f"Alert [{alert_id}] removed"
            return f"Alert [{alert_id}] not found"

    def list_all(self) -> list[dict]:
        with self._lock:
            return [a.to_dict() for a in self.alerts if a.active]

    def check_all(self) -> list[dict]:
        """Check all alerts, return list of triggered ones with messages."""
        triggered = []
        with self._lock:
            alerts_copy = list(self.alerts)

        for alert in alerts_copy:
            if not alert.active:
                continue
            try:
                msg = None
                if alert.type == "weather_change":
                    msg = self._check_weather(alert)
                elif alert.type == "price_threshold":
                    msg = self._check_price(alert)
                elif alert.type == "news_keyword":
                    msg = self._check_news(alert)
                elif alert.type == "url_change":
                    msg = self._check_url(alert)

                alert.last_checked = datetime.datetime.now().isoformat()
                if msg:
                    triggered.append({"id": alert.id, "type": alert.type, "message": msg})
            except Exception:
                pass

        if triggered:
            with self._lock:
                self._save_local()
            # Store triggered alerts for browser/iOS polling
            self._push_triggered(triggered)

        return triggered

    def _check_weather(self, alert):
        url = "https://wttr.in/?format=%C+%t"
        req = urllib.request.Request(url, headers={"User-Agent": "spectra"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            weather = resp.read().decode().strip()
        if alert.last_value and weather != alert.last_value:
            msg = f"Weather changed: {alert.last_value} → {weather}"
            alert.last_value = weather
            return msg
        alert.last_value = weather
        return None

    def _check_price(self, alert):
        symbol = alert.config.get("symbol", "")
        threshold = float(alert.config.get("threshold", 0))
        direction = alert.config.get("direction", "above")
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d"
        req = urllib.request.Request(url, headers={"User-Agent": "spectra"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
        price = data["chart"]["result"][0]["meta"]["regularMarketPrice"]
        alert.last_value = str(price)
        if direction == "above" and price >= threshold:
            return f"{symbol} is at ${price:.2f} (crossed above ${threshold})"
        elif direction == "below" and price <= threshold:
            return f"{symbol} is at ${price:.2f} (dropped below ${threshold})"
        return None

    def _check_news(self, alert):
        keyword = alert.config.get("keyword", "")
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(keyword)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            html = resp.read().decode(errors="replace")
        content_hash = hashlib.md5(html[:2000].encode()).hexdigest()
        if alert.last_value and content_hash != alert.last_value:
            # Extract a headline
            match = re.search(r'class="result__title"[^>]*>.*?<a[^>]*>(.*?)</a>', html, re.DOTALL)
            headline = re.sub(r'<[^>]+>', '', match.group(1)).strip() if match else "new results"
            alert.last_value = content_hash
            return f"New results for '{keyword}': {headline}"
        alert.last_value = content_hash
        return None

    def _check_url(self, alert):
        url = alert.config.get("url", "")
        req = urllib.request.Request(url, headers={"User-Agent": "spectra"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            content = resp.read().decode(errors="replace")
        content_hash = hashlib.md5(content[:5000].encode()).hexdigest()
        if alert.last_value and content_hash != alert.last_value:
            alert.last_value = content_hash
            return f"Content changed at {url}"
        alert.last_value = content_hash
        return None

    def _push_triggered(self, triggered):
        """Push triggered alerts to cloud for browser/iOS polling."""
        try:
            payload = json.dumps({"triggered": triggered}).encode()
            req = urllib.request.Request(
                CLOUD_URL + "/triggered", data=payload, method="POST",
                headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=TIMEOUT)
        except Exception:
            pass
