/**
 * Research: how the project works, in four isometric pictures, and the
 * agent-simulation work it takes inspiration from.
 *
 * WHAT THIS SECTION CLAIMS, AND WHAT IT MUST NOT
 * Every precedent card is cited as PRECEDENT -- evidence that large-scale AI
 * agent simulation is an active, validated research field. None of it is used
 * by this project. MainstreetAi runs SUMO with a rule-based adaptive
 * controller; it shares no code, no models and no architecture with anything
 * below. The framing is stated once at the top, and each card carries its own
 * "why it is here" rather than a bare citation.
 *
 * LINKS
 * Only URLs that are actually known appear here. Everything else carries an
 * explicit placeholder: a plausible-looking wrong link is worse than a visibly
 * missing one.
 *
 * The earlier pipeline figure was a PNG with English text and Barcelona
 * numbers; on this Latin American, Spanish-first site it is replaced by the
 * isometric scenes (IsoScenes.jsx), whose labels translate.
 */

import { useT } from '../i18n'
import IsoScenes from './IsoScenes.jsx'

const precedents = (tr) => [
  {
    name: 'Simile',
    kind: tr('Platform', 'Plataforma'),
    what: tr('An AI-powered human population simulation platform for market research and social science, validated weekly against thousands of real-world evaluations.',
             'Una plataforma de simulación de poblaciones humanas con IA para estudios de mercado y ciencias sociales, validada cada semana contra miles de evaluaciones reales.'),
    why: tr('A success case for AI agent simulation at scale, held to continuous real-world validation rather than to a benchmark alone.',
            'Un caso de éxito de simulación con agentes de IA a gran escala, sometido a validación continua con el mundo real y no solo a un benchmark.'),
    href: 'https://www.simile.com',
  },
  {
    name: 'MAWM — Multilingual Agent-based World Modeling',
    kind: tr('Research framework · COLM 2026', 'Marco de investigación · COLM 2026'),
    what: tr('Simulates multilingual societies with generative agents to study opinion dynamics and how information diffuses across cultures.',
             'Simula sociedades multilingües con agentes generativos para estudiar la dinámica de opiniones y cómo se difunde la información entre culturas.'),
    why: tr('World-modeling with AI agents pointed at a complex social phenomenon, where the behaviour of interest emerges from the population rather than being scripted.',
            'Modelado del mundo con agentes de IA aplicado a un fenómeno social complejo, donde el comportamiento que interesa surge de la población en vez de estar programado.'),
    href: null,
  },
  {
    name: 'MicroVerse / MatrAIx',
    kind: tr('Experiment', 'Experimento'),
    what: tr('Measures "identity drift" in AI agents across long-running simulations under resource scarcity.',
             'Mide la "deriva de identidad" de agentes de IA en simulaciones largas con escasez de recursos.'),
    why: tr('The one on this list that is a caution rather than an encouragement. Anything orchestrating a city runs continuously for days, and an autonomous agent that drifts over time is a failure mode a traffic controller cannot afford.',
            'El de esta lista que es una advertencia y no un estímulo. Lo que orquesta una ciudad funciona días sin parar, y un agente autónomo que deriva con el tiempo es un fallo que un controlador de tráfico no se puede permitir.'),
    href: null,
  },
  {
    name: tr('Generative agent societies', 'Sociedades de agentes generativos'),
    kind: tr('Research lineage', 'Línea de investigación'),
    what: tr('Stanford’s Generative Agents ("Smallville") and the body of work since on simulating societies with language models.',
             'Generative Agents de Stanford ("Smallville") y el trabajo posterior sobre simular sociedades con modelos de lenguaje.'),
    why: tr('The lineage that made it credible to model a complex urban system with agents at all, rather than only with equations.',
            'La línea que hizo creíble modelar un sistema urbano complejo con agentes, y no solo con ecuaciones.'),
    href: 'https://arxiv.org/abs/2304.03442',
  },
]

export default function Research() {
  const tr = useT()
  return (
    <section className="research">
      <header className="research-head">
        <p className="research-eyebrow">{tr('Research', 'Investigación')}</p>
        <h1>{tr('Precedent, not architecture', 'Precedentes, no arquitectura')}</h1>
        <p className="research-lede">
          {tr('How MainstreetAi works, and the work showing that large-scale AI agent simulation is an active, validated field. That work is cited as inspiration and context.',
              'Cómo funciona MainstreetAi, y el trabajo que muestra que la simulación con agentes de IA a gran escala es un campo activo y validado. Ese trabajo se cita como inspiración y contexto.')}
        </p>
      </header>

      <IsoScenes />

      <p className="research-disclaimer glass">
        <strong>{tr('None of the work below is used by MainstreetAi.', 'MainstreetAi no usa nada del trabajo que sigue.')}</strong>{' '}
        {tr('This project runs SUMO with a rule-based adaptive signal controller, and shares no code, models or technical architecture with it. These are references that shaped how the problem was framed — nothing more.',
            'Este proyecto usa SUMO con un controlador de semáforos adaptativo basado en reglas, y no comparte código, modelos ni arquitectura técnica con él. Son referencias que ayudaron a plantear el problema; nada más.')}
      </p>

      <ul className="research-grid">
        {precedents(tr).map((p) => (
          <li className="research-card glass" key={p.href ?? p.kind}>
            <div className="research-kind">{p.kind}</div>
            <h2 className="research-name">{p.name}</h2>
            <p className="research-what">{p.what}</p>
            <p className="research-why">
              <span className="research-why-label">{tr('Why it is here', 'Por qué está aquí')}</span>
              {p.why}
            </p>
            {p.href ? (
              <a className="research-link" href={p.href}
                 target="_blank" rel="noopener noreferrer">
                {p.href.replace(/^https?:\/\//, '')} ↗
              </a>
            ) : (
              // Deliberately visible: a missing link that looks missing gets filled in.
              <span className="research-link missing">{tr('Link to add', 'Enlace por añadir')}</span>
            )}
          </li>
        ))}
      </ul>

      <p className="research-foot">
        {tr('MainstreetAi compares two SUMO simulations of Santo Domingo’s Distrito Nacional running identical demand, differing only in who controls the traffic lights. Demand is still synthetic, not calibrated against counts. The agent work above informs how that question is framed; it does not run underneath it.',
            'MainstreetAi compara dos simulaciones SUMO del Distrito Nacional de Santo Domingo con la misma demanda, que solo se diferencian en quién controla los semáforos. La demanda todavía es sintética, no calibrada con conteos. El trabajo con agentes de arriba orienta cómo se plantea la pregunta; no corre por debajo.')}
      </p>
    </section>
  )
}
