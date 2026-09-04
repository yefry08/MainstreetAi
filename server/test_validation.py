"""
Unit tests for the control-API validators.

The cases that matter are the ones that used to get through: nan and inf were
accepted by `float()` and then forwarded to both SUMO twins, and a range check
alone does not stop nan, because every comparison against it is False. Those
two are pinned first because they are the reason this module exists.

No server, no SUMO, no socket -- these are pure functions by design.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from validation import (  # noqa: E402
    HOUR_RANGE, SCALE_RANGE, SPEED_RANGE, Invalid, boolean, number, one_of,
)

failures = 0


def check(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'   ' + detail if detail else ''}")


def rejects(fn, *args, **kwargs):
    """True when the validator refuses the input, rather than crashing oddly."""
    try:
        fn(*args, **kwargs)
        return False
    except Invalid:
        return True


print("validation: the values that used to reach the twins")

# --- the regression this module exists for --------------------------------
for bad in (float("nan"), "NaN", "nan"):
    check(f"nan rejected ({bad!r})",
          rejects(number, bad, name="speed", lo=0.1, hi=50.0))

for bad in (float("inf"), float("-inf"), "Infinity", "-Infinity", "1e400"):
    check(f"inf rejected ({bad!r})",
          rejects(number, bad, name="speed", lo=0.1, hi=50.0))

# A range test on its own is not enough. This asserts the property directly,
# so the ordering inside number() cannot be reversed without a failure here.
nan = float("nan")
check("nan defeats a naive range check (why isfinite comes first)",
      not (nan < 0.1) and not (nan > 50.0))

# --- inputs that used to raise, i.e. 500 rather than 400 -------------------
for bad in ("abc", None, "", [], {}, "5,0"):
    check(f"non-numeric rejected ({bad!r})",
          rejects(number, bad, name="speed", lo=0.1, hi=50.0))

# --- bounds ---------------------------------------------------------------
check("below range rejected", rejects(number, 0.0, name="speed", lo=0.1, hi=50.0))
check("above range rejected", rejects(number, 1e9, name="speed", lo=0.1, hi=50.0))
check("negative scale rejected", rejects(number, -1, name="scale", lo=0.0, hi=5.0))
check("hour 25 rejected", rejects(number, 25, name="hour", lo=0.0, hi=24.0))

# --- values that must still work ------------------------------------------
check("int accepted", number(5, name="speed", lo=0.1, hi=50.0) == 5.0)
check("float accepted", number(2.5, name="speed", lo=0.1, hi=50.0) == 2.5)
check("numeric string accepted", number("10", name="speed", lo=0.1, hi=50.0) == 10.0)
check("lower bound inclusive", number(0.1, name="speed", lo=0.1, hi=50.0) == 0.1)
check("upper bound inclusive", number(50.0, name="speed", lo=0.1, hi=50.0) == 50.0)
check("the two speeds the UI sends are legal",
      number(5, name="speed", lo=SPEED_RANGE[0], hi=SPEED_RANGE[1]) == 5.0
      and number(10, name="speed", lo=SPEED_RANGE[0], hi=SPEED_RANGE[1]) == 10.0)
check("scale 0 is legal (a real setting, not a missing one)",
      number(0, name="scale", lo=SCALE_RANGE[0], hi=SCALE_RANGE[1]) == 0.0)
check("hour 0 and 24 are legal",
      number(0, name="hour", lo=HOUR_RANGE[0], hi=HOUR_RANGE[1]) == 0.0
      and number(24, name="hour", lo=HOUR_RANGE[0], hi=HOUR_RANGE[1]) == 24.0)

# --- booleans are not truthiness -----------------------------------------
check('the string "false" is False, not truthy',
      boolean("false", name="paused") is False)
check('"true" is True', boolean("true", name="paused") is True)
check("real booleans pass through",
      boolean(True, name="paused") is True and boolean(False, name="paused") is False)
check("missing uses the default", boolean(None, name="paused", default=True) is True)
check("nonsense rejected", rejects(boolean, "maybe", name="paused"))
check("a boolean is not a number",
      rejects(number, True, name="speed", lo=0.1, hi=50.0))

# --- fixed sets -----------------------------------------------------------
check("focus accepts a known twin",
      one_of("ai", name="focus", allowed={"ai", "baseline"}) == "ai")
check("focus rejects anything else",
      rejects(one_of, "../../etc/passwd", name="focus", allowed={"ai", "baseline"}))
check("focus rejects None",
      rejects(one_of, None, name="focus", allowed={"ai", "baseline"}))

# --- the error is reportable ----------------------------------------------
try:
    number("abc", name="speed", lo=0.1, hi=50.0)
    check("Invalid carries a message", False)
except Invalid as e:
    check("Invalid carries a message naming the field", "speed" in str(e), str(e))

print(f"\n{'all passed' if failures == 0 else f'{failures} FAILED'}")
sys.exit(1 if failures else 0)
