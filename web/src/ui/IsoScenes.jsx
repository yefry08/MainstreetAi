/**
 * Four isometric illustrations that explain the project at a glance: the open
 * data it is built from, the two-twin comparison, event-based prediction, and
 * shade, bike lanes and trees. Drawn as inline SVG so the labels translate
 * with the rest of the page and stay crisp at any width.
 *
 * ISOMETRIC PROJECTION. A point (x, y, z) in ground units lands at
 *   screen x = ox + (x - y) * cos30 * u,  screen y = oy + (x + y) * sin30 * u - z * u
 * so +x runs down-right, +y down-left and z straight up. A box shows its top,
 * its face at y + d (front-left) and its face at x + w (front-right); items
 * are drawn back to front (small x + y first).
 */
import { useT } from '../i18n'

const C = Math.cos(Math.PI / 6), S = 0.5
const f = (n) => +n.toFixed(1)

function iso(u, ox, oy) {
  const p = (x, y, z = 0) => [f(ox + (x - y) * C * u), f(oy + (x + y) * S * u - z * u)]
  const pts = (...ps) => ps.map((q) => p(...q).join(',')).join(' ')
  return {
    p,
    tile: (x, y, w, d, z, fill, extra = {}) => (
      <polygon points={pts([x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z])} fill={fill} {...extra} />
    ),
    box: (x, y, w, d, h, [top, left, right], z = 0, key) => (
      <g key={key}>
        <polygon points={pts([x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h])} fill={left} />
        <polygon points={pts([x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h])} fill={right} />
        <polygon points={pts([x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h])} fill={top} />
      </g>
    ),
    // A flat ellipse lying on the ground (or at height z): a crown, a shadow.
    disc: (x, y, r, z, fill, extra = {}) => {
      const [cx, cy] = p(x, y, z)
      return <ellipse cx={cx} cy={cy} rx={f(r * u * 1.22)} ry={f(r * u * 0.7)} fill={fill} {...extra} />
    },
  }
}

const BUILD = ['#efe2cf', '#cdb898', '#a99272']
const TOWER = ['#dfe7f0', '#b3c3d6', '#8ea2ba']
const CAR = ['#f0a083', '#d97757', '#b65a3c']
const CAR_AI = ['#a8dcb4', '#6fae7a', '#4f8a5a']
const GROUND = '#2a2e36', ROAD = '#41454f', LINE = '#6b7080'
const LEAF = '#6fae7a', LEAF_NEW = '#a8dcb4', TRUNK = ['#8a6a4a', '#6d523a', '#5a4430']
// A dark halo behind every label keeps it legible over buildings and roads.
const TXT = { fill: '#ded8d0', fontSize: 11, fontFamily: 'var(--font-data, monospace)',
              stroke: '#14161c', strokeWidth: 3, paintOrder: 'stroke', strokeLinejoin: 'round' }
const ACC = '#d97757'

function tree(I, x, y, h, r, color, key) {
  return (
    <g key={key}>
      {I.box(x - 0.08, y - 0.08, 0.16, 0.16, h, TRUNK)}
      {I.disc(x, y, r, h + 0.25, color)}
      {I.disc(x, y, r * 0.75, h + 0.6, color, { opacity: 0.85 })}
    </g>
  )
}

