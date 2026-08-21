"""
FastAPI server: runs the twin simulation and streams it to the browser.

Wire format on /ws is one binary frame per tick:

    uint32  headerLen           (little-endian, header is padded to 4 bytes)
    bytes   headerLen           UTF-8 JSON: metrics for BOTH twins, clock, events
    float32 n_veh * 5           lon, lat, angle, kind, speed   (focused twin only)
    uint8   n_sig               0=red 1=yellow 2=green, in signals.geojson order
    uint8   n_edge              speed/limit ratio * 255, in roads.geojson order

JSON-per-tick would be roughly 8x larger for the vehicle array and would stall
the main thread on parse; a Float32Array can go straight into a deck.gl binary
attribute with no per-object allocation.
"""

from __future__ import annotations

import asyncio
import json
import multiprocessing as mp
import queue
import struct
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from sim_worker import run_worker

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "web" / "public" / "data"
WEB_DIST = HERE.parent / "web" / "dist"

MODES = ("baseline", "ai")


class Engine:
    """Owns the two worker processes and the latest snapshot from each."""

    def __init__(self) -> None:
        self.cmd_q: dict[str, mp.Queue] = {}
        self.out_q: dict[str, mp.Queue] = {}
        self.procs: dict[str, mp.Process] = {}
        self.latest: dict[str, tuple] = {}
        self.errors: list[dict] = []
        self.focus = "ai"
        self.paused = False
        self.speed = 5.0
        self._threads: list[threading.Thread] = []
        self._stop = threading.Event()
        self.started_at = time.time()

    # -----------------------------------------------------------------
    def start(self, cfg: dict) -> None:
        ctx = mp.get_context("spawn")
        for mode in MODES:
            self.cmd_q[mode] = ctx.Queue()
            self.out_q[mode] = ctx.Queue(maxsize=8)
            p = ctx.Process(
                target=run_worker,
                args=(mode, self.cmd_q[mode], self.out_q[mode], {**cfg, "focus": self.focus}),
                daemon=True,
                name=f"sumo-{mode}",
            )
            p.start()
            self.procs[mode] = p

            t = threading.Thread(target=self._drain, args=(mode,), daemon=True)
            t.start()
            self._threads.append(t)

    def _drain(self, mode: str) -> None:
        """mp.Queue.get blocks, so each worker gets a reader thread."""
        q = self.out_q[mode]
        while not self._stop.is_set():
            try:
                item = q.get(timeout=0.5)
            except queue.Empty:
                continue
            except (EOFError, OSError):
                break
            if isinstance(item, dict):
                if item.get("type") == "error":
                    self.errors.append(item)
                    print(f"[{mode}] WORKER ERROR\n{item.get('traceback')}")
                continue
            self.latest[mode] = item

    # -----------------------------------------------------------------
    def send(self, cmd: dict, mode: str | None = None) -> None:
        targets = [mode] if mode else list(MODES)
        for m in targets:
            q = self.cmd_q.get(m)
            if q is not None:
                q.put(cmd)

    def set_focus(self, mode: str) -> None:
        if mode in MODES:
            self.focus = mode
            self.send({"type": "focus", "value": mode})

    def stop(self) -> None:
        self._stop.set()
        self.send({"type": "stop"})
        for p in self.procs.values():
            p.join(timeout=3)
            if p.is_alive():
                p.terminate()

    # -----------------------------------------------------------------
    def frame(self) -> bytes | None:
        """Combine the latest snapshot from each twin into one wire frame."""
        foc = self.latest.get(self.focus)
        if foc is None:
            return None
        fsnap, veh, sig, cong = foc

        header = {
            "clock": fsnap["clock"],
            "sim_time": fsnap["metrics"]["sim_time"],
            "demand_factor": fsnap["demand_factor"],
            "focus": self.focus,
            "paused": self.paused,
            "speed": self.speed,
            "n_veh": fsnap["n_veh"],
            "n_sig": fsnap["n_sig"],
            "n_edge": fsnap["n_edge"],
            "twins": {},
            "events": fsnap.get("events", []),
            "errors": self.errors[-3:],
        }
        for m in MODES:
            item = self.latest.get(m)
            if item is None:
                continue
            snap = item[0]
            header["twins"][m] = {
                "label": snap["controller"]["label"],
                "metrics": snap["metrics"],
                "stats": snap["controller"]["stats"],
                "step_ms": snap["step_ms"],
                # Junction detail from BOTH twins, so a clicked intersection can
                # be compared side by side rather than just inspected.
                "watch": snap.get("watch"),
                "corridors": snap.get("corridors", {}),
            }

        hb = json.dumps(header, separators=(",", ":")).encode("utf-8")
        pad = (-len(hb)) % 4          # keep the float32 block 4-byte aligned
        hb = hb + b" " * pad
        return struct.pack("<I", len(hb)) + hb + veh + sig + cong


engine = Engine()


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine.start({"seed": 42, "start_hour": 7.0, "end": 3600, "speed": engine.speed})
    print("[engine] two SUMO processes starting (baseline + ai) ...")
    yield
    engine.stop()


app = FastAPI(title="Barcelona AI Traffic Orchestration", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# ---------------------------------------------------------------- REST
@app.get("/api/meta")
async def meta():
    return JSONResponse(json.loads((DATA / "meta.json").read_text(encoding="utf-8")))


@app.get("/api/health")
async def health():
    return {
        "workers": {m: (p.is_alive() if (p := engine.procs.get(m)) else False) for m in MODES},
        "have_snapshot": {m: m in engine.latest for m in MODES},
        "errors": engine.errors[-3:],
        "uptime_s": round(time.time() - engine.started_at, 1),
    }


@app.post("/api/control")
async def control(payload: dict):
    action = payload.get("action")
    if action == "pause":
        engine.paused = bool(payload.get("value", True))
        engine.send({"type": "pause", "value": engine.paused})
    elif action == "speed":
        engine.speed = float(payload.get("value", 5.0))
        engine.send({"type": "speed", "value": engine.speed})
    elif action == "focus":
        engine.set_focus(payload.get("value", "ai"))
    elif action == "watch":
        # Sent to both twins so the inspector can show fixed vs AI together.
        engine.send({"type": "watch", "value": payload.get("value")})
    else:
        return JSONResponse({"error": f"unknown action {action}"}, status_code=400)
    return {"ok": True, "paused": engine.paused, "speed": engine.speed, "focus": engine.focus}


@app.post("/api/event")
async def event(payload: dict):
    kind = payload.get("kind")
    allowed = {"concert", "metro_disruption", "rain", "clear_weather", "clear_events"}
    if kind not in allowed:
        return JSONResponse({"error": f"unknown event {kind}"}, status_code=400)
    # Applied to BOTH twins so the comparison stays fair.
    engine.send({"type": "event", "kind": kind})
    return {"ok": True, "kind": kind}


# ---------------------------------------------------------------- WS
@app.websocket("/ws")
async def ws(sock: WebSocket):
    await sock.accept()
    try:
        while True:
            f = engine.frame()
            if f is not None:
                await sock.send_bytes(f)
            await asyncio.sleep(0.1)      # 10 Hz to the browser
    except (WebSocketDisconnect, RuntimeError):
        pass


# ---------------------------------------------------------------- static
if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIST), html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
