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

# The two AI roles. Both are inert without their key, and the simulation runs
# its validated rules-based policy in that state, so importing this can never
# break a run.
from ai import Emulator, Orchestrator
from ai import summary as ai_summary

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

        # Strategic layer. Runs on its own thread so a slow API call can never
        # stall the simulation — the tactical controller keeps executing the
        # previous policy while a decision is in flight.
        self.orchestrator = Orchestrator()
        self.emulator = Emulator()
        self._ai_thread: threading.Thread | None = None

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

        if self.orchestrator.available:
            self._ai_thread = threading.Thread(target=self._orchestrate, daemon=True)
            self._ai_thread.start()
            print(f"[ai] orchestrator active ({self.orchestrator.cfg.model}), "
                  f"deciding every {self.orchestrator.interval_s:.0f} simulated seconds")
        else:
            print("[ai] no orchestration key — running the rules-based policy")

    def _orchestrate(self) -> None:
        """
        Strategic control loop.

        Deliberately slow. An LLM cannot drive 1,151 junctions at 1 Hz, so it
        sets policy on a long cadence and the deterministic controller executes
        it every second. See ai/orchestrator.py for the full reasoning.
        """
        while not self._stop.is_set():
            time.sleep(2.0)
            item = self.latest.get("ai")
            if item is None:
                continue
            snap = item[0]
            sim_time = snap["metrics"]["sim_time"]
            if not self.orchestrator.due(sim_time):
                continue

            decision = self.orchestrator.decide(sim_time, {
                "clock": snap.get("clock"),
                "metrics": snap.get("metrics", {}),
                "corridors": snap.get("corridors", {}),
                "events": snap.get("events", []),
            })
            # Only the adaptive twin. Sending policy to the baseline would
            # destroy the comparison the whole demo rests on.
            if decision.source == "ai":
                self.send({
                    "type": "policy",
                    "value": decision.policy,
                    "source": decision.source,
                    "rationale": decision.rationale,
                }, mode="ai")
                print(f"[ai] t={sim_time:.0f}s policy updated "
                      f"({decision.latency_ms:.0f} ms): {decision.rationale}")

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
        "ai": ai_summary(),
        "policy": engine.orchestrator.current.to_dict(),
    }


@app.get("/api/ai/policy")
async def ai_policy():
    """Current strategic policy and the last few decisions behind it."""
    return {
        "current": engine.orchestrator.current.to_dict(),
        "history": engine.orchestrator.history[-10:],
        "bounds": {k: list(v) for k, v in
                   __import__("ai").POLICY_BOUNDS.items()},
        "interval_s": engine.orchestrator.interval_s,
        "available": engine.orchestrator.available,
    }


@app.post("/api/ai/scenario")
async def ai_scenario(payload: dict):
    """
    Compose a scenario from a description and stage it.

    The model chooses WHAT happens and where; SUMO decides what the city does
    about it. Set `dry_run` to see the events without injecting them.
    """
    description = (payload.get("description") or "").strip()
    if not description:
        return JSONResponse({"error": "description is required"}, status_code=400)

    item = engine.latest.get(engine.focus) or engine.latest.get("ai")
    state = None
    if item:
        snap = item[0]
        state = {"clock": snap.get("clock"), "metrics": snap.get("metrics", {})}

    scenario = engine.emulator.compose(description, state)
    result = scenario.to_dict()

    if scenario.events and not payload.get("dry_run"):
        # Applied to BOTH twins identically, exactly like the built-in
        # scenarios. Injecting into only one would rig the comparison.
        for ev in scenario.events:
            engine.send({"type": "ai_event", "spec": ev})
        result["staged"] = len(scenario.events)

    return result


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
