import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Collapse, IconButton, MenuItem, Paper, Select, Stack, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRounded from '@mui/icons-material/KeyboardArrowUpRounded'
import DownloadOutlined from '@mui/icons-material/DownloadOutlined'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import { api, download } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { ErrorBox, Highlight, Kpi, KpiRow, SevChip, fmt, fmtDate } from '../common.jsx'

const sevOrder = { high: 0, medium: 1, low: 2 }

function Findings({ report }) {
  const { t, lang } = useI18n()
  const [sev, setSev] = useState('')
  const [cat, setCat] = useState('')
  const [trade, setTrade] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [shown, setShown] = useState(40)
  const items = useMemo(() => Object.fromEntries(report.items.map((i) => [i.oz, i])), [report])
  const label = (f) => (lang === 'de' ? f.category_label_de : f.category_label)
  const cats = useMemo(() => [...new Set(report.findings.map(label))].sort(), [report, lang]) // eslint-disable-line
  const trades = useMemo(() => [...new Set(report.findings.map((f) => f.trade).filter(Boolean))].sort(), [report])
  const rows = report.findings.filter((f) =>
    (!sev || f.severity === sev) && (!cat || label(f) === cat) && (!trade || f.trade === trade) &&
    (!q || `${f.oz} ${f.message} ${f.quote} ${items[f.oz]?.short_text || ''}`.toLowerCase().includes(q.toLowerCase())))

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }} alignItems={{ md: 'center' }}>
        <Select displayEmpty value={sev} onChange={(e) => { setSev(e.target.value); setShown(40) }} sx={{ minWidth: 150 }}>
          <MenuItem value="">{t('All severities')}</MenuItem>
          {['high', 'medium', 'low'].map((s) => <MenuItem key={s} value={s}>{t(s)}</MenuItem>)}
        </Select>
        <Select displayEmpty value={cat} onChange={(e) => { setCat(e.target.value); setShown(40) }} sx={{ minWidth: 180 }}>
          <MenuItem value="">{t('All categories')}</MenuItem>
          {cats.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </Select>
        <Select displayEmpty value={trade} onChange={(e) => { setTrade(e.target.value); setShown(40) }} sx={{ minWidth: 200, maxWidth: 280 }}>
          <MenuItem value="">{t('All trades')}</MenuItem>
          {trades.map((c) => <MenuItem key={c} value={c}>{c.length > 50 ? c.slice(0, 48) + '…' : c}</MenuItem>)}
        </Select>
        <TextField placeholder={t('Search item or text…')} value={q} onChange={(e) => { setQ(e.target.value); setShown(40) }} sx={{ flex: 1 }} />
        <Typography variant="body2" color="text.secondary">{t('{n} findings', { n: rows.length })}</Typography>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead><TableRow><TableCell /><TableCell>{t('Severity')}</TableCell><TableCell>{t('Item')}</TableCell><TableCell>{t('Finding')}</TableCell><TableCell>{t('Category')}</TableCell></TableRow></TableHead>
          <TableBody>
            {rows.slice(0, shown).map((f, i) => {
              const it = items[f.oz] || {}
              const k = `${f.oz}|${f.category}|${i}`
              const expanded = open === k
              return (
                <Fragment key={k}>
                  <TableRow hover onClick={() => setOpen(expanded ? null : k)} sx={{ cursor: 'pointer', '& > td': { borderBottom: expanded ? 0 : undefined } }}>
                    <TableCell padding="checkbox">{expanded ? <KeyboardArrowUpRounded /> : <KeyboardArrowDownRounded />}</TableCell>
                    <TableCell><SevChip level={f.severity} /></TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{f.oz}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{(it.short_text || '').slice(0, 60)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {lang === 'de' && f.message_de ? f.message_de : f.message}{' '}
                        {f.source === 'llm' && <Chip size="small" variant="outlined" icon={<AutoAwesomeOutlined />} label="Gemini" sx={{ ml: 0.5, height: 20 }} />}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{(f.quote || '').slice(0, 140)}</Typography>
                    </TableCell>
                    <TableCell><Typography variant="caption">{label(f)}</Typography></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 0, border: expanded ? undefined : 0 }}>
                      <Collapse in={expanded} timeout="auto" unmountOnExit>
                        <Box sx={{ py: 1.5 }}>
                          <Typography variant="caption" color="text.secondary">
                            {[it.trade, it.section].filter(Boolean).join(' › ')} {it.quantity != null && `· ${it.quantity} ${it.unit || ''}`} {it.kind && `· ${it.kind}`}
                            {it.unit_price != null && ` · EP ${fmt(it.unit_price)} · GP ${fmt(it.total_price)}`}
                          </Typography>
                          <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13, my: 1, maxHeight: 260, overflow: 'auto' }}>
                            <Highlight text={it.text} quote={f.quote} />
                          </Box>
                          {f.question && (
                            <Typography variant="body2">
                              <b>{t('Draft question')}:</b> {lang === 'en' && f.question_en ? f.question_en : f.question}
                              {lang === 'en' && f.question_en && <Typography component="div" variant="caption" color="text.secondary">DE: {f.question}</Typography>}
                            </Typography>
                          )}
                          {it.price_hint && (
                            <Typography variant="body2" sx={{ mt: 0.8 }}>
                              <b>{t('Price benchmark (indicative)')}:</b> {fmt(it.price_hint.median)} EUR / {it.unit || t('unit')} ({fmt(it.price_hint.low)} – {fmt(it.price_hint.high)}, {t('{n} similar items', { n: it.price_hint.n })}, {it.price_hint.confidence})
                            </Typography>
                          )}
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {rows.length > shown && <Box sx={{ textAlign: 'center', mt: 1.5 }}><Button onClick={() => setShown((n) => n + 80)}>{t('Show more')}</Button></Box>}
      {rows.length === 0 && <Typography color="text.secondary" align="center" sx={{ py: 4 }}>{t('No findings match these filters.')}</Typography>}
    </>
  )
}