// ---- 1. open data, as stacked layers ---------------------------------------------
function DataLayers({ tr }) {
  const I = iso(19, 150, 150)
  const lbl = (z, text, sub) => {
    const [x, y] = I.p(8, 0, z)
    return (
      <g>
        <line x1={x + 4} y1={y} x2={x + 22} y2={y} stroke={LINE} />
        <text x={x + 26} y={y - 2} {...TXT}>{text}</text>
        <text x={x + 26} y={y + 11} {...TXT} fill="#9b948c" fontSize="9.5">{sub}</text>
      </g>
    )
  }
  const corners = [[0, 0], [8, 0], [8, 8], [0, 8]]
  return (
    <svg viewBox="0 0 470 330" role="img" aria-label={tr('Three data layers stacked over one city block', 'Tres capas de datos apiladas sobre una manzana')}>
      {corners.map(([x, y], i) => {
        const [x1, y1] = I.p(x, y, 0), [x2, y2] = I.p(x, y, 6)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={LINE} strokeDasharray="3 4" />
      })}
      {/* streets */}
      {I.tile(0, 0, 8, 8, 0, GROUND, { stroke: LINE })}
      {I.tile(0, 3.2, 8, 1.3, 0, ROAD)}
      {I.tile(3.2, 0, 1.3, 8, 0, ROAD)}
      {/* canopy */}
      {I.tile(0, 0, 8, 8, 3, 'rgba(111,174,122,0.10)', { stroke: '#4f8a5a' })}
      {[[1, 1.2], [1.8, 2], [6, 1], [6.7, 1.7], [1.2, 6.2], [5.6, 6.5], [6.6, 6], [2.2, 5.6]].map(([x, y], i) => <g key={i}>{I.disc(x, y, 0.55, 3, LEAF, { opacity: 0.9 })}</g>)}
      {/* buildings and places */}
      {I.tile(0, 0, 8, 8, 6, 'rgba(217,119,87,0.08)', { stroke: ACC })}
      {I.box(0.6, 0.6, 2, 1.8, 0.9, BUILD, 6, 'b1')}
      {I.box(5.2, 0.6, 1.4, 1.4, 1.8, TOWER, 6, 'b2')}
      {I.box(0.8, 5.3, 1.8, 2, 0.7, BUILD, 6, 'b3')}
      {I.box(5.3, 5.2, 2.2, 2.2, 0.5, ['#f3c9b8', '#d9a28c', '#b9826d'], 6, 'b4')}
      {lbl(6, tr('Buildings and places', 'Edificios y lugares'), 'OpenStreetMap')}
      {lbl(3, tr('Tree canopy', 'Copa de árboles'), 'ESA WorldCover · 10 m')}
      {lbl(0, tr('Streets and signals', 'Calles y semáforos'), 'OpenStreetMap → SUMO')}
    </svg>
  )
}

// ---- 2. the two twins ----------------------------------------------------------------
function Crossing({ I, cars, carColor, light }) {
  const items = [
    <g key="g">{I.tile(0, 0, 7, 7, 0, GROUND, { stroke: LINE })}</g>,
    <g key="r1">{I.tile(0, 2.7, 7, 1.6, 0, ROAD)}</g>,
    <g key="r2">{I.tile(2.7, 0, 1.6, 7, 0, ROAD)}</g>,
  ]
  // queue on the x road (approaching the centre from x = 0) and on the y road
  for (let i = 0; i < cars[0]; i++) items.push(I.box(2.1 - i * 0.75, 3.55, 0.55, 0.45, 0.32, carColor, 0, `a${i}`))
  for (let i = 0; i < cars[1]; i++) items.push(I.box(2.95, 2.0 - i * 0.75, 0.45, 0.55, 0.32, carColor, 0, `c${i}`))
  items.push(I.box(2.2, 2.2, 0.12, 0.12, 1.6, ['#888', '#666', '#555'], 0, 'pole'))
  const [lx, ly] = I.p(2.26, 2.26, 1.75)
  items.push(<circle key="l" cx={lx} cy={ly} r="5" fill={light} stroke="#111" />)
  return <g>{items}</g>
}

