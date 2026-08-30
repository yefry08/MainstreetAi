/**
 * Research: the agent-simulation work this project takes inspiration from.
 *
 * WHAT THIS SECTION CLAIMS, AND WHAT IT MUST NOT
 * Every entry here is cited as PRECEDENT -- evidence that large-scale AI agent
 * simulation is an active, validated research field. None of it is used by
 * this project. MainstreetAi runs SUMO with a rule-based adaptive controller;
 * it shares no code, no models and no architecture with anything below.
 *
 * That distinction is the whole reason the section is worded carefully. A
 * reader skimming cards on a project's own site will assume anything listed is
 * a dependency unless told otherwise, and implying a tie to published research
 * that does not exist would be a straightforward misrepresentation of the
 * work. So the framing is stated once at the top, and each card carries its
 * own "why it is relevant" rather than a bare citation that invites the reader
 * to guess at the connection.
 *
 * LINKS
 * Only URLs that are actually known appear here. Everything else carries an
 * explicit placeholder, because a plausible-looking wrong link is worse than a
 * visibly missing one: nobody checks a URL that looks right.
 */

import PipelineDiagram from './PipelineDiagram'

const PRECEDENTS = [
  {
    name: 'Simile',
    kind: 'Platform',
    what: 'An AI-powered human population simulation platform for market research ' +
          'and social science, validated weekly against thousands of real-world ' +
          'evaluations.',
    why: 'A success case for AI agent simulation at scale, held to continuous ' +
         'real-world validation rather than to a benchmark alone.',
    href: 'https://www.simile.com',
  },
  {
    name: 'MAWM — Multilingual Agent-based World Modeling',
    kind: 'Research framework · COLM 2026',
    what: 'Simulates multilingual societies with generative agents to study ' +
          'opinion dynamics and how information diffuses across cultures.',
    why: 'World-modeling with AI agents pointed at a complex social phenomenon, ' +
         'where the behaviour of interest emerges from the population rather ' +
         'than being scripted.',
    href: null,
  },
  {
    name: 'MicroVerse / MatrAIx',
    kind: 'Experiment',
    what: 'Measures "identity drift" in AI agents across long-running simulations ' +
          'under resource scarcity.',
    why: 'The one on this list that is a caution rather than an encouragement. ' +
         'Anything orchestrating a city runs continuously for days, and an ' +
         'autonomous agent that drifts over time is a failure mode a traffic ' +
         'controller cannot afford.',
    href: null,
  },
  {
    name: 'Generative agent societies',
    kind: 'Research lineage',
    what: "Stanford's Generative Agents (\"Smallville\") and the body of work " +
          'since on simulating societies with language models.',
    why: 'The lineage that made it credible to model a complex urban system ' +
         'with agents at all, rather than only with equations.',
    href: 'https://arxiv.org/abs/2304.03442',
  },
]

export default function Research() {
  return (
    <section className="research">
      <header className="research-head">
        <p className="research-eyebrow">Research</p>
        <h1>Precedent, not architecture</h1>
        <p className="research-lede">
          Work that shows large-scale AI agent simulation is an active and
          validated field. It is cited here as inspiration and context.
        </p>
        <p className="research-disclaimer glass">
          <strong>None of this is used by MainstreetAi.</strong> This project runs
          SUMO with a rule-based adaptive signal controller, and shares no code,
          models or technical architecture with the work below. These are
          references that shaped how the problem was framed — nothing more.
        </p>
      </header>

      <ul className="research-grid">
        {PRECEDENTS.map((p) => (
          <li className="research-card glass" key={p.name}>
            <div className="research-kind">{p.kind}</div>
            <h2 className="research-name">{p.name}</h2>
            <p className="research-what">{p.what}</p>
            <p className="research-why">
              <span className="research-why-label">Why it is here</span>
              {p.why}
            </p>
            {p.href ? (
              <a className="research-link" href={p.href}
                 target="_blank" rel="noopener noreferrer">
                {p.href.replace(/^https?:\/\//, '')} ↗
              </a>
            ) : (
              // Deliberately visible. A missing link that looks missing gets
              // filled in; an invented one that looks plausible never does.
              <span className="research-link missing">Link to add</span>
            )}
          </li>
        ))}
      </ul>

      <p className="research-foot">
        MainstreetAi compares two SUMO simulations of Barcelona running identical
        demand, differing only in who controls the traffic lights. The agent work
        above informs how that question is framed; it does not run underneath it.
      </p>

      {/* The architecture sits under the precedents on purpose. Read in that
          order it settles the question the cards raise -- what, concretely, is
          this thing? -- and shows there is no language model anywhere in it. */}
      <PipelineDiagram />
    </section>
  )
}