function Questions({ report }) {
  const { t, lang } = useI18n()
  const Q = report.questions
  const [copied, setCopied] = useState(false)
  const text = () => Q.map((q) => `${q.no} [${q.trade}] ${q.question}`).join('\n\n')
  const csv = () => {
    const c = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"'
    return '﻿Nr;Gewerk;Position;Prioritaet;Kategorie;Frage\n' + Q.map((q) => [q.no, q.trade, q.oz, q.severity, q.category_de || q.category, q.question].map(c).join(';')).join('\n')
  }
  let cur = null
  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <Alert severity="info" icon={false} sx={{ flex: 1 }}>
          {t('Drafts for the question phase of the tender. Review and edit before sending. Answers go to all bidders, so do not add prices or strategy. Calex never sends anything.')}
        </Alert>
        <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1}>
          <Button startIcon={<ContentCopyOutlined />} onClick={async () => { await navigator.clipboard.writeText(text()); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? t('Copied') : t('Copy (DE)')}</Button>
          <Button startIcon={<DownloadOutlined />} onClick={() => download(text(), 'calex-bieterfragen.txt')}>.txt</Button>
          <Button startIcon={<DownloadOutlined />} onClick={() => download(csv(), 'calex-bieterfragen.csv', 'text/csv;charset=utf-8')}>.csv</Button>
        </Stack>
      </Stack>
      {Q.length === 0 && <Typography color="text.secondary" align="center" sx={{ py: 4 }}>{t('No high or medium findings, so no questions to ask.')}</Typography>}
      {Q.map((q) => {
        const head = q.trade !== cur ? (cur = q.trade, <Typography key={`h${q.no}`} variant="h6" sx={{ mt: 2.5, mb: 1 }}>{q.trade}</Typography>) : null
        return (
          <Fragment key={q.no}>
            {head}
            <Card sx={{ p: 1.5, mb: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }} flexWrap="wrap">
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{q.no}</Typography>
                <SevChip level={q.severity} />
                <Typography variant="caption" color="text.secondary">{lang === 'de' && q.category_de ? q.category_de : q.category} · {t('Item')} {q.oz}</Typography>
              </Stack>
              <Typography>{lang === 'en' && q.question_en ? q.question_en : q.question}</Typography>
              {lang === 'en' && q.question_en && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{t('German version to send')}: {q.question}</Typography>}
            </Card>
          </Fragment>
        )
      })}
    </>
  )
}

