"""
The two AI roles, kept deliberately separate.

  emulator      writes scenarios  (what happens to the city)
  orchestrator  sets signal policy (how the city responds)

Both are inert without their key, and the simulation runs its validated
rules-based policy in that state — so the demo never depends on a network call
succeeding.
"""

from .config import emulator_config, orchestrator_config, summary
from .emulator import Emulator, Scenario
from .orchestrator import DEFAULT_POLICY, POLICY_BOUNDS, Orchestrator, PolicyDecision

__all__ = [
    "Emulator",
    "Scenario",
    "Orchestrator",
    "PolicyDecision",
    "DEFAULT_POLICY",
    "POLICY_BOUNDS",
    "emulator_config",
    "orchestrator_config",
    "summary",
]
