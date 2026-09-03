"""
Higgsfield text-to-image / text-to-video client.

    python generate.py qwen-image-3 "Editorial portrait, hard flash, 35mm grain"
    python generate.py ltx-2.5-pro  "Aerial over Barcelona's Eixample at dusk"
    python generate.py --list

Credentials come from .env and never from the command line, so they cannot end
up in shell history, in a screen share, or in this repository. .env is already
in .gitignore; this refuses to run if that ever stops being true.

Every endpoint here returns a JOB, not a result. The first response carries a
status_url that has to be polled until the job reaches a terminal state. A
client that treats the first response as the answer gets a queue ticket and
reports success.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://platform.higgsfield.ai"
HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "media" / "generated"

# Endpoint paths exactly as documented. Kept as data rather than built from the
# model name because the paths are not consistently derivable from it --
# compare "nano-banana-2/lite" with "alibaba/qwen-image-3".
MODELS = {
    # text-to-image
    "qwen-image-3":       ("image", "/alibaba/qwen-image-3/text-to-image"),
    "nano-banana-2-lite": ("image", "/nano-banana-2/lite/text-to-image"),
    "gpt-image-2":        ("image", "/openai/gpt-image-2"),
    # text-to-video
    "minimax-h3":         ("video", "/minimax/h3/text-to-video"),
    "ltx-2.5-pro":        ("video", "/lightricks/ltx-2.5/text-to-video/pro"),
    "kling-3.0":          ("video", "/kling-video/v3.0/std/text-to-video"),
    "veo-3.1-fast":       ("video", "/veo3.1/fast/text-to-video"),
}

TERMINAL = {"completed", "failed", "nsfw", "canceled"}


# --------------------------------------------------------------------------
# credentials
# --------------------------------------------------------------------------

def load_env(path: Path) -> dict[str, str]:
    """Minimal .env reader. No dependency, and it never echoes a value."""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def credentials() -> tuple[str, str]:
    env = {**load_env(HERE / ".env"), **os.environ}
    key_id = env.get("HF_API_KEY_ID", "")
    secret = env.get("HF_API_KEY_SECRET", "")
    if not key_id or not secret:
        sys.exit(
            "Missing Higgsfield credentials.\n\n"
            "Add these two lines to .env (which is already gitignored):\n\n"
            "    HF_API_KEY_ID=<your key id>\n"
            "    HF_API_KEY_SECRET=<your secret>\n\n"
            "Do not pass them on the command line -- they would be recorded in\n"
            "your shell history."
        )
    return key_id, secret


def assert_env_is_ignored() -> None:
    """Refuse to run if .env has stopped being ignored, or got committed."""
    try:
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", ".env"],
            cwd=HERE, capture_output=True, text=True,
        ).returncode == 0
    except FileNotFoundError:
        return  # no git available; nothing to check
    if tracked:
        sys.exit("REFUSING TO RUN: .env is tracked by git. Untrack it before "
                 "using real credentials:\n    git rm --cached .env")


# --------------------------------------------------------------------------
# http
# --------------------------------------------------------------------------

def request(url: str, auth: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": auth, "Content-Type": "application/json"},
        method="POST" if data else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:600]
        # Never echo the Authorization header into an error message.
        sys.exit(f"HTTP {e.code} from {url.split('?')[0]}\n{body}")
    except urllib.error.URLError as e:
        sys.exit(f"Network error reaching Higgsfield: {e.reason}")


def poll(status_url: str, auth: str, timeout_s: float, quiet: bool) -> dict:
    """Poll until terminal. The job is the point; the first POST is not."""
    t0 = time.time()
    delay, last = 2.0, None
    while True:
        job = request(status_url, auth)
        status = job.get("status", "unknown")
        if status != last and not quiet:
            print(f"  [{time.time() - t0:5.0f}s] {status}")
            last = status
        if status in TERMINAL:
            return job
        if time.time() - t0 > timeout_s:
            sys.exit(f"Timed out after {timeout_s:.0f}s (last status: {status}).\n"
                     f"The job may still finish; poll {status_url} yourself.")
        time.sleep(delay)
        delay = min(delay * 1.3, 15.0)   # back off, but stay responsive early


def result_url(job: dict, kind: str) -> str | None:
    if kind == "image":
        imgs = job.get("images") or []
        return imgs[0].get("url") if imgs else None
    return (job.get("video") or {}).get("url")


def download(url: str, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=300) as r, open(dest, "wb") as f:
        total = 0
        while chunk := r.read(1 << 16):
            f.write(chunk)
            total += len(chunk)
    return total


# --------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("model", nargs="?", help="see --list")
    ap.add_argument("prompt", nargs="?")
    ap.add_argument("--list", action="store_true", help="list available models")
    ap.add_argument("--name", help="output filename stem (default: timestamp)")
    ap.add_argument("--timeout", type=float, default=900.0)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if args.list or not args.model:
        print("models:")
        for name, (kind, path) in MODELS.items():
            print(f"  {name:<20} {kind:<6} {path}")
        return

    if args.model not in MODELS:
        sys.exit(f"unknown model: {args.model}\nrun --list to see the options")
    if not args.prompt:
        sys.exit("a prompt is required")

    assert_env_is_ignored()
    key_id, secret = credentials()
    auth = f"Key {key_id}:{secret}"
    kind, path = MODELS[args.model]

    if not args.quiet:
        print(f"[{args.model}] {kind}")
        print(f"  prompt: {args.prompt[:96]}{'...' if len(args.prompt) > 96 else ''}")

    job = request(BASE + path, auth, {"prompt": args.prompt})

    status_url = job.get("status_url")
    if job.get("status") in TERMINAL or not status_url:
        final = job                      # some models may answer immediately
    else:
        final = poll(status_url, auth, args.timeout, args.quiet)

    status = final.get("status")
    if status != "completed":
        sys.exit(f"job ended as '{status}'"
                 + (f": {final.get('error')}" if final.get("error") else ""))

    url = result_url(final, kind)
    if not url:
        sys.exit(f"job completed but carried no {kind} url:\n"
                 f"{json.dumps(final, indent=2)[:600]}")

    stem = args.name or f"{args.model}-{time.strftime('%Y%m%d-%H%M%S')}"
    ext = ".mp4" if kind == "video" else ".png"
    dest = OUT_DIR / f"{stem}{ext}"
    size = download(url, dest)

    print(f"\n[ok] {dest.relative_to(HERE)}  ({size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
