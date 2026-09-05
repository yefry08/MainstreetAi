/**
 * The waiting state: a working traffic light, not a spinner.
 *
 * The wait here is genuinely long -- an Overpass query for a dense city centre
 * can take twenty seconds on a busy mirror, and there is a model call after
 * it. A bare spinner over that reads as a hang, so the light cycles on a real
 * timer and the step text says which of the four stages is running and which
 * are done.
 *
 * The stage list is the honest one: it names the model call and the
 * OpenStreetMap download separately, because they fail for different reasons
 * and a visitor who sees which stage stalled can act on it.
 */
export default function TrafficLoader({ stage, steps, detail, error, onRetry, onCancel }) {
  const idx = steps.findIndex((s) => s.key === stage)

  return (
    <div className="tl">
      <div className={`tl-light ${error ? 'fault' : ''}`}>
        <span className="tl-lamp red" />
        <span className="tl-lamp amber" />
        <span className="tl-lamp green" />
        <span className="tl-pole" />
      </div>

      <ol className="tl-steps">
        {steps.map((s, i) => {
          const state = error && i === idx ? 'fault'
            : i < idx ? 'done' : i === idx ? 'active' : 'todo'
          return (
            <li key={s.key} className={`tl-step ${state}`}>
              <i />
              <span>{s.label}</span>
            </li>
          )
        })}
      </ol>

      {detail && !error && <p className="tl-detail">{detail}</p>}

      {error && (
        <div className="tl-error">
          <p>{error}</p>
          <div className="tl-actions">
            {onRetry && <button className="tl-btn primary" onClick={onRetry}>Reintentar</button>}
            {onCancel && <button className="tl-btn" onClick={onCancel}>Empezar de nuevo</button>}
          </div>
        </div>
      )}
    </div>
  )
}
