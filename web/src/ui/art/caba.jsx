/**
 * Buenos Aires, Microcentro, isometric pixel-art card.
 *
 * NOT A MAP. The Obelisco on a very wide avenue with a planted median, low
 * European-style blocks with balconies, a colectivo, a kiosco and two
 * jacarandas in flower. Same slab and projection as the other cards.
 *
 * One animation: the drifting cloud shared with the Shibuya card.
 */
export default function Caba() {
  return (
    <svg className="try-art" viewBox="0 0 240 180" role="img"
         aria-label="Illustration of central Buenos Aires: the Obelisco on a wide avenue, balconied blocks, a colectivo and jacarandas"
         shapeRendering="crispEdges">
      {/* ground slab */}
      <polygon points="120,22 232,78 120,134 8,78" fill="#e9e3d6" />
      <polygon points="8,78 120,134 120,152 8,96" fill="#7a5a3c" />
      <polygon points="120,134 232,78 232,96 120,152" fill="#5e4430" />
      <polygon points="8,96 120,152 120,156 8,100" fill="#4a3526" />
      <polygon points="120,152 232,96 232,100 120,156" fill="#3b2a1e" />

      {/* the wide avenue: two carriageways and a planted median */}
      <polygon points="60,52 84,52 176,122 152,122" fill="#6e7078" />
      <polygon points="84,52 96,52 188,122 176,122" fill="#7fb27a" />
      <polygon points="96,52 120,52 212,122 188,122" fill="#6e7078" />
      {/* a cross street */}
      <polygon points="120,38 132,38 172,74 160,74" fill="#6e7078" />
      <g fill="#c9c3b4">
        <rect x="70" y="60" width="2" height="4" transform="skewX(45)" />
        <rect x="84" y="74" width="2" height="4" transform="skewX(45)" />
        <rect x="98" y="88" width="2" height="4" transform="skewX(45)" />
        <rect x="112" y="102" width="2" height="4" transform="skewX(45)" />
      </g>

      {/* the Obelisco: a tall tapering pillar on the median with a stepped base */}
      <polygon points="126,104 146,94 152,97 132,107" fill="#c7c1b2" />
      <polygon points="132,100 144,94 144,98 132,104" fill="#aaa393" />
      <polygon points="134,22 140,20 142,96 132,98" fill="#e6e0d1" />
      <polygon points="140,20 142,21 144,96 142,96" fill="#c2bcad" />
      <polygon points="134,22 140,20 142,21 137,14" fill="#f2ede0" />

      {/* balconied blocks, far side */}
      <polygon points="150,30 172,19 194,30 194,68 172,79 150,68" fill="#e3d5c1" />
      <polygon points="172,19 194,30 194,68 172,79" fill="#c4b39b" />
      <g fill="#7a5a3c">
        <rect x="154" y="38" width="12" height="1" /><rect x="154" y="48" width="12" height="1" />
        <rect x="154" y="58" width="12" height="1" />
      </g>
      <g fill="#4a5262">
        <rect x="156" y="33" width="3" height="4" /><rect x="162" y="33" width="3" height="4" />
        <rect x="156" y="43" width="3" height="4" /><rect x="162" y="43" width="3" height="4" />
        <rect x="156" y="53" width="3" height="4" /><rect x="162" y="53" width="3" height="4" />
      </g>
      <polygon points="196,46 214,37 232,46 232,74 214,83 196,74" fill="#d9c8ae" />
      <polygon points="214,37 232,46 232,74 214,83" fill="#b9a68b" />
      <g fill="#4a5262">
        <rect x="200" y="52" width="3" height="4" /><rect x="206" y="52" width="3" height="4" />
        <rect x="200" y="62" width="3" height="4" /><rect x="206" y="62" width="3" height="4" />
      </g>

      {/* near-side block with a corner cafe awning */}
      <polygon points="18,66 42,54 66,66 66,96 42,108 18,96" fill="#e8dcc6" />
      <polygon points="42,54 66,66 66,96 42,108" fill="#c9bba0" />
      <g fill="#4a5262">
        <rect x="22" y="74" width="3" height="4" /><rect x="30" y="70" width="3" height="4" />
        <rect x="22" y="84" width="3" height="4" /><rect x="30" y="80" width="3" height="4" />
      </g>
      <polygon points="42,100 66,88 66,92 42,104" fill="#d84a3a" />

      {/* kiosco on the corner */}
      <rect x="70" y="112" width="10" height="7" fill="#3f8f6b" />
      <rect x="69" y="110" width="12" height="2" fill="#2f6f53" />
      <rect x="73" y="114" width="4" height="3" fill="#f2c230" />

      {/* two jacarandas in flower */}
      <rect x="92" y="112" width="2" height="6" fill="#6b4a2e" />
      <circle cx="93" cy="110" r="6" fill="#9b7fd1" />
      <rect x="112" y="122" width="2" height="6" fill="#6b4a2e" />
      <circle cx="113" cy="120" r="6" fill="#9b7fd1" />
      <rect x="200" y="92" width="2" height="6" fill="#6b4a2e" />
      <circle cx="201" cy="90" r="5" fill="#5f9f5c" />

      {/* a colectivo and a car */}
      <rect x="100" y="76" width="16" height="7" fill="#e0342b" />
      <rect x="100" y="76" width="16" height="2" fill="#f3efe6" />
      <rect x="102" y="79" width="3" height="2" fill="#3d4a57" /><rect x="107" y="79" width="3" height="2" fill="#3d4a57" />
      <rect x="112" y="79" width="3" height="2" fill="#3d4a57" />
      <rect x="164" y="104" width="10" height="5" fill="#f3efe6" />
      <rect x="166" y="102" width="6" height="2" fill="#3d4a57" />

      {/* people */}
      <rect x="86" y="96" width="2" height="4" fill="#2c3440" /><rect x="86" y="94" width="2" height="2" fill="#e8b89a" />
      <rect x="128" y="112" width="2" height="4" fill="#4a7fb0" /><rect x="128" y="110" width="2" height="2" fill="#e8b89a" />
      <rect x="184" y="90" width="2" height="4" fill="#d84a3a" /><rect x="184" y="88" width="2" height="2" fill="#e8b89a" />
      <rect x="60" y="118" width="2" height="4" fill="#2c3440" /><rect x="60" y="116" width="2" height="2" fill="#e8b89a" />

      {/* one slow cloud */}
      <g className="try-cloud" fill="#ffffff" opacity="0.9">
        <rect x="20" y="16" width="16" height="5" />
        <rect x="24" y="12" width="8" height="4" />
      </g>
    </svg>
  )
}