function Twins({ tr }) {
  const L = iso(17, 115, 60), R = iso(17, 335, 60)
  const cap = (x, a, b) => (
    <g>
      <text x={x} y={232} textAnchor="middle" {...TXT} fontSize="12" fill="#f5f1ec">{a}</text>
      <text x={x} y={248} textAnchor="middle" {...TXT} fill="#9b948c" fontSize="9.5">{b}</text>
    </g>
  )
  return (
    <svg viewBox="0 0 450 260" role="img" aria-label={tr('The same crossing twice: a long queue under fixed lights, a short one under AI control', 'El mismo cruce dos veces: cola larga con semáforos fijos y corta con la IA')}>
      <Crossing I={L} cars={[6, 4]} carColor={CAR} light="#e5534b" />
      <Crossing I={R} cars={[2, 1]} carColor={CAR_AI} light="#6fae7a" />
      <text x="225" y="120" textAnchor="middle" {...TXT} fontSize="18" fill={ACC}>vs</text>
      {cap(115, tr('Fixed-time lights', 'Semáforos fijos'), tr('40 s green, whatever the queue', '40 s de verde, haya cola o no'))}
      {cap(335, tr('Adaptive AI', 'IA adaptativa'), tr('reads every lane · bus priority', 'lee cada carril · prioridad al bus'))}
    </svg>
  )
}

// ---- 3. prediction from places and events ------------------------------------------
function Prediction({ tr }) {
  const I = iso(17, 235, 85)
  const flow = (from, to, key) => {
    const [x1, y1] = I.p(...from), [x2, y2] = I.p(...to)
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={ACC} strokeWidth="2" strokeDasharray="5 4" markerEnd="url(#arr)" />
  }
  // Labels sit beside their building, with a short leader line, not on top of it.
  const tag = (x, y, z, text, dx) => {
    const [px, py] = I.p(x, y, z)
    const tx = px + dx
    return (
      <g>
        <line x1={px} y1={py} x2={tx} y2={py - 8} stroke={LINE} />
        <text x={tx} y={py - 11} textAnchor={dx < 0 ? 'end' : 'start'} {...TXT} fontSize="10.5" fill="#f5f1ec">{text}</text>
      </g>
    )
  }
  const [sx, sy] = I.p(8.2, 7.2, 1.9)
  return (
    <svg viewBox="0 0 475 290" role="img" aria-label={tr('A school, offices and a stadium send car flows to one crossing; rain adds more', 'Un colegio, oficinas y un estadio envían flujos de autos a un cruce; la lluvia suma más')}>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill={ACC} />
        </marker>
      </defs>
      {I.tile(0, 0, 10, 9, 0, GROUND, { stroke: LINE })}
      {I.tile(0, 6.5, 10, 1.4, 0, ROAD)}
      {I.tile(7.5, 0, 1.4, 9, 0, ROAD)}
      {I.box(0.6, 0.6, 2.6, 2, 1.1, ['#f3d9a6', '#d9b77a', '#b8975d'], 0, 'school')}
      {I.box(4.2, 0.8, 1.5, 1.5, 4, TOWER, 0, 'office')}
      {I.box(0.6, 3.6, 3, 2.4, 0.7, ['#cfe3d2', '#9fc4a6', '#7ea586'], 0, 'stadium')}
      {I.tile(1.1, 4.1, 2, 1.4, 0.71, '#6fae7a')}
      {flow([2, 2.6, 0.3], [7.3, 6.4, 0.3], 'f1')}
      {flow([5, 2.3, 0.3], [7.4, 6.2, 0.3], 'f2')}
      {flow([3.6, 5, 0.3], [7.2, 6.8, 0.3], 'f3')}
      {I.box(8.9, 6.3, 0.12, 0.12, 1.7, ['#888', '#666', '#555'], 0, 'pole')}
      <circle cx={sx + 12} cy={sy - 2} r="5" fill="#f2c14e" stroke="#111" />
      {tag(0.6, 0.6, 1.1, tr('School 7:00 · 12:30', 'Colegio 7:00 · 12:30'), -14)}
      {tag(5.7, 0.8, 4, tr('Offices 8:00 · 17:00', 'Oficinas 8:00 · 17:00'), 16)}
      {tag(0.6, 4.8, 0.7, tr('Stadium · game day', 'Estadio · día de juego'), -14)}
      {/* rain */}
      <g transform="translate(390 105)">
        <ellipse cx="0" cy="0" rx="26" ry="13" fill="#b3c3d6" />
        <ellipse cx="-18" cy="5" rx="15" ry="10" fill="#b3c3d6" />
        <ellipse cx="18" cy="5" rx="15" ry="10" fill="#b3c3d6" />
        {[-20, -8, 4, 16].map((x) => <line key={x} x1={x} y1="18" x2={x - 5} y2="32" stroke="#8ea2ba" strokeWidth="2" />)}
        <text x="0" y="50" textAnchor="middle" {...TXT} fontSize="10">{tr('rain → more cars', 'lluvia → más autos')}</text>
      </g>
      <text x="360" y="262" textAnchor="middle" {...TXT} fontSize="10.5" fill={ACC}>{tr('busy crossing, 10 min ahead', 'cruce cargado, 10 min antes')}</text>
    </svg>
  )
}

