import { useEffect, useRef, useState } from 'react'

/**
 * Live connection to the SUMO twin simulation.
 *
 * Wire format — one binary frame per tick, little-endian:
 *
 *   uint32   headerLen        header JSON is padded so the float block stays
 *   bytes    headerLen        4-byte aligned, which lets the typed arrays be
 *   float32  n_veh * 6        VIEWS onto the socket buffer with no copying
 *   uint8    n_sig            0=red 1=amber 2=green, signal_approaches order
 *   uint8    n_edge           mean speed / speed limit * 255, roads.geojson order
 *
 * Per vehicle the six floats are: lon, lat, angle, kind, speed, turn.
 * kind: 0 car, 1 bus, 2 bike, 3 truck, 4 moto. angle is degrees clockwise
 * from north; turn is the signed degrees that VEHICLE rotated over the last
 * tick, which the renderer extrapolates forward exactly as it extrapolates
 * position with speed. It has to be sent per vehicle rather than inferred
 * from the previous frame because the array is repacked every tick and
 * carries no vehicle ids — a slot holds the same vehicle only ~36% of
 * the time.
 *
 * JSON per tick would be roughly 8x larger for the vehicle array and would
 * stall the main thread parsing it at 10 Hz.
 */
// Keep in step with sim_worker.py's veh array and traffic.js's STRIDE.
const VEH_FLOATS = 6
const VEH_BYTES = VEH_FLOATS * 4
export function decodeFrame(buf) {
  const view = new DataView(buf)
  const headerLen = view.getUint32(0, true)
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buf, 4, headerLen))
  )

  let off = 4 + headerLen
  const { n_veh: nVeh, n_sig: nSig, n_edge: nEdge } = header

  let vehicles = null
  if (nVeh > 0 && off + nVeh * VEH_BYTES <= buf.byteLength) {
    vehicles = new Float32Array(buf, off, nVeh * VEH_FLOATS)
    off += nVeh * VEH_BYTES
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
  // The frame lives in a ref, not in state. It arrives 10x a second carrying
  // thousands of vehicles; re-rendering React at that rate would drop frames.
  // The scene reads the ref inside its own animation loop, and only the slow
  // HUD numbers below trigger an actual render.
  const frameRef = useRef(null)
  const [status, setStatus] = useState('connecting')
  const [header, setHeader] = useState(null)
  const lastPush = useRef(0)

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
          f = decodeFrame(ev.data)
        } catch {
          return
        }
        frameRef.current = f

        // Throttle HUD updates to ~4 Hz; the numbers are unreadable faster.
        const now = performance.now()
        if (now - lastPush.current > 250) {
          lastPush.current = now
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

/**
 * `extra` carries fields the action needs beyond a single value — the clock
 * action, for instance, sends both a day and an hour.
 */
export async function postControl(action, value, extra = {}) {
  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, value, ...extra }),
    })
    return res.ok ? await res.json() : null
  } catch {
    /* server not up; the UI already shows the connection state */
    return null
  }
}

export async function postEvent(kind) {
  try {
    await fetch('/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    })
  } catch {
    /* as above */
  }
}
