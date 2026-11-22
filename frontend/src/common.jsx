import { useEffect, useState } from 'react'
import { useI18n } from './i18n.jsx'

export const fmt = (n, d = 2) =>
  n == null || Number.isNaN(Number(n)) ? '' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })

export const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')

// Severity as a small M3 label using the container roles (works in light and dark).
export function SevChip({ level }) {
  const { t } = useI18n()
  if (!['high', 'medium', 'low'].includes(level)) return null
  return <span className={`sev ${level}`}>{t(level)}</span>
}

// Highlight the quoted phrase inside the item text (whitespace tolerant).
export function Highlight({ text, quote }) {
  if (!text) return null
  const q = (quote || '').replace(/^…|…$/g, '').trim()
  if (q.length < 8) return <>{text}</>
  const rx = new RegExp(q.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'i')
  const m = text.match(rx)
  if (!m) return <>{text}</>
  return <>{text.slice(0, m.index)}<mark>{m[0]}</mark>{text.slice(m.index + m[0].length)}</>
}

export function useWide() {
  const q = '(min-width: 900px)'
  const [w, setW] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setW(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return w
}
