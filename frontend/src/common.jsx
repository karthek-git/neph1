import { Alert, Box, Chip, Paper, Typography } from '@mui/material'
import { useI18n } from './i18n.jsx'

export const fmt = (n, d = 2) =>
  n == null || Number.isNaN(Number(n)) ? '' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })

export const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')

const SEV = { high: 'error', medium: 'warning', low: 'success' }

// Tonal severity chip that works in light and dark mode (uses MUI's CSS variables).
export function SevChip({ level, size = 'small' }) {
  const { t } = useI18n()
  const c = SEV[level]
  if (!c) return null
  return (
    <Chip
      size={size}
      label={t(level)}
      sx={{
        fontWeight: 700,
        textTransform: 'uppercase',
        fontSize: 11,
        letterSpacing: 0.4,
        color: `${c}.main`,
        bgcolor: (th) => `rgba(${th.vars.palette[c].mainChannel} / 0.16)`,
      }}
    />
  )
}

export function Kpi({ value, label, sx }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover', border: 'none', minWidth: 140, ...sx }}>
      <Typography sx={{ fontSize: 28, lineHeight: 1.15, fontWeight: 400 }}>{value}</Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Paper>
  )
}

export function KpiRow({ children }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1.5 }}>{children}</Box>
}

export const ErrorBox = ({ error, onClose }) => (error ? <Alert severity="error" onClose={onClose} sx={{ my: 1.5 }}>{String(error.message || error)}</Alert> : null)

// Highlight the quoted phrase inside the item text (whitespace tolerant).
export function Highlight({ text, quote }) {
  if (!text) return null
  const q = (quote || '').replace(/^…|…$/g, '').trim()
  if (q.length < 8) return <>{text}</>
  const rx = new RegExp(q.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'i')
  const m = text.match(rx)
  if (!m) return <>{text}</>
  return (
    <>
      {text.slice(0, m.index)}
      <Box component="mark" sx={{ bgcolor: 'rgba(var(--mui-palette-warning-mainChannel) / 0.3)', color: 'inherit', borderRadius: 0.5, px: 0.3 }}>{m[0]}</Box>
      {text.slice(m.index + m[0].length)}
    </>
  )
}

export const PHASES = ['tender', 'bid', 'award']
