/**
 * Shibuya, as an isometric pixel-art card.
 *
 * NOT A MAP. This is an illustration of a district's character -- the scramble
 * crossing, the 109 tower, Hachiko, a Yamanote-green station roof -- drawn to
 * read as Shibuya at thumbnail size. Nothing here is georeferenced, nothing is
 * simulated, and the card says so with a badge. It replaces an attempt to put a
 * live map in this slot, which could not be made to work reliably.
 *
 * Hand-authored SVG rather than a generated PNG: ~5 KB, sharp at any DPI,
 * recolourable from the design tokens, and the two animations (a neon flicker
 * and a drifting cloud) cost nothing and stop under prefers-reduced-motion.
 *
 * Isometric grid: 2:1 diamond, the reference's projection. shape-rendering
 * crispEdges keeps the stepped outlines hard instead of anti-aliased to mush.
 */
export default function Shibuya() {
  return (
    <svg className="try-art" viewBox="0 0 240 180" role="img"
         aria-label="Illustration of Shibuya: the scramble crossing, the 109 tower and Hachiko"
         shapeRendering="crispEdges">
      {/* ground slab: top face, then the earth sides */}
      <polygon points="120,22 232,78 120,134 8,78" fill="#e9e3d6" />
      <polygon points="8,78 120,134 120,152 8,96" fill="#7a5a3c" />
      <polygon points="120,134 232,78 232,96 120,152" fill="#5e4430" />
      <polygon points="8,96 120,152 120,156 8,100" fill="#4a3526" />
      <polygon points="120,152 232,96 232,100 120,156" fill="#3b2a1e" />

      {/* two roads meeting at the scramble */}
      <polygon points="96,34 144,34 200,90 152,90" fill="#6e7078" />
      <polygon points="40,66 88,66 168,122 120,122" fill="#6e7078" />
      <polygon points="88,66 152,90 168,122 120,122" fill="#5f6169" />

      {/* zebra stripes: four legs, plus the diagonals that make it a scramble */}
      <g fill="#f3efe6">
        <rect x="104" y="40" width="6" height="14" transform="skewX(45)" />
        <rect x="114" y="40" width="6" height="14" transform="skewX(45)" />
        <rect x="124" y="40" width="6" height="14" transform="skewX(45)" />
        <rect x="46" y="70" width="6" height="12" transform="skewX(45)" />
        <rect x="56" y="70" width="6" height="12" transform="skewX(45)" />
        <rect x="66" y="70" width="6" height="12" transform="skewX(45)" />
        <rect x="158" y="96" width="6" height="14" transform="skewX(45)" />
        <rect x="168" y="96" width="6" height="14" transform="skewX(45)" />
        <rect x="178" y="96" width="6" height="14" transform="skewX(45)" />
        <rect x="100" y="106" width="6" height="10" transform="skewX(45)" />
        <rect x="110" y="106" width="6" height="10" transform="skewX(45)" />
        <rect x="120" y="106" width="6" height="10" transform="skewX(45)" />
        <polygon points="118,78 124,78 140,96 134,96" />
        <polygon points="130,78 136,78 152,96 146,96" />
      </g>

      {/* station: low and long, Yamanote-green roof */}
      <polygon points="14,60 44,45 74,60 44,75" fill="#cfc7b8" />
      <polygon points="14,60 44,75 44,92 14,77" fill="#b7ae9e" />
      <polygon points="44,75 74,60 74,77 44,92" fill="#9d9485" />
      <polygon points="14,58 44,43 74,58 44,73" fill="#6fb37b" />
      <rect x="20" y="70" width="4" height="6" fill="#3b4a5a" />
      <rect x="28" y="74" width="4" height="6" fill="#3b4a5a" />
      <rect x="36" y="78" width="4" height="6" fill="#3b4a5a" />

      {/* 109: the cylinder tower, as a stepped prism with its red band */}
      <polygon points="176,26 194,18 212,26 212,74 194,82 176,74" fill="#c9ccd2" />
      <polygon points="194,18 212,26 212,74 194,82" fill="#a8acb4" />
      <rect x="176" y="40" width="36" height="7" fill="#d84a3a" />
      <text x="194" y="46" fontSize="6" fontFamily="monospace" fontWeight="700"
            textAnchor="middle" fill="#fff5ef">109</text>
      <g fill="#5b6270">
        <rect x="180" y="30" width="3" height="4" /><rect x="186" y="30" width="3" height="4" />
        <rect x="180" y="52" width="3" height="4" /><rect x="186" y="52" width="3" height="4" />
        <rect x="180" y="60" width="3" height="4" /><rect x="186" y="60" width="3" height="4" />
        <rect x="180" y="68" width="3" height="4" /><rect x="186" y="68" width="3" height="4" />
      </g>

      {/* the big screen, with its neon flicker */}
      <polygon points="150,30 176,20 176,46 150,56" fill="#1a1f2b" />
      <polygon className="try-neon" points="153,33 173,24 173,44 153,53" fill="#48d6e8" />
      <polygon points="150,56 176,46 176,64 150,74" fill="#2b3140" />

      {/* mid-rise block behind the crossing */}
      <polygon points="120,10 146,0 168,12 168,40 146,50 120,40" fill="#d9d2c3" />
      <polygon points="146,0 168,12 168,40 146,50" fill="#b3ab9b" />
      <g fill="#4a5262">
        <rect x="126" y="16" width="3" height="4" /><rect x="132" y="14" width="3" height="4" />
        <rect x="126" y="26" width="3" height="4" /><rect x="132" y="24" width="3" height="4" />
        <rect x="126" y="34" width="3" height="4" /><rect x="132" y="32" width="3" height="4" />
      </g>

      {/* Hachiko on his plinth, station side */}
      <rect x="86" y="90" width="8" height="5" fill="#8c8578" />
      <rect x="88" y="85" width="4" height="5" fill="#8a5a2b" />
      <rect x="91" y="84" width="2" height="2" fill="#8a5a2b" />

      {/* trees */}
      <rect x="60" y="100" width="2" height="6" fill="#6b4a2e" />
      <circle cx="61" cy="98" r="5" fill="#5f9f5c" />
      <rect x="204" y="86" width="2" height="6" fill="#6b4a2e" />
      <circle cx="205" cy="84" r="5" fill="#5f9f5c" />

      {/* two cars, one waiting at the scramble */}
      <rect x="70" y="80" width="10" height="5" fill="#d97757" />
      <rect x="72" y="78" width="6" height="2" fill="#3d4a57" />
      <rect x="150" y="104" width="10" height="5" fill="#f3efe6" />
      <rect x="152" y="102" width="6" height="2" fill="#3d4a57" />

      {/* the crowd: two-tone figures mid-crossing */}
      <rect x="118" y="84" width="2" height="4" fill="#2c3440" /><rect x="118" y="82" width="2" height="2" fill="#e8b89a" />
      <rect x="126" y="88" width="2" height="4" fill="#d84a3a" /><rect x="126" y="86" width="2" height="2" fill="#e8b89a" />
      <rect x="134" y="82" width="2" height="4" fill="#2c3440" /><rect x="134" y="80" width="2" height="2" fill="#e8b89a" />
      <rect x="142" y="92" width="2" height="4" fill="#4a7fb0" /><rect x="142" y="90" width="2" height="2" fill="#e8b89a" />
      <rect x="112" y="96" width="2" height="4" fill="#6fb37b" /><rect x="112" y="94" width="2" height="2" fill="#e8b89a" />
      <rect x="130" y="98" width="2" height="4" fill="#2c3440" /><rect x="130" y="96" width="2" height="2" fill="#e8b89a" />
      <rect x="106" y="74" width="2" height="4" fill="#d97757" /><rect x="106" y="72" width="2" height="2" fill="#e8b89a" />

      {/* one slow cloud */}
      <g className="try-cloud" fill="#ffffff" opacity="0.9">
        <rect x="30" y="18" width="16" height="5" />
        <rect x="34" y="14" width="8" height="4" />
      </g>
    </svg>
  )
}
