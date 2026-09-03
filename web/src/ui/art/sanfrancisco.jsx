/**
 * San Francisco, as a CSS isometric diorama.
 *
 * NOT A MAP, and not SVG. Every solid here is a real box in CSS 3D space --
 * three faces, shaded top/left/right from one colour -- laid on a raised slab
 * and projected with a single rotateX/rotateZ on the parent. That is what the
 * flat SVG cards were missing: with real depth the browser sorts the solids by
 * actual 3D position, so towers occlude what is behind them and the skyline
 * reads as a model rather than as stacked shapes.
 *
 * WHAT MAKES IT SAN FRANCISCO
 * Six things a viewer can name at thumbnail size: the Golden Gate towers over
 * the bay, the Transamerica pyramid, Salesforce Tower, a row of Painted Ladies,
 * Coit Tower on its hill, and the Ferry Building clock. Everything else is
 * street, tree and traffic to hold them together.
 *
 * FIVE THINGS MOVE, ALL CHEAP
 * Traffic on two streets, a boat crossing the bay, the aircraft beacon on
 * Salesforce, windows warming at dusk, and fog drifting in off the Pacific --
 * the last being the one piece of weather this city is actually known for.
 * All CSS keyframes on transform and opacity: no JS, no timers, no work at all
 * while the tab is hidden, and every one stops under prefers-reduced-motion.
 */

/** One solid. Footprint (w x d) at (x, y), rising h from height z. */
function Box({ x, y, z = 0, w, d, h, c, cls = '' }) {
  const s = {
    '--x': `${x}px`, '--y': `${y}px`, '--z': `${z}px`,
    '--w': `${w}px`, '--d': `${d}px`, '--h': `${h}px`, '--c': c,
  }
  return (
    <div className={`sf-box ${cls}`} style={s}>
      <b className="t" /><b className="f" /><b className="r" />
    </div>
  )
}

/** Trunk plus canopy, small enough to scatter freely. */
function Tree({ x, y }) {
  return (
    <>
      <Box x={x + 1.5} y={y + 1.5} z={12} w={2} d={2} h={5} c="#6b4a2e" />
      <Box x={x} y={y} z={17} w={5} d={5} h={5} c="#5f9f5c" cls="sf-canopy" />
    </>
  )
}

// Downtown filler. Kept as data so the skyline can be retuned without
// touching markup, and so the lit windows can be staggered by index.
const BLOCKS = [
  { x: 186, y: 116, w: 16, d: 16, h: 30, c: '#cdc6b6' },
  { x: 208, y: 118, w: 14, d: 14, h: 42, c: '#b9bfc7' },
  { x: 186, y: 140, w: 18, d: 14, h: 24, c: '#c7b9a4' },
  { x: 210, y: 146, w: 14, d: 16, h: 34, c: '#d5cdbc' },
  { x: 232, y: 106, w: 14, d: 14, h: 26, c: '#c2c8d0' },
  { x: 160, y: 128, w: 14, d: 14, h: 20, c: '#cfc4ae' },
  { x: 160, y: 152, w: 16, d: 16, h: 28, c: '#bfb6a4' },
  { x: 232, y: 152, w: 14, d: 14, h: 22, c: '#cbc3b2' },
]

// The Painted Ladies: four narrow Victorians shoulder to shoulder.
const LADIES = [
  { x: 12, c: '#6f93b8', roof: '#4e6b88' },
  { x: 26, c: '#b5563f', roof: '#8a3f2e' },
  { x: 40, c: '#e6dcc6', roof: '#b6a98d' },
  { x: 54, c: '#cfa068', roof: '#9c754a' },
]