// ---- 4. shade, bike lanes and trees -------------------------------------------------
function ShadeTrees({ tr }) {
  const I = iso(22, 205, 95)
  const shadow = (x, y, w, h) => (
    // A building's shadow on the street: its front edge pushed toward +y.
    <polygon points={[[x, y], [x + w, y], [x + w + h * 0.35, y + h * 0.75], [x + h * 0.35, y + h * 0.75]].map((q) => I.p(q[0], q[1], 0).join(',')).join(' ')}
             fill="rgba(0,0,0,0.38)" />
  )
  const tag = (x, y, z, text, color = '#f5f1ec') => {
    const [px, py] = I.p(x, y, z)
    return <text x={px} y={py} textAnchor="middle" {...TXT} fontSize="10.5" fill={color}>{text}</text>
  }
  const [sunx, suny] = [52, 48]
  return (
    <svg viewBox="0 0 450 330" role="img" aria-label={tr('A street with a bike lane, building shadows, existing trees and new trees to plant', 'Una calle con ciclovía, sombras de edificios, árboles existentes y árboles nuevos por plantar')}>
      <circle cx={sunx} cy={suny} r="16" fill="#f2c14e" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const r = (a * Math.PI) / 180
        return <line key={a} x1={sunx + Math.cos(r) * 21} y1={suny + Math.sin(r) * 21} x2={sunx + Math.cos(r) * 28} y2={suny + Math.sin(r) * 28} stroke="#f2c14e" strokeWidth="2" />
      })}
      {I.tile(0, 0, 10, 7.5, 0, GROUND, { stroke: LINE })}
      {I.tile(0, 2.6, 10, 2.4, 0, ROAD)}
      {I.tile(0, 5, 10, 0.7, 0, ACC, { opacity: 0.85 })}
      {I.tile(0, 5.7, 10, 1.1, 0, '#5a5e68')}
      {shadow(0.8, 2.3, 3, 3.6)}
      {shadow(5.6, 2.3, 2.4, 2.2)}
      {I.box(0.8, 0.3, 3, 2, 3.6, BUILD, 0, 'b1')}
      {I.box(5.6, 0.3, 2.4, 2, 2.2, BUILD, 0, 'b2')}
      {/* existing trees and their shade on the bike lane */}
      {I.disc(1.6, 5.6, 0.9, 0, 'rgba(0,0,0,0.35)')}
      {I.disc(6.1, 5.6, 0.9, 0, 'rgba(0,0,0,0.35)')}
      {tree(I, 1.4, 6.2, 1.4, 0.8, LEAF, 't1')}
      {tree(I, 5.9, 6.2, 1.4, 0.8, LEAF, 't2')}
      {/* new trees to plant */}
      {[3.7, 8.4].map((x) => <g key={x}>{I.disc(x, 6.2, 1.1, 0, 'none', { stroke: LEAF_NEW, strokeDasharray: '4 3', strokeWidth: 1.5 })}</g>)}
      {tree(I, 3.7, 6.2, 1.2, 0.65, LEAF_NEW, 'n1')}
      {tree(I, 8.4, 6.2, 1.2, 0.65, LEAF_NEW, 'n2')}
      {tag(10.6, 4.9, 0, tr('bike lane', 'ciclovía'), ACC)}
      {tag(6.2, 3.3, 0, tr('building shadow', 'sombra de edificio'))}
      {tag(8.4, 7.9, 0, tr('+ new tree', '+ árbol nuevo'), LEAF_NEW)}
      <text x="225" y="322" textAnchor="middle" {...TXT} fontSize="10" fill="#9b948c">
        {tr('sun position by date and hour · goal: 30% canopy per neighbourhood', 'sol según fecha y hora · meta: 30 % de copa por barrio')}
      </text>
    </svg>
  )
}

