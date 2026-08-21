import { useEffect, useRef, useState } from 'react'

/**
 * Decodes one binary frame from the simulation server.
 *
 * Layout (little-endian):
 *   uint32  headerLen        header JSON is padded so the float block stays
 *   bytes   headerLen        4-byte aligned, which lets us build the typed
 *   float32 n_veh * 5        arrays as views ONTO the socket buffer with no
 *   uint8   n_sig            copying at all.
 *   uint8   n_edge
 */
function decode(buf) {
  const view = new DataView(buf)
  const headerLen = view.getUint32(0, true)
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buf, 4, headerLen))
  )

  let off = 4 + headerLen
  const { n_veh: nVeh, n_sig: nSig, n_edge: nEdge } = header

  let vehicles = null
  if (nVeh > 0) {
    vehicles = new Float32Array(buf, off, nVeh * 5)
    off += nVeh * 5 * 4
  }

  let signals = null
  if (nSig > 0 && off + nSig <= buf.byteLength) {
    signals = new Uint8Array(buf, off, nSig)
    off += nSig
  }

  let congestion = null
  if (nEdge > 0 && off + nEdge <= buf.byteLength) {
    congestion = new Uint8Array(buf, off, nEdge)
    off += nEdge
  }

  return { header, vehicles, signals, congestion }
}

export function useSimSocket() {
  // The frame itself lives in a ref: it arrives 10x a second and re-rendering
  // React at that rate for 2,500 vehicles would drop frames. The map reads the
  // ref inside its own animation loop; only the slow dashboard state triggers
  // an actual React render.
  const frameRef = useRef(null)
  const [status, setStatus] = useState('connecting')
  const [header, setHeader] = useState(null)
  const lastHeaderPush = useRef(0)

  useEffect(() => {
    let sock
    let closed = false
    let retry

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      sock = new WebSocket(`${proto}://${location.host}/ws`)
      sock.binaryType = 'arraybuffer'

      sock.onopen = () => setStatus('live')
      sock.onclose = () => {
        if (closed) return
        setStatus('reconnecting')
        retry = setTimeout(connect, 1200)
      }
      sock.onerror = () => sock.close()

      sock.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return
        let f
        try {
          f = decode(ev.data)
        } catch {
          return
        }
        frameRef.current = f

        // Throttle dashboard updates to ~4 Hz; the numbers are unreadable
        // faster than that anyway.
        const now = performance.now()
        if (now - lastHeaderPush.current > 250) {
          lastHeaderPush.current = now
          setHeader(f.header)
        }
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      sock?.close()
    }
  }, [])

  return { frameRef, header, status }
}

export async function postControl(action, value) {
  await fetch('/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, value }),
  })
}

export async function postEvent(kind) {
  await fetch('/api/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  })
}