export default function ReportView({ pid, aid }) {
  const { t, lang } = useI18n()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('findings')
  useEffect(() => { setData(null); api.analyses.get(pid, aid).then(setData).catch(setError) }, [pid, aid])
  if (error) return <><ErrorBox error={error} /><Button startIcon={<ArrowBackRounded />} onClick={() => go('p', pid, 'analyses')}>{t('Analyses')}</Button></>
  if (!data) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  const { meta, report: R } = data
  const S = R.summary, L = R.llm, B = R.benchmarks
  const exportXlsx = async () => download(await api.exportReport(R), 'calex-report.xlsx')

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <IconButton onClick={() => go('p', pid, 'analyses')} aria-label={t('Analyses')}><ArrowBackRounded /></IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1.2} alignItems="center" flexWrap="wrap">
            <Typography variant="h5" noWrap>{meta.title}</Typography>
            <Typography variant="body2" color="text.secondary">{t('Overall risk')}</Typography><SevChip level={S.overall} size="medium" />
          </Stack>
          <Typography variant="body2" color="text.secondary">{fmtDate(meta.created)} · {(R.files || []).map((f) => f.name).join(', ')} · {t('{n} items', { n: R.project.items })}{R.project.total_price ? ` · ${fmt(R.project.total_price)} EUR` : ''}</Typography>
        </Box>
        <Button variant="outlined" startIcon={<DownloadOutlined />} onClick={exportXlsx}>{t('Excel report')}</Button>
      </Stack>

      <KpiRow>
        <Kpi value={S.findings} label={t('findings')} />
        <Kpi value={S.severity.high || 0} label={t('high severity')} />
        <Kpi value={S.items_flagged} label={t('items flagged')} />
        <Kpi value={S.change_order_items} label={t('likely change-order items')} />
        <Kpi value={R.questions.length} label={t('bidder questions')} />
        {B?.coverage?.matched > 0 && <Kpi value={`${B.coverage.matched} / ${B.coverage.candidates}`} label={t('items with price benchmark')} />}
      </KpiRow>

      {L.status === 'ok' && <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{t('Gemini added {n} findings, each checked against the item text.', { n: L.findings })}</Typography>}
      {L.status === 'no_key' && <Alert severity="warning" sx={{ mt: 1.5 }}>{t('No Gemini key is set on the server, so only the rule-based checks ran.')}</Alert>}
      {(L.status === 'partial' || L.status === 'failed') && <Alert severity="warning" sx={{ mt: 1.5 }}>{t('Gemini did not fully run')}: {(L.errors || []).join(' | ').slice(0, 300)}</Alert>}
      {(R.project.notes || []).map((n, i) => <Alert key={i} severity="warning" sx={{ mt: 1.5 }}>{n}</Alert>)}
      {S.repeated_patterns?.length > 0 && (
        <Alert severity="info" icon={false} sx={{ mt: 1.5 }}>
          {t('Repeated wording (asked about once, not item by item)')}: {S.repeated_patterns.map((p) => `${lang === 'de' && p.message_de ? p.message_de : p.message} (${p.items})`).join(' · ')}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', my: 2 }}>
        <Tab value="findings" label={`${t('Findings')} (${R.findings.length})`} />
        <Tab value="questions" label={`${t('Bidder questions')} (${R.questions.length})`} />
      </Tabs>
      {tab === 'findings' ? <Findings report={R} /> : <Questions report={R} />}
    </>
  )
}
