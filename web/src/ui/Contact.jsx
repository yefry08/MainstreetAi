import { useState } from 'react'

/**
 * Contact: bio, links, and a message form.
 *
 * WHY mailto: AND NOT A FORM SERVICE
 * This page is statically hosted -- GitHub Pages, or a prebuilt Vercel upload.
 * There is no backend to POST to. The two options are a third-party form
 * service (Formspree, Getform) or mailto:.
 *
 * mailto: wins here on the criterion that matters for a demo: it cannot break.
 * No account, no API key committed to a public repo, no free-tier submission
 * cap to hit mid-demo, no third party seeing messages, and nothing to configure
 * before the link works. Its real cost is that it needs a mail client
 * configured, so the address is also shown in full and is copyable -- someone
 * without a mail handler is never left with a dead button.
 *
 * A form service would be the right call for a production contact page with
 * real inbound volume. It is the wrong call for a page whose contact form may
 * be used five times.
 */

const EMAIL = 'yefrynunez45@gmail.com'

const LINKS = [
  { label: 'GitHub', href: 'https://github.com/yefry08', handle: '@yefry08' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/yefrynunez/', handle: 'yefrynunez' },
  { label: 'This project', href: 'https://github.com/yefry08/MainstreetAi', handle: 'MainstreetAi' },
]

export default function Contact() {
  const [subject, setSubject] = useState('MainstreetAi')
  const [body, setBody] = useState('')
  const [copied, setCopied] = useState(false)

  const mailto =
    `mailto:${EMAIL}?subject=${encodeURIComponent(subject || 'MainstreetAi')}` +
    `&body=${encodeURIComponent(body)}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard is blocked in some contexts; the address is on screen anyway.
      setCopied(false)
    }
  }

  return (
    <div className="contact-page">
      <div className="contact-grid">
        <section className="contact-bio glass">
          <h1>Yefry Núñez</h1>
          <p className="contact-role">
            Machine Learning Engineer · Founder, AI Safety Dominicana
          </p>
          <p>
            I build machine-learning systems and work on making them safe to
            deploy. AI Safety Dominicana is my effort to grow that conversation
            in the Dominican Republic and the wider Caribbean, where very little
            of it is happening in Spanish.
          </p>
          <p>
            MainstreetAi came out of a question worth asking directly: how much
            congestion can you remove from a city without laying any new
            concrete? It runs two identical simulations of Barcelona on the real
            street network, differing only in who controls the traffic lights,
            and measures the gap.
          </p>

          <div className="contact-links">
            {LINKS.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer"
                 className="contact-link">
                <span className="contact-link-label">{l.label}</span>
                <span className="contact-link-handle">{l.handle}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="contact-form glass">
          <h2>Send a message</h2>

          <label className="contact-field">
            <span>Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What is this about?"
            />
          </label>

          <label className="contact-field">
            <span>Message</span>
            <textarea
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message here…"
            />
          </label>

          <a className={`contact-send ${body.trim() ? '' : 'disabled'}`}
             href={body.trim() ? mailto : undefined}>
            Open in mail app
          </a>

          {/* The form composes a message; it does not send one. Saying so
              prevents someone typing, clicking, and assuming it went. */}
          <p className="contact-hint">
            This opens your mail app with the message ready — it does not send
            it from the page. No backend, so nothing is stored or forwarded
            anywhere.
          </p>

          <button className="contact-copy" onClick={copy}>
            {copied ? 'Copied' : EMAIL}
          </button>
        </section>
      </div>
    </div>
  )
}
