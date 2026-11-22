import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, download } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { Banner, Button, CircularProgress, ErrorBox, Icon, IconButton, Kpi, KpiRow, Option, PrimaryTab, Select, TabsEl, TextField } from '../m3/ui.jsx'
import { Highlight, SevChip, fmt, fmtDate } from '../common.jsx'

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
      <div className="filters">
        <Select label={t('Severity')} value={sev} onValue={(v) => { setSev(v); setShown(40) }}>
          <Option value="">{t('All severities')}</Option>
          {['high', 'medium', 'low'].map((s) => <Option key={s} value={s}>{t(s)}</Option>)}
        </Select>
        <Select label={t('Category')} value={cat} onValue={(v) => { setCat(v); setShown(40) }}>
          <Option value="">{t('All categories')}</Option>
          {cats.map((c) => <Option key={c} value={c}>{c}</Option>)}
        </Select>
        <Select label={t('Trade')} value={trade} onValue={(v) => { setTrade(v); setShown(40) }}>
          <Option value="">{t('All trades')}</Option>
          {trades.map((c) => <Option key={c} value={c}>{c.length > 50 ? c.slice(0, 48) + '…' : c}</Option>)}
        </Select>
        <TextField label={t('Search')} placeholder={t('Search item or text…')} value={q} onValue={(v) => { setQ(v); setShown(40) }} style={{ flex: 1, minWidth: 220 }}><Icon slot="leading-icon" name="search" /></TextField>
        <span className="muted">{t('{n} findings', { n: rows.length })}</span>
      </div>
      <div className="tblwrap">
        <table className="tbl">
          <thead><tr><th style={{ width: 48 }} /><th>{t('Severity')}</th><th>{t('Item')}</th><th>{t('Finding')}</th><th>{t('Category')}</th></tr></thead>
          <tbody>
            {rows.slice(0, shown).map((f, i) => {
              const it = items[f.oz] || {}
              const k = `${f.oz}|${f.category}|${i}`
              const expanded = open === k
              return (
                <Fragment key={k}>
                  <tr className="hov" onClick={() => setOpen(expanded ? null : k)} aria-expanded={expanded}>
                    <td><Icon name={expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} /></td>
                    <td><SevChip level={f.severity} /></td>
                    <td style={{ maxWidth: 220 }}><div style={{ fontWeight: 500 }}>{f.oz}</div><div className="md-typescale-body-small muted ellipsis">{(it.short_text || '').slice(0, 60)}</div></td>
                    <td>
                      <div>{lang === 'de' && f.message_de ? f.message_de : f.message} {f.source === 'llm' && <span className="tag" style={{ height: 20 }}><Icon name="auto_awesome" />AI</span>}</div>
                      <div className="md-typescale-body-small muted">{(f.quote || '').slice(0, 140)}</div>
                    </td>
                    <td className="md-typescale-body-small">{label(f)}</td>
                  </tr>
                  {expanded && (
                    <tr className="detail"><td colSpan={5}>
                      <div className="md-typescale-body-small muted">
                        {[it.trade, it.section].filter(Boolean).join(' › ')} {it.quantity != null && `· ${it.quantity} ${it.unit || ''}`} {it.kind && `· ${it.kind}`}
                        {it.unit_price != null && ` · EP ${fmt(it.unit_price)} · GP ${fmt(it.total_price)}`}
                      </div>
                      <pre className="txt"><Highlight text={it.text} quote={f.quote} /></pre>
                      {f.question && (
                        <p><b>{t('Draft question')}:</b> {lang === 'en' && f.question_en ? f.question_en : f.question}
                          {lang === 'en' && f.question_en && <span className="md-typescale-body-small muted" style={{ display: 'block' }}>DE: {f.question}</span>}</p>
                      )}
                      {it.price_hint && (
                        <p className="mt8"><b>{t('Price benchmark (indicative)')}:</b> {fmt(it.price_hint.median)} EUR / {it.unit || t('unit')} ({fmt(it.price_hint.low)} – {fmt(it.price_hint.high)}, {t('{n} similar items', { n: it.price_hint.n })}, {it.price_hint.confidence})</p>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown && <div className="center mt16"><Button variant="text" onClick={() => setShown((n) => n + 80)}>{t('Show more')}</Button></div>}
      {rows.length === 0 && <p className="muted center" style={{ padding: 32 }}>{t('No findings match these filters.')}</p>}
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
      <div className="row mb16">
        <div className="banner grow" style={{ margin: 0 }}>{t('Drafts for the question phase of the tender. Review and edit before sending. Answers go to all bidders, so do not add prices or strategy. Calex never sends anything.')}</div>
        <Button variant="outlined" icon="content_copy" onClick={async () => { await navigator.clipboard.writeText(text()); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? t('Copied') : t('Copy (DE)')}</Button>
        <Button variant="outlined" icon="download" onClick={() => download(text(), 'calex-bieterfragen.txt')}>.txt</Button>
        <Button variant="outlined" icon="download" onClick={() => download(csv(), 'calex-bieterfragen.csv', 'text/csv;charset=utf-8')}>.csv</Button>
      </div>
      {Q.length === 0 && <p className="muted center" style={{ padding: 32 }}>{t('No high or medium findings, so no questions to ask.')}</p>}
      {Q.map((q) => {
        const head = q.trade !== cur ? (cur = q.trade, <h3 key={`h${q.no}`} className="md-typescale-title-medium" style={{ margin: '20px 0 8px' }}>{q.trade}</h3>) : null
        return (
          <Fragment key={q.no}>
            {head}
            <div className="card" style={{ marginBottom: 8, padding: 12 }}>
              <div className="row gap8 mb8">
                <b>{q.no}</b><SevChip level={q.severity} />
                <span className="md-typescale-body-small muted">{lang === 'de' && q.category_de ? q.category_de : q.category} · {t('Item')} {q.oz}</span>
              </div>
              <div>{lang === 'en' && q.question_en ? q.question_en : q.question}</div>
              {lang === 'en' && q.question_en && <div className="md-typescale-body-small muted mt8">{t('German version to send')}: {q.question}</div>}
            </div>
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
  const [tab, setTab] = useState(0)
  useEffect(() => { setData(null); api.analyses.get(pid, aid).then(setData).catch(setError) }, [pid, aid])
  if (error) return <><ErrorBox error={error} /><Button variant="text" icon="arrow_back" onClick={() => go('p', pid, 'analyses')}>{t('Analyses')}</Button></>
  if (!data) return <div className="center" style={{ padding: 64 }}><CircularProgress indeterminate /></div>
  const { meta, report: R } = data
  const S = R.summary, L = R.llm, B = R.benchmarks
  const exportXlsx = async () => download(await api.exportReport(R), 'calex-report.xlsx')

  return (
    <>
      <div className="row mb16" style={{ flexWrap: 'nowrap' }}>
        <IconButton icon="arrow_back" label={t('Analyses')} onClick={() => go('p', pid, 'analyses')} />
        <div className="grow">
          <div className="row gap8">
            <h2 className="md-typescale-headline-small ellipsis">{meta.title}</h2>
            <span className="muted">{t('Overall risk')}</span><SevChip level={S.overall} />
          </div>
          <p className="md-typescale-body-medium muted">{fmtDate(meta.created)} · {(R.files || []).map((f) => f.name).join(', ')} · {t('{n} items', { n: R.project.items })}{R.project.total_price ? ` · ${fmt(R.project.total_price)} EUR` : ''}</p>
        </div>
        <Button variant="outlined" icon="download" onClick={exportXlsx}>{t('Excel report')}</Button>
      </div>

      <KpiRow>
        <Kpi value={S.findings} label={t('findings')} />
        <Kpi value={S.severity.high || 0} label={t('high severity')} />
        <Kpi value={S.items_flagged} label={t('items flagged')} />
        <Kpi value={S.change_order_items} label={t('likely change-order items')} />
        <Kpi value={R.questions.length} label={t('bidder questions')} />
        {B?.coverage?.matched > 0 && <Kpi value={`${B.coverage.matched} / ${B.coverage.candidates}`} label={t('items with price benchmark')} />}
      </KpiRow>

      {L.status === 'ok' && <p className="md-typescale-body-medium muted mt16">{t('AI added {n} findings, each checked against the item text.', { n: L.findings })}</p>}
      {L.status === 'no_key' && <Banner kind="warn">{t('No AI key is set on the server, so only the rule-based checks ran.')}</Banner>}
      {(L.status === 'partial' || L.status === 'failed') && <Banner kind="warn">{t('AI analysis did not fully run')}: {(L.errors || []).join(' | ').slice(0, 300)}</Banner>}
      {(R.project.notes || []).map((n, i) => <Banner key={i} kind="warn">{n}</Banner>)}
      {S.repeated_patterns?.length > 0 && (
        <Banner>{t('Repeated wording (asked about once, not item by item)')}: {S.repeated_patterns.map((p) => `${lang === 'de' && p.message_de ? p.message_de : p.message} (${p.items})`).join(' · ')}</Banner>
      )}

      <TabsEl activeTabIndex={tab} onChange={(e) => setTab(e.target.activeTabIndex)} style={{ margin: '16px 0' }}>
        <PrimaryTab>{`${t('Findings')} (${R.findings.length})`}</PrimaryTab>
        <PrimaryTab>{`${t('Bidder questions')} (${R.questions.length})`}</PrimaryTab>
      </TabsEl>
      {tab === 0 ? <Findings report={R} /> : <Questions report={R} />}
    </>
  )
}
