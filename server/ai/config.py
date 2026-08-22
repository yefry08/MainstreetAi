"""
Configuration for the two AI roles.

The project uses SEPARATE keys for the two roles on purpose:

  MAINSTREET_EMULATOR_KEY      generates demand and scenario events
  MAINSTREET_ORCHESTRATOR_KEY  sets signal policy

They are different trust levels. The emulator invents traffic; the orchestrator
influences signal timing. Keeping them on distinct keys means you can rate-limit,
budget, revoke or audit them independently, and a compromised scenario generator
cannot reach the control path. Either falls back to ANTHROPIC_API_KEY so a single
key works for local development.

No key is ever committed. Copy .env.example to .env and fill it in; .env is
gitignored.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent.parent / ".env"

# Claude Opus 5. Chosen for both roles because the orchestrator's job is genuine
# multi-factor reasoning over network state, and the emulator has to produce
# scenarios that stay internally consistent with a real street network.
DEFAULT_MODEL = "claude-opus-5"


def _load_dotenv() -> None:
    """
    Minimal .env reader.

    Deliberately not python-dotenv: this needs to read five keys at startup and
    adding a dependency for that is not worth the install-time friction on a
    machine that already has to build a SUMO network.
    """
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Real environment variables win over the file.
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()


@dataclass(frozen=True)
class RoleConfig:
    """Everything one AI role needs to run, plus whether it can run at all."""

    role: str
    api_key: str | None
    model: str
    enabled: bool

    @property
    def status(self) -> str:
        if not self.api_key:
            return "no key"
        return "ready" if self.enabled else "disabled"


def _role(env_key: str, role: str) -> RoleConfig:
    key = os.environ.get(env_key) or os.environ.get("ANTHROPIC_API_KEY")
    model = os.environ.get(f"{env_key}_MODEL") or DEFAULT_MODEL
    # An explicit opt-out lets you keep keys in .env while running the
    # deterministic baseline, which is what you want for a reproducible A/B.
    disabled = os.environ.get(f"{env_key}_DISABLED", "").lower() in ("1", "true", "yes")
    return RoleConfig(
        role=role,
        api_key=key or None,
        model=model,
        enabled=bool(key) and not disabled,
    )


def emulator_config() -> RoleConfig:
    return _role("MAINSTREET_EMULATOR_KEY", "emulator")


def orchestrator_config() -> RoleConfig:
    return _role("MAINSTREET_ORCHESTRATOR_KEY", "orchestrator")


def summary() -> dict:
    """Surfaced on /api/health so the UI can show what is actually wired up."""
    e, o = emulator_config(), orchestrator_config()
    return {
        "emulator": {"status": e.status, "model": e.model if e.enabled else None},
        "orchestrator": {"status": o.status, "model": o.model if o.enabled else None},
        "env_file": str(ENV_FILE) if ENV_FILE.exists() else None,
    }
