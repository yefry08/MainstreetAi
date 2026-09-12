/**
 * What the 3D scene needs to know to stand a city up.
 *
 * Everything here used to be a constant in Scene.jsx or buildings.js with
 * "Barcelona" written next to it in a comment. Two cities means these become
 * parameters, and collecting them in one place is what stops a third city
 * turning into a hunt through five files for hardcoded coordinates.
 *
 * NOT the same thing as city/cities.js, which is the list of world cities the
 * browser-side simulator offers. This is the handful of places that already
 * have a SUMO network, a recording and a basemap.
 */

/**
 * BEARING IS NOT DECORATION.
 *
 * Both cities are set to the angle of their own street grid, so avenues run up
 * the frame instead of across it diagonally. Barcelona's Eixample sits about
 * 18 degrees west of north; Manhattan's grid is famously rotated about 29
 * degrees east of it. A grid city viewed off-axis reads as a mess, and the
 * whole point of the shot is that you can see the corridors.
 */
export const CITIES = {
  barcelona: {
    key: 'barcelona',
    label: 'Barcelona',
    // The recording folder and asset suffix. Barcelona is unsuffixed for the
    // reasons set out in pixel/districtAssets.js -- renaming the deployed
    // files for symmetry would break every existing deployment for nothing.
    district: 'barcelona',
    // Scene anchor. Everything three.js draws is metres from here; see
    // three/geo.js for why a local origin is not optional.
    origin: [2.1662, 41.3925],
    home: { center: [2.1655, 41.3925], zoom: 15.1, pitch: 66, bearing: -18 },
    buildings: 'data/buildings.geojson',
    signals: 'data/signal_approaches.geojson',
    // The older per-junction lamps. The server applies the same fallback, so
    // both ends agree if the approaches file was never generated.
    signalsFallback: 'data/signals.geojson',
    /**
     * Heights drawn at 1.45x true.
     *
     * A visualisation choice, not data. The Eixample is a near-uniform plain of
     * 6-8 storey blocks and at traffic-view zooms true heights compress into a
     * flat crust, so this restores the silhouette. Nothing downstream measures
     * buildings, so nothing is misled.
     */
    exaggeration: 1.45,
    supertall: false,
    hasSignalStates: true,
    label3d: 'Barcelona · Signal Twin',
  },

  manhattan: {
    key: 'manhattan',
    label: 'Manhattan',
    district: 'manhattan',
    // Centre of the Midtown district, from districts.json.
    origin: [-73.985, 40.7555],
    home: { center: [-73.985, 40.7555], zoom: 14.9, pitch: 64, bearing: 29 },
    buildings: 'data/buildings_manhattan.geojson',
    signals: 'data/signal_approaches_manhattan.geojson',
    signalsFallback: null,
    /**
     * True height, no exaggeration.
     *
     * The opposite call to Barcelona's, for the opposite reason. Midtown
     * already has 450 m of range between its brownstones and its towers, so it
     * needs no help reading as three-dimensional -- and 1.45x would put Central
     * Park Tower at 685 m, taller than anything ever built.
     */
    exaggeration: 1,
    supertall: true,

    /**
     * NO LAMPS, BECAUSE THE RECORDING HAS NO SIGNAL STATES.
     *
     * MEASURED, not assumed: replay_manhattan/ai.sig.bin and baseline.sig.bin
     * are 110,696 and 105,848 bytes and every single byte is zero. Barcelona's
     * equivalent is 96.9% non-zero. replay_shibuya is empty in the same way.
     * All three manifests declare n_sig 3230 -- Barcelona's approach count --
     * even though Midtown has 1,248, so the recorder sized the buffer from the
     * wrong city and then never wrote to it.
     *
     * Drawing them anyway is the tempting mistake: state 0 renders as red, so
     * the scene comes up with 1,248 lamps stuck red forever over a city whose
     * traffic flows straight through them. On a project whose entire claim is
     * about retiming signals, a frozen all-red grid is not a cosmetic bug --
     * it is a picture that contradicts the argument.
     *
     * The VEHICLES are genuinely Manhattan's (157 against the baseline's 195 at
     * frame 0) and the recorded stats are real, so the comparison itself stands.
     * It is only this one channel that is missing. Flip this to true once
     * sim/record_replay.py has been re-run for Manhattan against its OWN
     * signal list.
     */
    hasSignalStates: false,
    label3d: 'Midtown Manhattan · Signal Twin',
  },
}

export const DEFAULT_CITY = 'barcelona'

export const cityConfig = (key) => CITIES[key] ?? CITIES[DEFAULT_CITY]
