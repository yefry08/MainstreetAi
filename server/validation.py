"""
Request-payload validation for the control API.

WHY THIS IS A MODULE AND NOT INLINE CHECKS
Two separate faults were reachable from /api/control, and both came from
trusting `float()` with whatever JSON arrived:

  float("abc")      raises ValueError  -> unhandled 500
  float(None)       raises TypeError   -> unhandled 500
  float("NaN")      returns nan        -> accepted, then forwarded to BOTH
  float("Infinity") returns inf           SUMO twins as a speed or a demand
  float("1e400")    returns inf           scale

The second is the worse one. `nan` is not rejected by any comparison -- every
`x < hi` and `x > lo` test against it is False -- so a naive range check waves
it straight through, and it then poisons whatever it touches: a nan speed
makes the pacing arithmetic nan for the rest of the run, and neither twin
recovers. Nothing crashes, so nothing tells you.

Keeping the rules here rather than in the endpoint means they can be tested
without starting a server, a SUMO process or a socket -- see
test_validation.py, which is where the cases above are pinned.
"""

from __future__ import annotations

import math


class Invalid(ValueError):
    """Bad client input. The endpoint turns this into a 400, never a 500."""


def number(value, *, name: str, lo: float, hi: float) -> float:
    """A finite float within [lo, hi], or Invalid.

    Accepts ints, floats and numeric strings, because JSON clients are not
    consistent about which they send. Rejects bools: `True` is an int in
    Python and would silently become 1.0, which is a value the caller almost
    certainly did not mean to send.
    """
    if isinstance(value, bool):
        raise Invalid(f"{name} must be a number, not a boolean")
    if value is None:
        raise Invalid(f"{name} is required")
    try:
        out = float(value)
    except (TypeError, ValueError):
        raise Invalid(f"{name} must be a number, got {type(value).__name__}")

    # Before the range check, never after: nan compares False against both
    # bounds, so a range test alone lets it through.
    if not math.isfinite(out):
        raise Invalid(f"{name} must be finite, got {out}")
    if out < lo or out > hi:
        raise Invalid(f"{name} must be between {lo} and {hi}, got {out}")
    return out


def one_of(value, *, name: str, allowed) -> str:
    """A value from a fixed set. The set is the whole contract."""
    if value not in allowed:
        raise Invalid(f"{name} must be one of {sorted(allowed)}, got {value!r}")
    return value


def boolean(value, *, name: str, default: bool = True) -> bool:
    """A real boolean.

    `bool(value)` accepts anything, so "false" -- a string every JS client
    sends at some point -- would evaluate true. Strings are matched explicitly
    and anything else is rejected rather than guessed at.
    """
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        low = value.strip().lower()
        if low in ("true", "1", "yes", "on"):
            return True
        if low in ("false", "0", "no", "off"):
            return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value in (0, 1):
            return bool(value)
    raise Invalid(f"{name} must be a boolean, got {value!r}")


# Ranges the engine can actually honour. Speed is a request rather than a
# guarantee -- SUMO already runs below realtime at high density -- but a value
# outside this band is a client bug, not an ambitious request.
SPEED_RANGE = (0.1, 50.0)
SCALE_RANGE = (0.0, 5.0)
HOUR_RANGE = (0.0, 24.0)
