"""
Configuration for the two AI roles.

Each role gets its OWN key and its OWN provider. They are different trust
levels: the emulator invents traffic, the orchestrator influences signal
timing. Separate credentials mean you can budget, rate-limit, revoke and audit
them independently, and a compromised scenario generator has no path to the
control loop.

Provider is inferred from the key's shape, so the usual case is just pasting
two keys into .env and restarting:

    AIza…    -> gemini
    nvapi-…  -> nvidia
    sk-ant-… -> anthropic

Override with MAINSTREET_<ROLE>_PROVIDER if the inference is ever wrong.
No key is ever committed; .env is gitignored.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .providers import DEFAULT_MODELS

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent.parent / ".env"


def _load_dotenv() -> None:
    """
    Minimal .env reader. Deliberately not python-dotenv: this reads a handful
    of keys at startup, and a dependency for that is not worth the install
    friction on a machine that already has to build a SUMO network.
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


def infer_provider(key: str | None) -> str | None:
    """Identify the provider from the credential's prefix."""
    if not key:
        return None
    if key.startswith("nvapi-"):
        return "nvidia"
    if key.startswith("sk-ant-"):
        return "anthropic"
    # Google issues both `AIza…` API keys and `AQ.…` OAuth-style credentials;
    # both authenticate against the Generative Language API via x-goog-api-key.
    if key.startswith("AIza") or key.startswith("AQ."):
        return "gemini"
    return None


# Ordered fallback chains. Provider capacity is not something you control, and
# building this hit a retired model (404), a model at capacity (503) and models
# that hang — all on live endpoints within an hour. A chain means the demo
# survives whichever happens on the day.
FALLBACK_CHAINS = {
    "gemini": ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite"],
    # nemotron-3-nano-omni is a REASONING model: it returns its chain of
    # thought in a separate `reasoning_content` field and leaves `content`
    # as clean JSON, so the existing parser needs no special case. Verified
    # to accept response_format=json_object (2.4 s round trip).
    "nvidia": ["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
               "mistralai/mistral-nemotron"],
    "anthropic": ["claude-opus-5"],
}


@dataclass(frozen=True)
class RoleConfig:
    role: str
    provider: str | None
    api_key: str | None
    model: str
    enabled: bool
    models: tuple = ()

    @property
    def chain(self) -> list:
        """Configured model first, then the rest of the provider's chain."""
        seen, out = set(), []
        for m in (self.model, *self.models):
            if m and m not in seen:
                seen.add(m)
                out.append(m)
        return out

    @property
    def status(self) -> str:
        if not self.api_key:
            return "no key"
        if not self.provider:
            return "unknown provider"
        return "ready" if self.enabled else "disabled"

    def public(self) -> dict:
        """Safe to serve over the API — never includes the key."""
        return {
            "status": self.status,
            "provider": self.provider if self.enabled else None,
            "model": self.model if self.enabled else None,
            "fallbacks": self.chain[1:] if self.enabled else [],
        }


def _role(env_prefix: str, role: str) -> RoleConfig:
    key = os.environ.get(f"{env_prefix}_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    provider = os.environ.get(f"{env_prefix}_PROVIDER") or infer_provider(key)
    chain = FALLBACK_CHAINS.get(provider or "", [])
    model = (
        os.environ.get(f"{env_prefix}_MODEL")
        or (chain[0] if chain else DEFAULT_MODELS.get(provider or "", ""))
    )
    extra = os.environ.get(f"{env_prefix}_FALLBACKS", "")
    fallbacks = tuple(
        [m.strip() for m in extra.split(",") if m.strip()] or chain
    )
    # Explicit opt-out: keep keys in .env but run the deterministic baseline,
    # which is what you want for a reproducible A/B.
    disabled = os.environ.get(f"{env_prefix}_DISABLED", "").lower() in ("1", "true", "yes")
    return RoleConfig(
        role=role,
        provider=provider,
        api_key=key or None,
        model=model,
        models=fallbacks,
        enabled=bool(key and provider and model) and not disabled,
    )


def emulator_config() -> RoleConfig:
    return _role("MAINSTREET_EMULATOR", "emulator")


def orchestrator_config() -> RoleConfig:
    return _role("MAINSTREET_ORCHESTRATOR", "orchestrator")


def summary() -> dict:
    """Surfaced on /api/health so the UI shows what is actually wired up."""
    return {
        "emulator": emulator_config().public(),
        "orchestrator": orchestrator_config().public(),
        "env_file": str(ENV_FILE) if ENV_FILE.exists() else None,
    }
