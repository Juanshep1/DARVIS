"""
D.A.R.V.I.S. Task Scheduler — cron-like background task execution.
Runs tasks at scheduled times without user approval.
Syncs across devices via Netlify Blobs.
"""

import json
import datetime
import threading
import urllib.request
import urllib.error
import re
import uuid
from pathlib import Path

CLOUD_URL = "https://darvis1.netlify.app/api/scheduler"
LOCAL_PATH = Path(__file__).parent / "scheduled_tasks.json"
TIMEOUT = 5

# Global reference set by darvis.py main()
_global_scheduler: "DARVISScheduler | None" = None


class ScheduledTask:
    def __init__(self, task_id=None, task="", execute_at=None, recurring=None, created=None):
        self.id = task_id or str(uuid.uuid4())[:8]
        self.task = task
        self.execute_at = execute_at or datetime.datetime.now()
        self.recurring = recurring  # None for one-shot, or minutes interval
        self.created = created or datetime.datetime.now().isoformat()

    def is_due(self) -> bool:
        return datetime.datetime.now() >= self.execute_at

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "task": self.task,
            "execute_at": self.execute_at.isoformat(),
            "recurring": self.recurring,
            "created": self.created,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ScheduledTask":
        return cls(
            task_id=d.get("id"),
            task=d.get("task", ""),
            execute_at=datetime.datetime.fromisoformat(d["execute_at"]) if d.get("execute_at") else None,
            recurring=d.get("recurring"),
            created=d.get("created"),
        )


class DARVISScheduler:
    def __init__(self):
        self.tasks: list[ScheduledTask] = []
        self._lock = threading.Lock()
        self._load_local()

    # ── Add tasks ──

    def add_task(self, task_desc: str, delay_minutes: float = None,
                 at_time: str = None, recurring_minutes: float = None) -> ScheduledTask:
        """Schedule a new task."""
        now = datetime.datetime.now()

        if delay_minutes is not None:
            execute_at = now + datetime.timedelta(minutes=delay_minutes)
        elif at_time:
            try:
                execute_at = datetime.datetime.fromisoformat(at_time)
                if execute_at < now:
                    execute_at += datetime.timedelta(days=1)  # Next occurrence
            except ValueError:
                execute_at = now + datetime.timedelta(minutes=1)
        else:
            execute_at = now + datetime.timedelta(minutes=1)

        task = ScheduledTask(
            task=task_desc,
            execute_at=execute_at,
            recurring=recurring_minutes,
        )

        with self._lock:
            self.tasks.append(task)
        self._save_local()
        self._sync_to_cloud(task)
        return task

    # ── Check and execute ──

    def check_and_run(self, brain, extract_fn, console, tts):
        """Check for due tasks and execute them. Called from background thread."""
        due_tasks = []
        with self._lock:
            for t in self.tasks:
                if t.is_due():
                    due_tasks.append(t)

        for task in due_tasks:
            try:
                console.print(f"\n  [bright_blue]⏰ Scheduled task:[/bright_blue] {task.task}")

                # Use Brain to think about the task
                response = brain.think(task.task)

                # Execute any commands in the response
                cmd_results = extract_fn(response)
                if cmd_results:
                    context = "\n".join(cmd_results)
                    response = brain.think(
                        "(Report the results of the command you just ran naturally. Be concise.)",
                        context=context,
                    )

                # Display and speak result
                display = re.sub(r'```command\s*\n.*?\n```', '', response, flags=re.DOTALL).strip()
                if display:
                    from rich.panel import Panel
                    from rich.markdown import Markdown
                    console.print(
                        Panel(Markdown(display), title="[bold bright_cyan]Scheduled Task Complete[/bold bright_cyan]",
                              border_style="bright_blue", padding=(1, 2))
                    )
                    tts.speak(display)
                    tts.wait_for_speech()

            except Exception as e:
                console.print(f"  [red]Scheduled task error: {e}[/red]")

            # Remove or reschedule
            with self._lock:
                if task.recurring:
                    task.execute_at = datetime.datetime.now() + datetime.timedelta(minutes=task.recurring)
                else:
                    self.tasks = [t for t in self.tasks if t.id != task.id]

        if due_tasks:
            self._save_local()

    # ── List/cancel ──

    def list_tasks(self) -> list[dict]:
        with self._lock:
            return [t.to_dict() for t in self.tasks]

    def cancel_task(self, task_id: str) -> bool:
        with self._lock:
            before = len(self.tasks)
            self.tasks = [t for t in self.tasks if t.id != task_id]
            removed = len(self.tasks) < before
        if removed:
            self._save_local()
        return removed

    # ── Persistence ──

    def _save_local(self):
        try:
            data = [t.to_dict() for t in self.tasks]
            LOCAL_PATH.write_text(json.dumps(data, indent=2))
        except Exception:
            pass

    def _load_local(self):
        if LOCAL_PATH.exists():
            try:
                data = json.loads(LOCAL_PATH.read_text())
                self.tasks = [ScheduledTask.from_dict(d) for d in data]
            except Exception:
                pass

    def _sync_to_cloud(self, task: ScheduledTask):
        """Push a task to the cloud for cross-device sync."""
        try:
            payload = json.dumps(task.to_dict()).encode()
            req = urllib.request.Request(
                CLOUD_URL, data=payload, method="POST",
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=TIMEOUT)
        except Exception:
            pass

    def sync_from_cloud(self):
        """Pull tasks from cloud (for cross-device scheduling)."""
        try:
            req = urllib.request.Request(CLOUD_URL, method="GET")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read().decode())
                cloud_tasks = data.get("tasks", [])
                with self._lock:
                    existing_ids = {t.id for t in self.tasks}
                    for ct in cloud_tasks:
                        if ct.get("id") not in existing_ids:
                            self.tasks.append(ScheduledTask.from_dict(ct))
            self._save_local()
        except Exception:
            pass
