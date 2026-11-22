import { useEffect, useState } from 'react'
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, FormControl, FormControlLabel, InputLabel, MenuItem, Paper, Select, Stack,
  Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, LinearProgress,
} from '@mui/material'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import AddRounded from '@mui/icons-material/AddRounded'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { ErrorBox, Kpi, KpiRow, fmt } from '../common.jsx'

const COMPONENTS = ['materials', 'wages', 'plant', 'other', 'price']
const pctNum = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isNaN(x) ? 0 : x }

export default function WhatIf({ pid, files }) {
  const { t } = useI18n()
  const readable = files.filter((f) => !f.error)
  const [fid, setFid] = useState('')
  const [presets, setPresets] = useState([])
  const [sc, setSc] = useState([])
  const [scope, setScope] = useState('')
  const [comp, setComp] = useState('materials')
  const [pct, setPct] = useState('10')
  const [split, setSplit] = useState({ materials: '45', wages: '40', plant: '10', other: '5' })
  const [optional, setOptional] = useState(true)
  const [useBid, setUseBid] = useState(false)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { api.presets().then(setPresets).catch(() => {}) }, [])
  useEffect(() => {
    if (fid || !readable.length) return
    setFid((readable.find((f) => f.priced > 0) || readable[0]).id)
  }, [readable, fid])

  const addCustom = () => { setSc((s) => [...s, { scope: scope.trim(), component: comp, pct: pctNum(pct) }]); setScope('') }
  const label = (s) => s.name ? t(s.name) : `${s.scope ? `“${s.scope.slice(0, 24)}” ` : t('all items') + ' '}${t(s.component)} ${s.pct > 0 ? '+' : ''}${s.pct} %`
  const run = async () => {
    setBusy(true); setError(null); setRes(null)
    try {
      setRes(await api.whatif(pid, {
        file_id: fid, scenarios: sc.map(({ name, ...r }) => ({ name: name ? t(name) : undefined, ...r })), include_optional: optional, use_bid: useBid,
        split: Object.fromEntries(Object.entries(split).map(([k, v]) => [k, pctNum(v) / 100])),
      }))
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  if (!readable.length) return <Typography color="text.secondary" align="center" sx={{ py: 5 }}>{t('Upload a BoQ file first.')}</Typography>
  const sign = (n) => (n >= 0 ? '+' : '')

  return (
    <Stack spacing={2}>
      <Alert severity="info" icon={false}>
        {t('Shows what happens to the total if prices change. Works on a priced file (bid, award, offer) or on a tender with your saved bid prices. A keyword or regex limits a change to matching items, for example a material.')}
      </Alert>
      <FormControl sx={{ maxWidth: 420 }}>
        <InputLabel>{t('File')}</InputLabel>
        <Select label={t('File')} value={fid} onChange={(e) => { setFid(e.target.value); setRes(null) }}>
          {readable.map((f) => <MenuItem key={f.id} value={f.id}>{f.name}{f.priced ? '' : ` (${t('no prices')})`}</MenuItem>)}
        </Select>
      </FormControl>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.8 }}>{t('Quick scenarios')}</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1}>
          {presets.map((p) => <Chip key={p.name} icon={<AddRounded />} label={t(p.name)} onClick={() => setSc((s) => [...s, p])} variant="outlined" clickable />)}
        </Stack>
      </Box>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
        <TextField label={t('Items matching (regex, empty = all)')} value={scope} onChange={(e) => setScope(e.target.value)} sx={{ flex: 2 }} />
        <FormControl sx={{ minWidth: 160 }}><InputLabel>{t('Cost part')}</InputLabel>
          <Select label={t('Cost part')} value={comp} onChange={(e) => setComp(e.target.value)}>{COMPONENTS.map((c) => <MenuItem key={c} value={c}>{c === 'price' ? t('whole price') : t(c)}</MenuItem>)}</Select></FormControl>
        <TextField label="%" value={pct} onChange={(e) => setPct(e.target.value)} sx={{ width: 90 }} />
        <Button startIcon={<AddRounded />} onClick={addCustom}>{t('Add scenario')}</Button>
      </Stack>
      <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1}>
        {sc.length === 0 && <Typography variant="body2" color="text.secondary">{t('No scenarios yet.')}</Typography>}
        {sc.map((s, i) => <Chip key={i} label={label(s)} onDelete={() => setSc((x) => x.filter((_, j) => j !== i))} />)}
      </Stack>
      <Accordion variant="outlined" disableGutters sx={{ '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography variant="body2">{t('Assumed cost split (used only if the file has no real split)')}</Typography></AccordionSummary>
        <AccordionDetails>
          <Stack direction="row" spacing={1.5}>{Object.keys(split).map((k) => <TextField key={k} label={`${t(k)} %`} value={split[k]} onChange={(e) => setSplit((s) => ({ ...s, [k]: e.target.value }))} sx={{ width: 120 }} />)}</Stack>
        </AccordionDetails>
      </Accordion>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
        <FormControlLabel control={<Switch checked={optional} onChange={(e) => setOptional(e.target.checked)} />} label={t('Include optional and alternative items')} />
        <FormControlLabel control={<Switch checked={useBid} onChange={(e) => setUseBid(e.target.checked)} />} label={t('Use my saved bid prices')} />
        <Button variant="contained" size="large" disabled={!sc.length || busy || !fid} onClick={run}>{t('Run what-if')}</Button>
      </Stack>
      {busy && <LinearProgress />}
      <ErrorBox error={error} />
      {res && (
        <Stack spacing={2}>
          <KpiRow>
            <Kpi value={fmt(res.baseline)} label={t('Baseline (EUR)')} />
            <Kpi value={fmt(res.scenario)} label={t('Scenario (EUR)')} />
            <Kpi value={`${sign(res.delta)}${fmt(res.delta)}`} label={t('Difference (EUR)')} />
            <Kpi value={`${sign(res.delta)}${fmt(res.delta_pct)} %`} label={t('Difference')} />
          </KpiRow>
          <Typography variant="body2" color="text.secondary">
            {res.scenarios.map((s) => `${s.name}: ${t('{n} items', { n: s.items_affected })}`).join(' · ')} · {t('Cost split')}: {res.split_source === 'file' ? t('from the file') : `${t('assumed')} (${Object.entries(res.split_used).map(([a, b]) => `${t(a)} ${Math.round(b * 100)} %`).join(', ')})`}
          </Typography>
          {res.assumptions.map((a) => <Alert key={a} severity="warning">{a}</Alert>)}
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead><TableRow><TableCell>{t('Trade')}</TableCell><TableCell align="right">{t('Baseline')}</TableCell><TableCell align="right">{t('Difference')}</TableCell></TableRow></TableHead>
              <TableBody>{res.by_trade.filter((x) => x.delta).map((x) => <TableRow key={x.trade}><TableCell>{x.trade}</TableCell><TableCell align="right">{fmt(x.baseline)}</TableCell><TableCell align="right">{sign(x.delta)}{fmt(x.delta)}</TableCell></TableRow>)}</TableBody>
            </Table>
          </TableContainer>
          <Typography variant="h6">{t('Most affected items')}</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead><TableRow><TableCell>{t('Item')}</TableCell><TableCell>{t('Description')}</TableCell><TableCell align="right">{t('Baseline')}</TableCell><TableCell align="right">{t('Difference')}</TableCell></TableRow></TableHead>
              <TableBody>{res.top_items.map((x) => <TableRow key={x.oz}><TableCell sx={{ fontWeight: 500 }}>{x.oz}</TableCell><TableCell>{x.short_text}</TableCell><TableCell align="right">{fmt(x.baseline)}</TableCell><TableCell align="right">{sign(x.delta)}{fmt(x.delta)}</TableCell></TableRow>)}</TableBody>
            </Table>
          </TableContainer>
        </Stack>
      )}
    </Stack>
  )
}
