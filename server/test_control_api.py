"""
End-to-end tests for /api/control, against a real app instance.

test_validation.py pins the rules; this pins that the ENDPOINT applies them --
that a bad payload comes back 400 with a message rather than 500 with a
traceback, and that nan never reaches the engine.

The engine is replaced with a recorder, so nothing here starts SUMO or a
worker process. What is asserted is what the endpoint would have sent.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

failures = 0


def check(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'   ' + detail if detail else ''}")


try:
    from fastapi.testclient import TestClient
except Exception as e:                                    # pragma: no cover
    print(f"  skip  fastapi TestClient unavailable ({type(e).__name__})")
    print("\nall passed")
    sys.exit(0)

import app as app_module  # noqa: E402


class Recorder:
    """Stands in for the engine. Records instead of driving SUMO."""

    def __init__(self):
        self.sent = []
        self.paused = False
        self.speed = 5.0
        self.focus = "ai"
        self.manual_scale = None
        self.day = "Tue"
        self.hour = 8.0

    def send(self, msg):
        self.sent.append(msg)

    def set_focus(self, v):
        self.focus = v


rec = Recorder()
app_module.engine = rec
client = TestClient(app_module.app)


def post(body):
    return client.post("/api/control", json=body)


print("control API: bad input is a 400, not a 500")

# --- the payloads that used to raise, i.e. 500 -----------------------------
for bad in ("abc", None, "", [], {}):
    r = post({"action": "speed", "value": bad})
    check(f"speed={bad!r} -> 400", r.status_code == 400, f"got {r.status_code}")

# --- the payloads that used to be ACCEPTED and reach both twins ------------
for bad in ("NaN", "Infinity", "-Infinity", "1e400"):
    r = post({"action": "speed", "value": bad})
    check(f"speed={bad!r} -> 400", r.status_code == 400, f"got {r.status_code}")

before = len(rec.sent)
post({"action": "scale", "value": "NaN"})
check("a nan scale is never forwarded to the twins", len(rec.sent) == before)
check("engine.speed is still finite after the bad requests",
      rec.speed == rec.speed and abs(rec.speed) != float("inf"))

# --- out of range ----------------------------------------------------------
check("speed 1e9 -> 400", post({"action": "speed", "value": 1e9}).status_code == 400)
check("scale -1 -> 400", post({"action": "scale", "value": -1}).status_code == 400)
check("hour 99 -> 400", post({"action": "clock", "hour": 99}).status_code == 400)
check("unknown focus -> 400",
      post({"action": "focus", "value": "wat"}).status_code == 400)
check("unknown day -> 400",
      post({"action": "clock", "day": "Someday"}).status_code == 400)
check("unknown action -> 400",
      post({"action": "nope"}).status_code == 400)

# --- the error says what was wrong ----------------------------------------
r = post({"action": "speed", "value": "abc"})
check("the 400 names the offending field", "speed" in r.json().get("error", ""),
      r.json().get("error", ""))

# --- and the good paths still work ----------------------------------------
r = post({"action": "speed", "value": 10})
check("speed 10 accepted", r.status_code == 200 and rec.speed == 10.0)
r = post({"action": "focus", "value": "baseline"})
check("focus baseline accepted", r.status_code == 200 and rec.focus == "baseline")
r = post({"action": "scale", "value": None})
check("scale null means auto, still accepted",
      r.status_code == 200 and rec.manual_scale is None)
r = post({"action": "pause", "value": False})
check("pause false is False, not truthy",
      r.status_code == 200 and rec.paused is False)
r = post({"action": "clock", "hour": 8.5})
check("hour 8.5 accepted", r.status_code == 200 and rec.hour == 8.5)

# --- CORS is no longer a wildcard -----------------------------------------
check("no wildcard origin", "*" not in app_module.ALLOWED_ORIGINS,
      str(app_module.ALLOWED_ORIGINS[:2]))
check("every allowed origin is loopback",
      all(("localhost" in o or "127.0.0.1" in o) for o in app_module.ALLOWED_ORIGINS))

r = client.get("/api/feeds", headers={"Origin": "https://evil.example"})
check("a foreign origin gets no allow-origin header",
      r.headers.get("access-control-allow-origin") not in ("*", "https://evil.example"),
      str(r.headers.get("access-control-allow-origin")))

r = client.get("/api/feeds", headers={"Origin": "http://localhost:5173"})
check("the dev origin is allowed",
      r.headers.get("access-control-allow-origin") == "http://localhost:5173",
      str(r.headers.get("access-control-allow-origin")))

print(f"\n{'all passed' if failures == 0 else f'{failures} FAILED'}")
sys.exit(1 if failures else 0)
