/**
 * Midtown Manhattan, isometric pixel-art card.
 *
 * NOT A MAP. The avenue grid, a setback tower with a spire, a slab tower, a
 * brownstone row with stoops, two yellow cabs and a mast-arm signal -- the
 * things that make a thumbnail read as Manhattan. Same ground slab and
 * projection as the other cards so the five sit in a row.
 *
 * One animation: the red aircraft-warning beacon on the spire, a slow blink.
 */
export default function Manhattan() {
  return (
    <svg className="try-art" viewBox="0 0 240 180" role="img"
         aria-label="Illustration of Midtown Manhattan: the avenue grid, a spired tower, brownstones and yellow cabs"
         shapeRendering="crispEdges">
      {/* ground slab */}
      <polygon points="120,22 232,78 120,134 8,78" fill="#e9e3d6" />
      <polygon points="8,78 120,134 120,152 8,96" fill="#7a5a3c" />
      <polygon points="120,134 232,78 232,96 120,152" fill="#5e4430" />
      <polygon points="8,96 120,152 120,156 8,100" fill="#4a3526" />
      <polygon points="120,152 232,96 232,100 120,156" fill="#3b2a1e" />

      {/* the grid: two avenues, two cross streets */}
      <polygon points="88,38 100,38 176,114 164,114" fill="#6e7078" />
      <polygon points="128,38 140,38 216,114 204,114" fill="#6e7078" />
      <polygon points="40,66 52,66 132,126 120,126" fill="#6e7078" />
      <polygon points="70,50 82,50 162,110 150,110" fill="#6e7078" />
      {/* lane dashes down one avenue */}
      <g fill="#c9c3b4">
        <rect x="96" y="46" width="2" height="4" transform="skewX(45)" />
        <rect x="108" y="58" width="2" height="4" transform="skewX(45)" />
        <rect x="120" y="70" width="2" height="4" transform="skewX(45)" />
        <rect x="132" y="82" width="2" height="4" transform="skewX(45)" />
      </g>

      {/* setback tower with spire, far corner */}
      <polygon points="150,40 170,30 190,40 190,78 170,88 150,78" fill="#cfd3d9" />
      <polygon points="170,30 190,40 190,78 170,88" fill="#aab0b8" />
      <polygon points="158,26 170,20 182,26 182,42 170,48 158,42" fill="#dcdfe4" />
      <polygon points="170,20 182,26 182,42 170,48" fill="#b8bdc5" />
      <rect x="169" y="4" width="2" height="18" fill="#9aa0a8" />
      <rect x="168" y="2" width="4" height="3" fill="#7c828a" />
      <circle className="try-beacon" cx="170" cy="2" r="1.6" fill="#ff4d3d" />
      <g fill="#4a5262">
        <rect x="154" y="48" width="3" height="4" /><rect x="160" y="48" width="3" height="4" />
        <rect x="154" y="58" width="3" height="4" /><rect x="160" y="58" width="3" height="4" />
        <rect x="154" y="68" width="3" height="4" /><rect x="160" y="68" width="3" height="4" />
        <rect x="162" y="30" width="3" height="3" /><rect x="162" y="36" width="3" height="3" />
      </g>

      {/* slab tower beside it */}
      <polygon points="196,44 212,36 228,44 228,86 212,94 196,86" fill="#5c6f8a" />
      <polygon points="212,36 228,44 228,86 212,94" fill="#45536a" />
      <g fill="#a9c4e6">
        <rect x="200" y="50" width="3" height="3" /><rect x="206" y="50" width="3" height="3" />
        <rect x="200" y="58" width="3" height="3" /><rect x="206" y="58" width="3" height="3" />
        <rect x="200" y="66" width="3" height="3" /><rect x="206" y="66" width="3" height="3" />
        <rect x="200" y="74" width="3" height="3" /><rect x="206" y="74" width="3" height="3" />
      </g>

      {/* brownstone row with stoops, near corner */}
      <polygon points="18,70 40,59 62,70 62,96 40,107 18,96" fill="#a86a4a" />
      <polygon points="40,59 62,70 62,96 40,107" fill="#8a5439" />
      <polygon points="30,64 52,53 74,64 74,90 52,101 30,90" fill="#b5754f" />
      <polygon points="52,53 74,64 74,90 52,101" fill="#93593c" />
      <g fill="#f0e2c8">
        <rect x="22" y="76" width="3" height="4" /><rect x="22" y="84" width="3" height="4" />
        <rect x="34" y="72" width="3" height="4" /><rect x="34" y="80" width="3" height="4" />
      </g>
      <rect x="44" y="100" width="6" height="3" fill="#7a5a3c" />
      <rect x="46" y="97" width="4" height="3" fill="#8f6c49" />

      {/* small park square with a tree */}
      <polygon points="96,98 112,90 128,98 112,106" fill="#7fb27a" />
      <rect x="111" y="92" width="2" height="6" fill="#6b4a2e" />
      <circle cx="112" cy="90" r="5" fill="#5f9f5c" />

      {/* mast-arm signal over the avenue */}
      <rect x="140" y="92" width="2" height="16" fill="#3b3f46" />
      <rect x="128" y="92" width="14" height="2" fill="#3b3f46" />
      <rect x="129" y="94" width="3" height="7" fill="#2a2e34" />
      <rect x="130" y="95" width="1" height="1" fill="#e53935" />
      <rect x="130" y="97" width="1" height="1" fill="#6b6f00" />
      <rect x="130" y="99" width="1" height="1" fill="#3fb34f" />

      {/* two yellow cabs and a delivery van */}
      <rect x="104" y="60" width="10" height="5" fill="#f2c230" />
      <rect x="106" y="58" width="6" height="2" fill="#3d4a57" />
      <rect x="166" y="100" width="10" height="5" fill="#f2c230" />
      <rect x="168" y="98" width="6" height="2" fill="#3d4a57" />
      <rect x="76" y="84" width="12" height="6" fill="#f3efe6" />
      <rect x="78" y="82" width="4" height="2" fill="#3d4a57" />

      {/* people at the corners */}
      <rect x="92" y="78" width="2" height="4" fill="#2c3440" /><rect x="92" y="76" width="2" height="2" fill="#e8b89a" />
      <rect x="146" y="118" width="2" height="4" fill="#d84a3a" /><rect x="146" y="116" width="2" height="2" fill="#e8b89a" />
      <rect x="120" y="112" width="2" height="4" fill="#4a7fb0" /><rect x="120" y="110" width="2" height="2" fill="#e8b89a" />
      <rect x="66" y="108" width="2" height="4" fill="#2c3440" /><rect x="66" y="106" width="2" height="2" fill="#e8b89a" />
    </svg>
  )
}
