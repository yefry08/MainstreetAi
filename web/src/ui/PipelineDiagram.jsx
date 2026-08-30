/**
 * The three-phase technical pipeline, as markup rather than as an image.
 *
 * WHY NOT JUST SHIP THE PNG
 * A diagram is mostly text. Rendered as an image that text cannot be selected,
 * searched, translated or read aloud, it ships at a few hundred KB, it blurs on
 * a high-DPI screen unless shipped at 2x, and it arrives with its own
 * background colour that fights whatever the page is doing. Built as markup it
 * reflows on a phone, inherits the site's palette, weighs nothing, and stays
 * legible at any zoom.
 *
 * The cost is that it has to be maintained alongside the thing it describes.
 * That is the right trade here, because a diagram of the architecture is
 * exactly the kind of artefact that goes stale silently.
 */

const PHASES = [
  {
    n: '01',
    title: 'Data Layer',
    blocks: [
      {
        head: 'city2graph',
        tone: 'teal',
        items: ['Road network → nodes/edges', 'GTFS public transit routes',
                'City boundaries', 'Building footprints'],
        note: 'Unified city graph',
      },
      {
        head: 'Open Data & sensors',
        tone: 'amber',
        items: ['Barcelona Open Data', 'Municipal traffic counters',
                'Time-of-day demand profile'],
      },
      {
        head: 'SUMO simulation engine',
        tone: 'terracota',
        items: ['Vehicle-following model', 'Baseline signal timing',
                'Queue & wait-time output'],
        note: 'Runs on the same network — one source of truth for phases 2 and 3',
      },
    ],
  },
  {
    n: '02',
    title: 'Visual Layer',
    blocks: [
      {
        head: 'Illustrated basemap',
        tone: 'violet',
        items: ['Flat-colour map baked from the OSM geometry',
                'Buildings, streets, parks and water as vector art',
                'Rendered once with prettymaps'],
        note: 'Output: a palettised PNG plus a lon/lat → pixel transform',
      },
      {
        head: 'Live simulation overlay',
        tone: 'terracota',
        items: ['Cars, buses, bikes and trucks as pixel sprites',
                'Moving along the real street geometry',
                'Headlight glow at night, live signal-phase state'],
        note: 'Drawn over the basemap in the same coordinate space',
      },
    ],
  },
  {
    n: '03',
    title: 'AI Orchestration',
    blocks: [
      {
        head: 'Inputs',
        tone: 'teal',
        items: ['Queue length per approach', 'Bus proximity',
                'Time-of-day demand pattern'],
      },
      {
        head: 'Actions',
        tone: 'amber',
        items: ['Retime signal phases', 'Green wave for an approaching bus',
                'Hold or extend a green on demand'],
      },
      {
        head: 'Measured impact',
        tone: 'teal',
        items: ['CO₂ avoided', 'Vehicle-minutes saved', 'Bus speed and driver wait'],
        note: 'Measured against a fixed-time twin on identical demand',
      },
    ],
  },
]

export default function PipelineDiagram() {
  return (
    <figure className="pipeline">
      <figcaption className="pipeline-cap">
        <h2>How it actually works</h2>
        <p>
          Three phases, none of which involve a language model. The contrast
          with the work above is the point: agent simulation is the research
          context, not the mechanism.
        </p>
      </figcaption>

      <ol className="pipeline-phases">
        {PHASES.map((ph) => (
          <li className="pipeline-phase" key={ph.n}>
            <div className="pipeline-phase-head">
              <span className="pipeline-num">{ph.n}</span>
              <h3>{ph.title}</h3>
            </div>

            <div className="pipeline-blocks">
              {ph.blocks.map((b) => (
                <div className={`pipeline-block glass tone-${b.tone}`} key={b.head}>
                  <h4>{b.head}</h4>
                  <ul>
                    {b.items.map((it) => <li key={it}>{it}</li>)}
                  </ul>
                  {b.note && <p className="pipeline-note">{b.note}</p>}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <p className="pipeline-foot">
        The same three phases re-run for any district — Barcelona and Shibuya
        have full simulations today; Manhattan, San Francisco, CABA and central
        London are baked basemaps awaiting a network.
      </p>
    </figure>
  )
}
