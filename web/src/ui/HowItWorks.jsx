/**
 * "Cómo funciona": the three steps, on an endless horizontal loop.
 *
 * WHY A MARQUEE AND NOT A STATIC ROW
 * Home is a full-bleed simulation with no explanation on it. A visitor sees a
 * city moving and no statement of what they are looking at. Three static cards
 * would need room the scene does not have; a slim band that carries them past
 * gives the same three sentences in a sixth of the height.
 *
 * HOW THE LOOP IS SEAMLESS
 * The list is rendered twice and the track is translated by exactly -50%. At
 * the end of the animation the second copy sits precisely where the first
 * started, so the restart is invisible. Any other width -- a pixel value, a
 * viewport unit -- drifts as soon as the text or the font metrics change, and
 * the seam becomes a visible jump every cycle.
 *
 * The duplicate is aria-hidden. It is the same three sentences, and a screen
 * reader announcing them twice is worse than not having the band at all.
 * Hovering pauses it, because text that will not hold still cannot be read.
 */

const STEPS = [
  {
    n: '01',
    title: 'Calles reales',
    body: 'Cada calle, carril, sentido único y semáforo sale del mapa real de la ciudad. Nada de esto está inventado.',
    tag: 'OpenStreetMap',
  },
  {
    n: '02',
    title: 'Dos gemelos idénticos',
    body: 'La misma ciudad, el mismo tráfico, la misma semilla. Lo único que cambia entre los dos es quién controla los semáforos.',
    tag: 'SUMO',
  },
  {
    n: '03',
    title: 'La IA reparte el verde',
    body: 'Lee la cola de cada cruce y mueve segundos de la dirección vacía a la que está llena. La diferencia entre gemelos es la medida.',
    tag: 'Orquestador',
  },
]

function Track({ hidden }) {
  return (
    <ul className="hiw-track" aria-hidden={hidden || undefined}>
      {STEPS.map((s) => (
        <li className="hiw-step" key={s.n}>
          <span className="hiw-n">{s.n}</span>
          <span className="hiw-body">
            <b>{s.title}</b>
            <span>{s.body}</span>
          </span>
          <span className="hiw-tag">{s.tag}</span>
        </li>
      ))}
    </ul>
  )
}

export default function HowItWorks() {
  return (
    <section className="hiw" aria-label="Cómo funciona, en tres pasos">
      <span className="hiw-label">Cómo funciona</span>
      <div className="hiw-viewport">
        <div className="hiw-rail">
          <Track />
          {/* The second copy exists only to make the wrap seamless. */}
          <Track hidden />
        </div>
      </div>
    </section>
  )
}
