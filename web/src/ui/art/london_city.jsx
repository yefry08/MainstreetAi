/**
 * Central London, isometric pixel-art card.
 *
 * NOT A MAP. The Elizabeth Tower clock face beside a long Gothic block, a
 * red phone box, a red double-decker, a black cab, a plane tree and a strip of
 * river along one edge of the slab. Same slab and projection as the others.
 *
 * One animation: the drifting cloud shared with the other cards.
 */
export default function LondonCity() {
  return (
    <svg className="try-art" viewBox="0 0 240 180" role="img"
         aria-label="Illustration of central London: the clock tower, a red phone box, a double-decker and a black cab"
         shapeRendering="crispEdges">
      {/* ground slab */}
      <polygon points="120,22 232,78 120,134 8,78" fill="#e9e3d6" />
      <polygon points="8,78 120,134 120,152 8,96" fill="#7a5a3c" />
      <polygon points="120,134 232,78 232,96 120,152" fill="#5e4430" />
      <polygon points="8,96 120,152 120,156 8,100" fill="#4a3526" />
      <polygon points="120,152 232,96 232,100 120,156" fill="#3b2a1e" />

      {/* the river along the far-right edge, with an embankment */}
      <polygon points="150,37 232,78 232,96 150,55" fill="#6fa3c7" />
      <polygon points="146,35 232,78 232,80 146,37" fill="#b9b1a0" />
      <rect x="196" y="66" width="10" height="3" fill="#5c8fb3" />

      {/* roads: one long, one across */}
      <polygon points="52,60 64,60 152,126 140,126" fill="#6e7078" />
      <polygon points="96,40 108,40 160,80 148,80" fill="#6e7078" />
      <g fill="#c9c3b4">
        <rect x="62" y="68" width="2" height="4" transform="skewX(45)" />
        <rect x="76" y="82" width="2" height="4" transform="skewX(45)" />
        <rect x="90" y="96" width="2" height="4" transform="skewX(45)" />
        <rect x="104" y="110" width="2" height="4" transform="skewX(45)" />
      </g>

      {/* the clock tower */}
      <polygon points="112,18 124,12 136,18 136,74 124,80 112,74" fill="#d7c9a6" />
      <polygon points="124,12 136,18 136,74 124,80" fill="#b39f78" />
      <polygon points="112,18 124,12 136,18 124,24" fill="#c4b48f" />
      <polygon points="118,4 124,1 130,4 124,13" fill="#4a5a44" />
      <polygon points="124,1 130,4 124,13" fill="#3a4736" />
      {/* clock face, near side */}
      <rect x="114" y="28" width="9" height="9" fill="#f2ede0" />
      <rect x="118" y="30" width="1" height="4" fill="#2c3440" />
      <rect x="118" y="32" width="3" height="1" fill="#2c3440" />
      <g fill="#8a7b5a">
        <rect x="115" y="44" width="2" height="5" /><rect x="119" y="44" width="2" height="5" />
        <rect x="115" y="56" width="2" height="5" /><rect x="119" y="56" width="2" height="5" />
      </g>

      {/* the long Gothic block beside it */}
      <polygon points="136,40 176,20 216,40 216,60 176,80 136,60" fill="#d7c9a6" />
      <polygon points="176,20 216,40 216,60 176,80" fill="#b39f78" />
      <g fill="#8a7b5a">
        <rect x="142" y="46" width="2" height="6" /><rect x="150" y="42" width="2" height="6" />
        <rect x="158" y="38" width="2" height="6" /><rect x="166" y="34" width="2" height="6" />
      </g>
      <g fill="#c4b48f">
        <rect x="140" y="38" width="2" height="4" /><rect x="152" y="32" width="2" height="4" />
        <rect x="164" y="26" width="2" height="4" /><rect x="176" y="18" width="2" height="4" />
      </g>

      {/* Georgian terrace, near corner */}
      <polygon points="16,66 42,53 68,66 68,92 42,105 16,92" fill="#cfc2ad" />
      <polygon points="42,53 68,66 68,92 42,105" fill="#ad9f88" />
      <g fill="#2c3440">
        <rect x="20" y="72" width="3" height="5" /><rect x="28" y="68" width="3" height="5" />
        <rect x="36" y="64" width="3" height="5" />
        <rect x="20" y="82" width="3" height="5" /><rect x="28" y="78" width="3" height="5" />
        <rect x="36" y="74" width="3" height="5" />
      </g>
      <rect x="44" y="96" width="4" height="7" fill="#1f2a44" />

      {/* red phone box */}
      <rect x="78" y="104" width="6" height="10" fill="#d0292a" />
      <rect x="77" y="103" width="8" height="2" fill="#a11f20" />
      <rect x="80" y="107" width="2" height="4" fill="#f2ede0" />

      {/* plane tree */}
      <rect x="96" y="120" width="2" height="7" fill="#6b4a2e" />
      <circle cx="97" cy="117" r="6" fill="#5f9f5c" />

      {/* double-decker and a black cab */}
      <rect x="90" y="86" width="16" height="9" fill="#d0292a" />
      <rect x="92" y="87" width="3" height="2" fill="#f3efe6" /><rect x="97" y="87" width="3" height="2" fill="#f3efe6" />
      <rect x="102" y="87" width="3" height="2" fill="#f3efe6" />
      <rect x="92" y="91" width="3" height="2" fill="#f3efe6" /><rect x="97" y="91" width="3" height="2" fill="#f3efe6" />
      <rect x="102" y="91" width="3" height="2" fill="#f3efe6" />
      <rect x="124" y="108" width="10" height="5" fill="#1f2226" />
      <rect x="126" y="106" width="6" height="2" fill="#3d4a57" />

      {/* people */}
      <rect x="70" y="98" width="2" height="4" fill="#2c3440" /><rect x="70" y="96" width="2" height="2" fill="#e8b89a" />
      <rect x="112" y="118" width="2" height="4" fill="#d84a3a" /><rect x="112" y="116" width="2" height="2" fill="#e8b89a" />
      <rect x="140" y="98" width="2" height="4" fill="#4a7fb0" /><rect x="140" y="96" width="2" height="2" fill="#e8b89a" />

      {/* one slow cloud */}
      <g className="try-cloud" fill="#ffffff" opacity="0.9">
        <rect x="26" y="20" width="16" height="5" />
        <rect x="30" y="16" width="8" height="4" />
      </g>
    </svg>
  )
}
