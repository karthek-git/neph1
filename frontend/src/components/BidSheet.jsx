import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Card, CircularProgress, FormControl, InputLabel, Link, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import DownloadOutlined from '@mui/icons-material/DownloadOutlined'
import AutoFixHighOutlined from '@mui/icons-material/AutoFixHighOutlined'
import CheckRounded from '@mui/icons-material/CheckRounded'
import { api, download } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { ErrorBox, Kpi, KpiRow, SevChip, fmt } from '../common.jsx'

const num = (v) => { const x = parseFloat(String(v).replace(/\./g, '').replace(',', '.')); return Number.isNaN(x) ? null : x }

const Row = memo(function Row({ it, price, onPrice, t }) {
  const [text, setText] = useState(price != null ? String(price).replace('.', ',') : '')
  useEffect(() => { setText(price != null ? String(price).replace('.', ',') : '') }, [price])
  const total = price != null && it.quantity != null ? price * it.quantity : null
  const h = it.hint
  return (
    <TableRow hover>
      <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{it.oz}</TableCell>
      <TableCell sx={{ maxWidth: 360 }}>
        <Typography variant="body2" noWrap title={it.short_text}>{it.short_text}</Typography>
        {it.level !== 'none' && <SevChip level={it.level} />}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{it.quantity != null ? String(it.quantity).replace('.', ',') : ''} {it.unit}</TableCell>
      <TableCell>
        <TextField value={text} onChange={(e) => { setText(e.target.value); onPrice(it.oz, num(e.target.value)) }} inputProps={{ inputMode: 'decimal', style: { textAlign: 'right', width: 90 } }} />
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{fmt(total)}</TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        {h && (
          <>
            <Link component="button" underline="hover" onClick={() => onPrice(it.oz, h.median)}>{fmt(h.median)}</Link>
            <Typography component="span" variant="caption" color="text.secondary"> ({fmt(h.low)} – {fmt(h.high)}, {h.n}×, {t(h.confidence)})</Typography>
          </>
        )}
      </TableCell>
    </TableRow>
  )
})

