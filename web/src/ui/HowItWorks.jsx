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
    title: 'Real streets',
    body: 'Every street, lane, one-way and traffic light comes from the city\'s real map. Nothing here is invented.',
    tag: 'OpenStreetMap',
  },
  {
    n: '02',
    title: 'Two identical twins',
    body: 'Same city, same traffic, same random seed. The only difference between them is who controls the traffic lights.',
    tag: 'SUMO',
  },
  {
    n: '03',
    title: 'The AI distributes green',
    body: 'It reads each junction\'s queue and moves seconds from the empty direction to the full one. The difference between twins is the measurement.',
    tag: 'Orchestrator',
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

export default function HowItWorks({ onOpen }) {
  return (
    <section className="hiw" aria-label="How it works, in three steps">
      {/* The band is the preview; the full section is the complete version. Link to it
          to avoid having two things with the same name and no relationship between them. */}
      <button className="hiw-label" onClick={onOpen} title="See the full explanation">
        How it works ↗
      </button>
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
