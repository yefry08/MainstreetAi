"""
The districts the demo can run, and their bounding boxes.

WHY DISTRICTS AND NOT CITIES
A metro-area extract is the wrong unit for this simulation twice over. The
prettymaps bake scales linearly with area -- Barcelona's 67 km2 square took 26
minutes -- and SUMO's step time scales with vehicle count, which is already
below realtime at 3,100 vehicles on one core. A neighbourhood is small enough
that the graph stays responsive, the bake is minutes rather than an hour, and
every signalised junction on screen is one the AI is actually orchestrating.

WHY THESE FIVE
Each is a dense, gridded, heavily signalised core -- the conditions adaptive
signal control is for. A sprawling low-signal area would bake slowly and render
as an almost empty map, which demonstrates nothing.

SAN FRANCISCO, NOT SILICON VALLEY
Silicon Valley is roughly 50 km of freeway-linked sprawl from Palo Alto to San
Jose. It has no dense grid, few signalised intersections per km2, and its
traffic is dominated by limited-access highway which adaptive city signals do
not touch. Downtown San Francisco -- Financial District, SoMa, Union Square --
is a tight signalised grid with heavy transit, which is the thing worth
showing.

Boxes are deliberately ~2-3 km on a side. See build_district.py for the bake.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class District:
    key: str
    city: str
    name: str
    # south, west, north, east
    bbox: tuple[float, float, float, float]
    why: str
    gtfs: str = ""

    @property
    def label(self) -> str:
        return f"{self.city} — {self.name}"

    @property
    def centre(self) -> tuple[float, float]:
        s, w, n, e = self.bbox
        return ((w + e) / 2, (s + n) / 2)

    def size_km(self) -> tuple[float, float]:
        import math
        s, w, n, e = self.bbox
        mid = math.radians((s + n) / 2)
        return ((e - w) * 111.32 * math.cos(mid), (n - s) * 111.32)

    def radius_m(self) -> float:
        """Half the longer side: prettymaps takes a radius and renders square."""
        kw, kh = self.size_km()
        return max(kw, kh) * 1000 / 2


DISTRICTS: list[District] = [
    District(
        key="barcelona",
        city="Barcelona",
        name="Eixample",
        bbox=(41.3635, 2.1142, 41.4212, 2.2107),
        why="The reference build. Cerdà's grid is the densest signalised "
            "network in the set.",
        gtfs="TMB via Mobility Database mdb-2359",
    ),
    District(
        key="shibuya",
        city="Tokyo",
        name="Shibuya",
        bbox=(35.6520, 139.6900, 35.6720, 139.7130),
        why="One of the most heavily signalised pedestrian-vehicle conflicts "
            "anywhere; the scramble crossing is the point.",
    ),
    District(
        key="manhattan",
        city="New York",
        name="Midtown Manhattan",
        bbox=(40.7430, -74.0000, 40.7680, -73.9700),
        why="A near-perfect rectangular grid with avenue-length green waves -- "
            "the textbook case for signal coordination.",
    ),
    District(
        key="sf_downtown",
        city="San Francisco",
        name="Downtown & SoMa",
        bbox=(37.7770, -122.4180, 37.7980, -122.3900),
        why="Chosen over Silicon Valley: a tight signalised grid with heavy "
            "transit, where Silicon Valley is 50 km of freeway sprawl with "
            "few city signals.",
    ),
    District(
        key="caba",
        city="Buenos Aires",
        name="Microcentro, CABA",
        bbox=(-34.6180, -58.3980, -34.5950, -58.3660),
        why="Dense colonial grid with very short blocks, so junction density "
            "per km2 is among the highest here.",
    ),
    District(
        key="london_city",
        city="London",
        name="City & Westminster",
        bbox=(51.5030, -0.1400, 51.5200, -0.0750),
        why="Central London core rather than Greater London: the congestion "
            "charge zone is roughly this, and it is where the signals are.",
    ),
]

BY_KEY = {d.key: d for d in DISTRICTS}


def summary() -> list[dict]:
    out = []
    for d in DISTRICTS:
        kw, kh = d.size_km()
        out.append({
            "key": d.key,
            "city": d.city,
            "name": d.name,
            "label": d.label,
            "bbox": list(d.bbox),
            "centre": list(d.centre),
            "km": [round(kw, 2), round(kh, 2)],
            "area_km2": round(kw * kh, 1),
            "radius_m": round(d.radius_m()),
            "why": d.why,
        })
    return out


if __name__ == "__main__":
    print(f"{'district':<28}{'size km':>14}{'area':>9}{'radius':>9}")
    print("-" * 62)
    tot = 0.0
    for d in summary():
        tot += d["area_km2"]
        print(f"{d['label']:<28}{d['km'][0]:>6.2f} x{d['km'][1]:>6.2f}"
              f"{d['area_km2']:>8.1f}{d['radius_m']:>9.0f}")
    print("-" * 62)
    print(f"{'total':<28}{'':>14}{tot:>8.1f} km2")
    print()
    print("Barcelona is the outlier: it is the existing full-extent build, not")
    print("a district. The other five are sized so a bake is minutes.")
