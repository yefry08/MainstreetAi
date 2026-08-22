"""
Provider abstraction for the two AI roles.

Both roles need exactly one thing: given a system prompt, a user prompt and a
JSON schema, return a dict that conforms to it. That is a small enough surface
to support several providers without an abstraction layer that costs more than
it saves.

Supported:
  gemini     Google Generative Language API. Native `responseSchema` — the
             model is constrained at decode time, so malformed JSON is not a
             failure mode.
  nvidia     NVIDIA NIM, OpenAI-compatible. JSON is requested rather than
             enforced, so responses go through a tolerant parser.
  anthropic  Claude via the official SDK, using `output_config.format`.

Each returns `(data, meta)` and raises on failure. The callers treat any
exception as "keep the previous policy" — see orchestrator.py.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

import requests

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

DEFAULT_MODELS = {
    "gemini": "gemini-2.5-flash",
    "nvidia": "meta/llama-3.3-70b-instruct",
    "anthropic": "claude-opus-5",
}


class ProviderError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# JSON extraction
# ---------------------------------------------------------------------------
_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


def extract_json(text: str) -> dict:
    """
    Pull a JSON object out of a model response.

    Providers that constrain decoding return clean JSON and hit the fast path.
    Providers that merely *ask* for JSON will sometimes wrap it in a markdown
    fence or add a sentence of preamble, and failing the whole control decision
    over a stray ```json would be an absurd way to lose a demo.
    """
    text = (text or "").strip()
    if not text:
        raise ProviderError("empty response")

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    m = _FENCE.search(text)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Last resort: the outermost braces.
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    raise ProviderError(f"no JSON object in response: {text[:120]!r}")


def _strip_for_gemini(schema: Any) -> Any:
    """
    Gemini's responseSchema is an OpenAPI subset and rejects some JSON Schema
    keywords outright — `additionalProperties` among them, which our schemas
    set everywhere for strictness with the other two providers.
    """
    if isinstance(schema, dict):
        return {
            k: _strip_for_gemini(v)
            for k, v in schema.items()
            if k not in ("additionalProperties", "$schema")
        }
    if isinstance(schema, list):
        return [_strip_for_gemini(v) for v in schema]
    return schema


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------
def _call_gemini(api_key: str, model: str, system: str, user: str,
                 schema: dict, max_tokens: int, timeout: float) -> tuple[dict, dict]:
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": _strip_for_gemini(schema),
            "maxOutputTokens": max_tokens,
            # Low but not zero: policy decisions should be stable run to run,
            # while scenario writing benefits from a little variation.
            "temperature": 0.4,
        },
    }
    r = requests.post(
        GEMINI_URL.format(model=model),
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json=body,
        timeout=timeout,
    )
    if r.status_code != 200:
        raise ProviderError(f"gemini HTTP {r.status_code}: {r.text[:200]}")

    payload = r.json()
    candidates = payload.get("candidates") or []
    if not candidates:
        raise ProviderError(f"gemini returned no candidates: {str(payload)[:200]}")

    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts)
    usage = payload.get("usageMetadata") or {}
    return extract_json(text), {
        "input_tokens": usage.get("promptTokenCount"),
        "output_tokens": usage.get("candidatesTokenCount"),
        "finish": candidates[0].get("finishReason"),
    }


def _call_nvidia(api_key: str, model: str, system: str, user: str,
                 schema: dict, max_tokens: int, timeout: float) -> tuple[dict, dict]:
    # NIM is OpenAI-compatible but structured-output support varies by model, so
    # the schema goes in the prompt as well as in response_format. Belt and
    # braces is cheaper than discovering at demo time that this model ignores
    # response_format.
    sys_prompt = (
        f"{system}\n\n"
        "Respond with a single JSON object and nothing else — no prose, no "
        "markdown fence. It must match this JSON Schema exactly:\n"
        f"{json.dumps(schema, separators=(',', ':'))}"
    )
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
    }
    r = requests.post(
        NVIDIA_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=body,
        timeout=timeout,
    )
    if r.status_code != 200:
        # Some NIM models reject response_format; retry once without it rather
        # than fail the decision.
        if r.status_code == 400 and "response_format" in r.text:
            body.pop("response_format", None)
            r = requests.post(
                NVIDIA_URL,
                headers={"Authorization": f"Bearer {api_key}",
                         "Content-Type": "application/json"},
                json=body,
                timeout=timeout,
            )
        if r.status_code != 200:
            raise ProviderError(f"nvidia HTTP {r.status_code}: {r.text[:200]}")

    payload = r.json()
    choices = payload.get("choices") or []
    if not choices:
        raise ProviderError(f"nvidia returned no choices: {str(payload)[:200]}")

    text = (choices[0].get("message") or {}).get("content", "")
    usage = payload.get("usage") or {}
    return extract_json(text), {
        "input_tokens": usage.get("prompt_tokens"),
        "output_tokens": usage.get("completion_tokens"),
        "finish": choices[0].get("finish_reason"),
    }


def _call_anthropic(api_key: str, model: str, system: str, user: str,
                    schema: dict, max_tokens: int, timeout: float) -> tuple[dict, dict]:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=1)
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        thinking={"type": "adaptive"},
        output_config={"effort": "medium",
                       "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": user}],
    )
    text = next((b.text for b in response.content if b.type == "text"), "")
    return extract_json(text), {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
        "finish": response.stop_reason,
    }


_DISPATCH = {
    "gemini": _call_gemini,
    "nvidia": _call_nvidia,
    "anthropic": _call_anthropic,
}


def complete_json(provider: str, api_key: str, model: str | list[str], *,
                  system: str, user: str, schema: dict, max_tokens: int = 2048,
                  timeout: float = 30.0) -> tuple[dict, dict]:
    """
    One structured completion. Returns (data, meta).

    `model` may be a list, tried in order until one succeeds.

    The fallback chain is not defensive over-engineering — building this hit all
    three failure modes inside an hour on live endpoints: a model retired out
    from under us (404 "no longer available to new users"), a model at capacity
    (503 "experiencing high demand"), and models that accept the connection and
    never respond. Pinning a single model means the demo dies on whichever of
    those happens on the day, and none of them are things you control.

    Raises ProviderError only if every model fails — callers treat any
    exception as "keep doing what you were doing".
    """
    fn = _DISPATCH.get(provider)
    if fn is None:
        raise ProviderError(f"unknown provider {provider!r}")

    models = [model] if isinstance(model, str) else list(model)
    if not models:
        raise ProviderError("no model configured")

    errors: list[str] = []
    for i, m in enumerate(models):
        t0 = time.perf_counter()
        try:
            data, meta = fn(api_key, m, system, user, schema, max_tokens, timeout)
        except Exception as exc:  # noqa: BLE001 - try the next model
            errors.append(f"{m}: {type(exc).__name__}: {str(exc)[:80]}")
            continue

        meta["provider"] = provider
        meta["model"] = m
        meta["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        if i:
            # Worth surfacing: if the primary is consistently failing you want
            # to know before the pitch, not during it.
            meta["fell_back_from"] = models[:i]
        return data, meta

    raise ProviderError("all models failed — " + "; ".join(errors))
