# The two AI roles

Both are **inert without a key**. With no keys configured the simulation runs
the validated rules-based policy and the three built-in scenarios, exactly as it
does today — nothing in the demo depends on a network call succeeding.

## Plugging in the keys

```bash
cp .env.example .env      # .env is gitignored
```

```ini
MAINSTREET_EMULATOR_KEY=AIza...      # or AQ....
MAINSTREET_ORCHESTRATOR_KEY=nvapi-...
```

The **provider is inferred from the key's prefix** — `AIza…`/`AQ.…` → Gemini,
`nvapi-…` → NVIDIA NIM, `sk-ant-…` → Anthropic. Pasting two keys is normally
the whole configuration.

Restart `python server/app.py`. Confirm with:

```bash
curl -s localhost:8000/api/health | python -m json.tool
```

`ai.orchestrator.status` and `ai.emulator.status` should read `ready`.

### Why two keys and not one

The emulator invents traffic. The orchestrator influences signal timing. They
are different trust levels, so they get different credentials: you can budget,
rate-limit, revoke and audit them independently, and a compromised scenario
generator has no path to the control loop. Either falls back to
`ANTHROPIC_API_KEY` for local convenience.

---

## Orchestrator — the strategic layer

### The architecture, and why it is this shape

An LLM **cannot** drive 1,151 junctions at 1 Hz. That is roughly 69,000
decisions a minute, each needing sub-second latency. Control is therefore split:

| Layer | Who | Cadence | Decides |
|---|---|---|---|
| **Strategic** | Claude | ~60 simulated seconds | five policy parameters + a rationale |
| **Tactical** | `AdaptiveController` | 1 Hz, every junction | which green to hold or release |

This is not a cost compromise — it is how a deployable system would be built.
The safety-critical timing stays in six auditable rules; the layer that can be
wrong in surprising ways never touches a signal directly.

### The five parameters

| Parameter | Bounds | Effect |
|---|---|---|
| `min_green` | 6–20 s | green that can never be truncated |
| `max_green_base` | 25–90 s | fairness cap before a forced phase change |
| `imbalance` | 1.0–2.0 | how much the served queue must beat the waiting one to hold |
| `bus_detect_m` | 60–220 m | how early an approaching bus requests priority |
| `tsp_max_green` | 30–110 s | longest green a bus may hold |

### Every value is clamped in code

`POLICY_BOUNDS` is applied **after** parsing the response, and again in
`AdaptiveController.apply_policy`. The model cannot set a minimum green below
the pedestrian clearance interval no matter what it returns.

The duplication is deliberate: this is the last line before parameters reach
1,151 live controllers, and a bound that only exists in the caller is a bound
that disappears the first time someone adds a second caller.

Verified against hostile input:

```
in : {'min_green': 0.5, 'max_green_base': 999, 'imbalance': -3, 'tsp_max_green': 'nonsense'}
out: {'min_green': 6.0, 'max_green_base': 90.0, 'imbalance': 1.0, 'tsp_max_green': 70.0}
```

The model also cannot change the controller's **structure** — the six rules,
their priority order, and the fact that SUMO always runs its own yellow and
all-red clearance are fixed in code and unreachable from a prompt.

### Failure is a non-event

Any error — timeout, rate limit, malformed response — returns the *previous*
policy unchanged and records the reason. A signal network must not change
behaviour because an HTTP call failed. The decision runs on its own thread, so
a slow call never stalls the simulation.

### Policy goes to the AI twin only

Sending it to the baseline would destroy the A/B the entire demo rests on.

```bash
curl -s localhost:8000/api/ai/policy | python -m json.tool
```

---

## Emulator — scenarios from a description

```bash
curl -s -X POST localhost:8000/api/ai/scenario \
  -H 'Content-Type: application/json' \
  -d '{"description":"a cruise ship docks and 4000 people head for the Gothic Quarter in the rain"}'
```

Add `"dry_run": true` to see the events without injecting them.

### What it does and does not do

| | |
|---|---|
| **Does** | translate intent into bounded parameters: where, how many, over what window, what weather |
| **Does not** | invent traffic physics |

Every event it emits is executed by SUMO against the real road network with
real routing and real signal timing. **The model chooses the scenario; the
microsimulation decides what happens.**

That distinction is what keeps the "honest proof of concept" claim true. An LLM
guessing at congestion outcomes would be fabrication. An LLM writing a plausible
incident and handing it to a validated simulator is just a better input device —
and that is worth saying out loud when a judge asks what the AI is actually
doing.

### Bounded by construction

- Only the eight named anchors and three corridors exist; the model cannot
  invent coordinates, because a made-up lat/lon would land outside the network
  and silently inject nothing.
- Vehicle counts clamp at 5,000 per event, max 4 events. A scenario asking for
  90,000 cars gets 5,000 and a warning saying so.
- Scenarios are applied to **both twins identically**, exactly like the built-in
  events. Injecting into one would rig the comparison.

---

## Providers and models

| Provider | Structured output | Notes |
|---|---|---|
| **gemini** | native `responseSchema` | constrained at decode time, so malformed JSON is not a failure mode |
| **nvidia** | requested, not enforced | OpenAI-compatible NIM; responses go through a tolerant parser |
| **anthropic** | `output_config.format` | adaptive thinking, medium effort |

### Model fallback chains

Each role tries an ordered list of models until one answers. **This is not
defensive over-engineering.** Building it hit all three failure modes inside an
hour, on live endpoints:

| Failure | Seen as |
|---|---|
| model retired | `404 — no longer available to new users` |
| model at capacity | `503 — experiencing high demand` |
| model unreachable | connection accepted, never responds |

None of those are things you control on the day. On the very first live
scenario call the configured model 503'd and the chain fell through to the next
one, which answered — the demo would simply have died otherwise.

`meta.fell_back_from` records when this happens, so a consistently failing
primary is visible before a pitch rather than during it.

Defaults are in `config.py`; override with
`MAINSTREET_<ROLE>_FALLBACKS=a,b,c`.

To keep keys in place but run the deterministic baseline — useful for a
reproducible A/B — set `MAINSTREET_ORCHESTRATOR_DISABLED=true`.

---

## What is worth demonstrating

With keys in, the honest framing is:

> "The AI is not flipping individual lights — that would be neither fast enough
> nor safe. It reads the whole network once a minute and sets the policy the
> controller runs, and every parameter it can touch is bounded in code. Here is
> the rationale it gave for the last change."

The rationale string is surfaced in `/api/ai/policy` precisely so it can be read
aloud.
