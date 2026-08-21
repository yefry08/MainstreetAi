# Demo runbook

Five to seven minutes, live. The whole thing runs locally; only the basemap
tiles need the network.

## Before you present

```powershell
# once, ahead of time (downloads OSM, builds the network, generates demand)
.\setup.ps1
```

Then, right before you go on:

```powershell
python server\app.py
```

Open **http://127.0.0.1:8000** — the Python server serves the built web app
itself, so there is no second process and no npm at showtime. (Use `.\run.ps1`
instead if you want the Vite dev server for live editing.)

Give it ~60 seconds. Both SUMO instances load a 30 MB network before the first
frame appears. Wait until the status pill in the top right reads **LIVE** and
the dashboard has numbers in both columns.

**Have a backup.** If the venue wifi blocks the tile server the streets go dark
but the simulation, the dashboard and every number still work. Say so and carry
on — the argument does not depend on the basemap.

**Let it warm up before you quote emissions.** For the first ten simulated
minutes the CO₂ row reads *worse* for the AI — measured +10 % at t = 600 s — and
the reason is not a bug: by then the AI twin has completed 141 trips to the
baseline's 63, so it burned more fuel because it did more than twice the work.
By t = 1800 s the same metric reads −10.8 %. Delay and bus rows are meaningful
from the first minute; emissions are not. If someone catches the early number,
that explanation is a *strength* — it shows you understand your own instrument.

Best case: start the server ~10 minutes before you present and leave it running
at 5×. By the time you are on stage the simulated clock reads past 07:45 and
every number in the table is settled.

---

## The run of show

### 1. What you're looking at (45 s)

> "This is central Barcelona — nine and a half kilometres by seven. Real
> streets, real lane counts, real one-way rules, straight out of OpenStreetMap.
> Eleven and a half thousand road segments, and eleven hundred and fifty-one
> traffic lights that are where Barcelona's traffic lights actually are."

Point at the moving dots. Orange are buses, cyan are bikes, pale are cars. Red
means stopped.

> "This is a SUMO microsimulation — every vehicle is individually modelled,
> car-following behaviour and all. And it isn't one simulation. It's two."

### 2. The twin (60 s)

Point at the left panel.

> "Two identical copies of this city are running right now. Same streets, same
> trips, same random seed. The only difference between them is who controls the
> traffic lights. One runs Barcelona's fixed eighty-eight-second cycles. The
> other runs our AI."

Let the headline number sit there.

> "Around forty-four percent less time spent standing still. That's not a
> projection, that's the two simulations disagreeing with each other in real
> time."

Quote **forty-four**, not forty-five. Across the four validation runs the figure
ranged from −43.1 % to −45.0 %; the number you should be willing to defend is
the worst one, and "around forty-four" is honest for the middle. If someone
pushes, say "worst case we measured was forty-three."

Use the **Fixed-time / AI-adaptive** toggle to flip what the map draws. The
congestion overlay visibly cools down.

### 3. What the AI actually does (90 s)

Click any junction on a main corridor — Diagonal, Gran Via or Meridiana.

> "Click a junction and you see both controllers thinking. Left is fixed-time:
> it has no idea anything is there. Right is ours: queue lengths per approach,
> and the reason it made its last decision, in plain language."

> "It's rules-based, not a neural network, and that's deliberate. Six rules, in
> priority order. Minimum green is inviolable. Buses get priority. There's a
> fairness cap so no side street starves. And the controller can only *hold* or
> *release* a green — SUMO always runs its own yellow and all-red clearance, so
> it is structurally incapable of creating an unsafe signal state. That's the
> difference between a demo and something a city would actually let near live
> hardware."

Point at the bus row in the dashboard.

> "Buses lose about sixty-three percent less time stopped, and their mean speed
> goes up by at least twenty-three percent — that's the worst case across our
> validation runs; the best was over fifty. A bus carries eighty people. Six
> cars behind it carry eight. Once you can see the bus coming, that trade is
> obvious — and today's signals can't see it."

Then scroll to the equity block — **do this before anyone asks**, it lands much
better volunteered than extracted.

> "The obvious objection to any adaptive controller is that it buys a better
> average by abandoning somebody on a side street. So we measure the tail, not
> just the mean: ninety-fifth-percentile wait, worst wait in the network, and
> how many vehicles have been waiting more than five minutes. If we were
> starving side streets, those three numbers would be worse than the baseline.
> They aren't."

And the corridor panel underneath:

> "Broken out by corridor — Diagonal, Gran Via, Meridiana — because a pilot
> doesn't start with a whole city."

### 4. Break it (90 s)

Hit **Camp Nou lets out**.

> "Nine hundred extra cars around the stadium over ten minutes."

Watch the corridor redden, then recover. Then hit **Rain starts**.

> "Wet roads. Everyone slows down, headways stretch, a chunk of the cyclists give
> up."

> "Both events hit both simulations identically — otherwise I'd be rigging my own
> comparison. The point isn't that the AI stops congestion happening. It's that
> it clears it faster, and you can watch the gap between the two columns widen
> while it does."

### 5. Land it (45 s)

> "Six-month pilot: instrument one corridor. Diagonal has a hundred and
> eighty-four segments in this model and the signal hardware is already there —
> this is a controller software change, not a construction project."

> "And be clear about what this is. The streets and the signals are real. The
> trips are modelled, because Barcelona doesn't publish an origin-destination
> matrix — it says so on screen, bottom left. Emissions come out of SUMO's HBEFA3
> model, the same one the European Environment Agency uses, computed per vehicle
> from actual speed traces. What we're claiming is that the *relative*
> improvement between two identical cities is real. That's the honest claim, and
> it's the one that matters."

---

## If someone asks

**"Why not reinforcement learning?"**
Because a transport authority has to sign off on it. Every decision this makes
is explainable in one sentence and the failure modes are bounded by
construction. RL is the obvious phase-two once there's field data to train on —
and the pilot is what generates that data.

**"Isn't the demand fake?"**
The demand is modelled, yes, and we label it. The network, the signals, the
cycle-lane network and the vehicle physics are real. Both twins get the
identical modelled demand, so it cancels out of the comparison — which is the
whole reason the experiment is set up as a twin rather than a single run with a
before/after.

**"You tuned it until it worked, didn't you?"**
`python server/validate_seeds.py` re-runs the whole paired experiment across
several SUMO driver-behaviour seeds *and* a second, independently generated
demand set, then reports the **worst** case across runs rather than the mean.
The headline numbers hold on every run we've tried. That's in the repo, you can
run it yourself.

**"Does it starve side streets?"**
That's the right question, and it's why the dashboard carries an equity block.
Rule 4 is a hard fairness cap on green time, scaled by time of day, and we
report p95 wait, worst wait, and the count of vehicles waiting over five
minutes. Improving the average by hurting the tail would show up there
immediately.

**"Vehicles disappear sometimes."**
That's SUMO teleporting a vehicle that's been deadlocked for four minutes; it's
the simulator's escape hatch from gridlock. The fixed-time twin triggers it
roughly twice as often as the AI twin. It actually *understates* our result,
because those vehicles stop accumulating delay the moment they teleport.

**"What about pedestrians?"**
Not modelled as crossing demand — that's the honest gap. Pedestrian phases are
baked into the imported signal programs, and minimum green is never violated, so
crossing time is preserved. Modelling pedestrian demand explicitly is the first
thing we'd add.

**"Would this work anywhere else?"**
The pipeline takes an OSM bounding box. Point it at another city and it rebuilds
the whole thing. Nothing in the controller is Barcelona-specific except the
time-of-day demand curve.