export default function SanFrancisco() {
  return (
    <div className="sf" role="img"
         aria-label="Isometric illustration of San Francisco: the Golden Gate bridge over the bay, the Transamerica pyramid, Salesforce Tower, Coit Tower, the Ferry Building and a row of Painted Ladies">
      <div className="sf-world">
        {/* the slab everything sits on */}
        <Box x={0} y={0} w={260} d={260} h={12} c="#d9dcc2" cls="sf-slab" />

        {/* the bay, a hair above the slab so it reads as water not paint */}
        <Box x={0} y={8} z={12} w={260} d={52} h={1} c="#6fa8c9" cls="sf-water" />
        <Box x={0} y={56} z={12} w={260} d={4} h={1} c="#8fbcd6" />

        {/* Golden Gate: two towers, a deck between them, and the crossbars
            that make the silhouette read even at card size */}
        <Box x={38} y={10} w={9} d={9} h={64} c="#c1443a" />
        <Box x={38} y={50} w={9} d={9} h={64} c="#c1443a" />
        <Box x={32} y={0} z={30} w={22} d={70} h={3} c="#b03e34" />
        <Box x={38} y={0} z={60} w={9} d={70} h={1.5} c="#a83a30" />
        <Box x={38} y={0} z={48} w={9} d={70} h={1} c="#a83a30" />
        {/* a boat crossing under it */}
        <Box x={100} y={28} z={13} w={9} d={4} h={3} c="#f3efe6" cls="sf-boat" />

        {/* two streets */}
        <Box x={0} y={102} z={12} w={260} d={13} h={0.6} c="#7d7f86" />
        <Box x={136} y={60} z={12} w={13} d={198} h={0.6} c="#7d7f86" />

        {/* Painted Ladies, west side */}
        {LADIES.map((l) => (
          <div key={l.x}>
            <Box x={l.x} y={78} w={12} d={16} h={26} c={l.c} />
            <Box x={l.x} y={78} z={26} w={12} d={16} h={4} c={l.roof} />
          </div>
        ))}

        {/* Palace of Fine Arts and its pond */}
        <Box x={8} y={196} z={12} w={36} d={24} h={1} c="#7fb3cd" />
        <Box x={16} y={168} w={22} d={22} h={20} c="#dccfae" />
        <Box x={20} y={172} z={20} w={14} d={14} h={10} c="#e8dcc0" />

        {/* Coit Tower on its hill */}
        <Box x={98} y={80} w={28} d={28} h={16} c="#8fae74" />
        <Box x={108} y={90} z={16} w={8} d={8} h={38} c="#e8e0cf" />
        <Box x={108} y={90} z={54} w={8} d={8} h={3} c="#cfc5b0" />

        {/* Ferry Building: long shed, clock tower through the middle */}
        <Box x={152} y={62} w={46} d={14} h={17} c="#cfc4ae" />
        <Box x={170} y={62} w={10} d={10} h={46} c="#dbd0b9" />
        <Box x={170} y={62} z={46} w={10} d={10} h={4} c="#b6a98d" />

        {/* Transamerica: stacked, tapering, with its spire */}
        <Box x={204} y={88} w={18} d={18} h={14} c="#e2e5e9" />
        <Box x={207} y={91} z={14} w={12} d={12} h={16} c="#dcdfe4" />
        <Box x={209} y={93} z={30} w={8} d={8} h={16} c="#d5d9de" />
        <Box x={211} y={95} z={46} w={4} d={4} h={14} c="#cdd2d8" />
        <Box x={212} y={96} z={60} w={2} d={2} h={10} c="#b9bec5" />

        {/* Salesforce Tower, the tallest thing on the card */}
        <Box x={228} y={126} w={15} d={15} h={74} c="#5b8ea3" cls="sf-glass" />
        <Box x={230} y={128} z={74} w={11} d={11} h={6} c="#4a7688" />
        <span className="sf-beacon" />

        {/* downtown filler */}
        {BLOCKS.map((b, i) => (
          <Box key={i} {...b} cls={i % 3 === 0 ? 'sf-lit' : ''} />
        ))}

        {/* traffic: two on each street, offset so they do not travel as a pair */}
        <Box x={0} y={105} z={12.6} w={10} d={5} h={4} c="#d97757" cls="sf-car a" />
        <Box x={0} y={105} z={12.6} w={9} d={5} h={4} c="#f3efe6" cls="sf-car b" />
        <Box x={0} y={109} z={12.6} w={12} d={5} h={5} c="#e0342b" cls="sf-car c" />
        <Box x={139} y={0} z={12.6} w={5} d={10} h={4} c="#f2c230" cls="sf-cross a" />
        <Box x={139} y={0} z={12.6} w={5} d={9} h={4} c="#4a7fb0" cls="sf-cross b" />

        {/* street trees */}
        <Tree x={78} y={120} /><Tree x={96} y={132} /><Tree x={118} y={150} />
        <Tree x={60} y={168} /><Tree x={40} y={132} /><Tree x={150} y={182} />
        <Tree x={196} y={182} /><Tree x={214} y={196} /><Tree x={84} y={196} />
      </div>

      {/* fog, in screen space rather than world space: it should drift across
          the whole picture, not lie on the ground plane */}
      <div className="sf-fog f1" />
      <div className="sf-fog f2" />
    </div>
  )
}