export default function IsoScenes() {
  const tr = useT()
  const scenes = [
    {
      n: 1, Fig: DataLayers,
      title: tr('Open data, nothing invented', 'Datos abiertos, nada inventado'),
      text: tr('Streets, buildings, schools, offices and malls come from OpenStreetMap; tree canopy from ESA WorldCover satellite imagery at 10 m; rain from Open-Meteo. Each layer is public and can be checked.',
               'Las calles, edificios, colegios, oficinas y centros comerciales salen de OpenStreetMap; la copa de los árboles, de las imágenes satelitales ESA WorldCover a 10 m; la lluvia, de Open-Meteo. Cada capa es pública y se puede verificar.'),
    },
    {
      n: 2, Fig: Twins,
      title: tr('Two twins, one difference', 'Dos gemelos, una sola diferencia'),
      text: tr('Two copies of the Distrito Nacional run in SUMO with the same cars at the same times. Only the signals differ: a fixed plan, or the AI, which reads the queue on every lane, gives buses priority and cuts a green nobody is using.',
               'Dos copias del Distrito Nacional corren en SUMO con los mismos autos a la misma hora. Solo cambian los semáforos: un plan fijo, o la IA, que lee la cola de cada carril, da prioridad al bus y corta el verde que nadie usa.'),
    },
    {
      n: 3, Fig: Prediction,
      title: tr('Predicting congestion from places', 'Predecir la congestión por lugares'),
      text: tr('The AI anticipates as well as reacts. Every school, office, mall, hospital and stadium generates trips at its opening and closing hours, and rain adds more. That forecast feeds the simulation and tells the controller which crossing will fill up before it does. Its effect on the result is still being measured.',
               'La IA no solo reacciona: anticipa. Cada colegio, oficina, mall, hospital y estadio genera viajes a sus horas de entrada y salida, y la lluvia suma más. Esa previsión alimenta la simulación y le dice al controlador qué cruce se va a llenar antes de que pase. Su efecto en el resultado todavía se está midiendo.'),
    },
    {
      n: 4, Fig: ShadeTrees,
      title: tr('Shade, bike lanes and trees', 'Sombra, ciclovías y árboles'),
      text: tr('The sun’s position and the shadow of every building and tree show which bike lanes stay in the sun. With canopy measured from space, we count the trees missing to reach 30% and where they fit, starting with the hottest, barest streets.',
               'La posición del sol y la sombra de cada edificio y árbol muestran qué ciclovías quedan al sol. Con la copa medida desde el satélite contamos cuántos árboles faltan para llegar al 30 % y dónde caben, empezando por las calles más calientes y desnudas.'),
    },
  ]
  return (
    <section className="iso-scenes" aria-label={tr('How it works, in four pictures', 'Cómo funciona, en cuatro imágenes')}>
      <h2 className="iso-title">{tr('How it works, in four pictures', 'Cómo funciona, en cuatro imágenes')}</h2>
      <ol className="iso-grid">
        {scenes.map(({ n, Fig, title, text }) => (
          <li className="iso-card glass" key={n}>
            <div className="iso-fig"><Fig tr={tr} /></div>
            <h3><span className="iso-n">{n}</span>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