export default function BidSheet({ pid, files }) {
  const { t } = useI18n()
  const readable = files.filter((f) => !f.error)
  const [fid, setFid] = useState('')
  const [sheet, setSheet] = useState(null)
  const [prices, setPrices] = useState({})
  const [markup, setMarkup] = useState('0')
  const [trade, setTrade] = useState('')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(120)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState(null)
  const loaded = useRef(false)

  useEffect(() => { if (!fid && readable.length) setFid(readable[0].id) }, [readable, fid])
  useEffect(() => {
    if (!fid) return
    loaded.current = false; setSheet(null); setError(null)
    api.bid.get(pid, fid).then((s) => {
      const base = Object.fromEntries(s.items.filter((i) => i.unit_price != null).map((i) => [i.oz, i.unit_price]))
      setSheet(s); setPrices({ ...base, ...s.prices }); setMarkup(String(s.markup || 0).replace('.', ',')); loaded.current = true
    }).catch(setError)
  }, [pid, fid])

  // autosave (debounced) once the sheet has been loaded
  useEffect(() => {
    if (!sheet || !loaded.current) return
    setSaved('saving')
    const id = setTimeout(() => {
      api.bid.put(pid, fid, { prices, markup: num(markup) || 0 }).then(() => setSaved('saved')).catch((e) => { setError(e); setSaved('') })
    }, 700)
    return () => clearTimeout(id)
  }, [prices, markup]) // eslint-disable-line

  const setPrice = (oz, v) => setPrices((p) => { const n = { ...p }; if (v == null) delete n[oz]; else n[oz] = v; return n })
  const items = sheet?.items || []
  const trades = useMemo(() => [...new Set(items.map((i) => i.trade).filter(Boolean))], [items])
  const rows = items.filter((i) => (!trade || i.trade === trade) && (!q || `${i.oz} ${i.short_text}`.toLowerCase().includes(q.toLowerCase())))
  const totals = useMemo(() => {
    let net = 0, priced = 0
    for (const i of items) { const p = prices[i.oz]; if (p != null && i.quantity != null) { net += p * i.quantity; priced++ } }
    const mk = num(markup) || 0
    return { net, mk: net * mk / 100, gross: net * (1 + mk / 100), priced }
  }, [items, prices, markup])

  const fill = () => setPrices((p) => { const n = { ...p }; for (const i of items) if (n[i.oz] == null && i.hint) n[i.oz] = i.hint.median; return n })
  const reset = () => setPrices(Object.fromEntries(items.filter((i) => i.unit_price != null).map((i) => [i.oz, i.unit_price])))
  const exportXlsx = async () => {
    const out = items.map((i) => ({ oz: i.oz, trade: i.trade, short_text: i.short_text, unit: i.unit, quantity: i.quantity, unit_price: prices[i.oz] ?? null, kind: i.kind }))
    download(await api.exportBid({ rows: out, markup_pct: num(markup) || 0 }), 'calex-bidsheet.xlsx')
  }

  if (!readable.length) return <Typography color="text.secondary" align="center" sx={{ py: 5 }}>{t('Upload a BoQ file first.')}</Typography>
  return (
    <Stack spacing={2}>
      <Alert severity="info" icon={false}>
        {t('Enter your unit prices (EP). Totals update live and are saved in this project. Benchmark values are indicative: they come from earlier priced files for the same or similar items and are never a quote.')}
      </Alert>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        <FormControl sx={{ minWidth: 240 }}>
          <InputLabel>{t('File')}</InputLabel>
          <Select label={t('File')} value={fid} onChange={(e) => setFid(e.target.value)}>{readable.map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}</Select>
        </FormControl>
        <Select displayEmpty value={trade} onChange={(e) => { setTrade(e.target.value); setShown(120) }} sx={{ minWidth: 180, maxWidth: 260 }}>
          <MenuItem value="">{t('All trades')}</MenuItem>
          {trades.map((x) => <MenuItem key={x} value={x}>{x.length > 40 ? x.slice(0, 38) + '…' : x}</MenuItem>)}
        </Select>
        <TextField placeholder={t('Search…')} value={q} onChange={(e) => { setQ(e.target.value); setShown(120) }} sx={{ flex: 1 }} />
        <TextField label={t('Markup %')} value={markup} onChange={(e) => setMarkup(e.target.value)} sx={{ width: 110 }} />
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={1}>
        <Button startIcon={<AutoFixHighOutlined />} onClick={fill} disabled={!sheet}>{t('Fill empty from benchmarks')}</Button>
        <Button onClick={reset} disabled={!sheet}>{t('Reset to file prices')}</Button>
        <Button variant="outlined" startIcon={<DownloadOutlined />} onClick={exportXlsx} disabled={!sheet}>{t('Excel')}</Button>
        <Box sx={{ flex: 1 }} />
        {saved === 'saving' && <Typography variant="caption" color="text.secondary">{t('Saving…')}</Typography>}
        {saved === 'saved' && <Typography variant="caption" color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><CheckRounded sx={{ fontSize: 16 }} />{t('Saved')}</Typography>}
      </Stack>
      <ErrorBox error={error} />
      {!sheet && !error && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}
      {sheet && (
        <>
          <KpiRow>
            <Kpi value={fmt(totals.net)} label={t('Net total (EUR)')} />
            <Kpi value={fmt(totals.mk)} label={t('Markup {n} %', { n: num(markup) || 0 })} />
            <Kpi value={fmt(totals.gross)} label={t('Total with markup (EUR)')} />
            <Kpi value={`${totals.priced} / ${items.length}`} label={t('items priced')} />
          </KpiRow>
          <Typography variant="caption" color="text.secondary">
            {t('Benchmarks: {m} of {c} unpriced items matched, from {h} historical priced items in {p} projects.', { m: sheet.coverage.matched, c: sheet.coverage.candidates, h: sheet.coverage.history_items, p: sheet.coverage.history_projects })}
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 640 }}>
            <Table size="small" stickyHeader>
              <TableHead><TableRow><TableCell>{t('Item')}</TableCell><TableCell>{t('Description')}</TableCell><TableCell>{t('Qty')}</TableCell><TableCell>EP (EUR)</TableCell><TableCell align="right">{t('Total')}</TableCell><TableCell>{t('Benchmark')}</TableCell></TableRow></TableHead>
              <TableBody>{rows.slice(0, shown).map((it) => <Row key={it.oz} it={it} price={prices[it.oz] ?? null} onPrice={setPrice} t={t} />)}</TableBody>
            </Table>
          </TableContainer>
          {rows.length > shown && <Box sx={{ textAlign: 'center' }}><Button onClick={() => setShown((n) => n + 200)}>{t('Show more')} ({rows.length - shown})</Button></Box>}
        </>
      )}
    </Stack>
  )
}
