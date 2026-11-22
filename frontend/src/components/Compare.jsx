import { useEffect, useState } from 'react'
import {
  Alert, Button, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, LinearProgress,
} from '@mui/material'
import CompareArrowsOutlined from '@mui/icons-material/CompareArrowsOutlined'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { ErrorBox, Kpi, KpiRow, SevChip } from '../common.jsx'

export default function Compare({ pid, files }) {
  const { t } = useI18n()
  const readable = files.filter((f) => !f.error)
  const [tender, setTender] = useState('')
  const [award, setAward] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!tender) setTender((readable.find((f) => f.phase === 'tender') || readable[0] || {}).id || '')
    if (!award) setAward((readable.find((f) => f.phase === 'award') || readable[1] || {}).id || '')
  }, [readable, tender, award])

  const run = async () => {
    setBusy(true); setError(null); setRes(null)
    try { setRes(await api.compare(pid, { tender_file_id: tender, award_file_id: award })) } catch (e) { setError(e) } finally { setBusy(false) }
  }
  if (readable.length < 2) return <Typography color="text.secondary" align="center" sx={{ py: 5 }}>{t('Add at least two files (for example a tender and its award) to compare them.')}</Typography>
  const B = res?.backtest
  const sel = (label, value, set) => (
    <FormControl sx={{ minWidth: 260, flex: 1 }}><InputLabel>{label}</InputLabel>
      <Select label={label} value={value} onChange={(e) => { set(e.target.value); setRes(null) }}>{readable.map((f) => <MenuItem key={f.id} value={f.id}>{f.name} {f.phase && `(${t(f.phase)})`}</MenuItem>)}</Select></FormControl>
  )
  return (
    <Stack spacing={2}>
      <Alert severity="info" icon={false}>{t('Compares two files of the same BoQ. Items added after the tender are real post-tender changes, a source of change orders.')}</Alert>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        {sel(t('Tender'), tender, setTender)}
        <CompareArrowsOutlined color="action" />
        {sel(t('Award or later version'), award, setAward)}
        <Button variant="contained" onClick={run} disabled={!tender || !award || tender === award || busy}>{t('Compare')}</Button>
      </Stack>
      {busy && <LinearProgress />}
      <ErrorBox error={error} />
      {res && (
        <>
          <KpiRow>
            <Kpi value={res.tender.items} label={t('tender items')} />
            <Kpi value={res.award.items} label={t('award items')} />
            <Kpi value={res.added.length} label={t('added at award')} />
            <Kpi value={res.removed.length} label={t('removed')} />
            <Kpi value={res.changed.length} label={t('quantity or unit changed')} />
          </KpiRow>
          <Typography variant="body2" color="text.secondary">
            {t('The link to the closest tender item is a rough text-similarity guess: {a} of {b} added items resemble a tender item, and {c} of those were flagged by Calex. Most additions are new products or surcharges with no tender counterpart, so treat this as an illustration, not a statistic.', { a: B.with_related_tender_item, b: B.added, c: B.related_item_was_flagged })}
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 560 }}>
            <Table size="small" stickyHeader>
              <TableHead><TableRow><TableCell>{t('Item')}</TableCell><TableCell>{t('Added at award')}</TableCell><TableCell>{t('Closest tender item')}</TableCell></TableRow></TableHead>
              <TableBody>
                {res.added.map((a) => (
                  <TableRow key={a.oz} hover>
                    <TableCell sx={{ fontWeight: 500 }}>{a.oz}</TableCell>
                    <TableCell>{a.short_text}</TableCell>
                    <TableCell>{a.closest_tender_item ? <>{a.closest_tender_item.oz} · {a.closest_tender_item.short_text} <SevChip level={a.closest_tender_item.tender_level === 'none' ? 'low' : a.closest_tender_item.tender_level} /></> : <Typography variant="caption" color="text.secondary">{t('none')}</Typography>}</TableCell>
                  </TableRow>
                ))}
                {res.added.length === 0 && <TableRow><TableCell colSpan={3} align="center" sx={{ py: 3, color: 'text.secondary' }}>{t('No items were added.')}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Stack>
  )
}
