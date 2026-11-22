import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { api, download } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { Banner, Button, Checkbox, CircularProgress, ErrorBox, Icon, IconButton, Kpi, KpiRow, Option, PrimaryTab, Select, TabsEl, TextField } from '../m3/ui.jsx'
import { Highlight, SevChip, fmt, fmtDate } from '../common.jsx'

const STATUSES = ['review', 'clarify', 'reviewed', 'dismissed']
const STATUS_LABEL = { review: 'Needs review', clarify: 'Needs clarification', reviewed: 'Reviewed', dismissed: 'Dismissed' }
const STATUS_HINT = { reviewed: 'Checked and handled, for example priced in' }
const stOf = (triage, id) => triage[id]?.status || 'review'

function StatusSelect({ id, triage, setTriage, compact }) {
  const { t } = useI18n()
  const cur = stOf(triage, id)
  return (
    <Select label={compact ? undefined : t('Status')} aria-label={t('Status')} value={cur} onValue={(v) => setTriage(id, v)} style={{ minWidth: 190 }} title={t(STATUS_HINT[cur] || '')}>
      {STATUSES.map((s) => <Option key={s} value={s}>{t(STATUS_LABEL[s])}</Option>)}
    </Select>
  )
}

function Findings({ report, triage, setTriage, tradeInit, onTradeUsed }) {
  const { t, lang } = useI18n()
  const [sev, setSev] = useState('')
  const [cat, setCat] = useState('')
  const [trade, setTrade] = useState(tradeInit || '')
  const [status, setStatus] = useState('')
  const [showDismissed, setShowDismissed] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [shown, setShown] = useState(40)
  useEffect(() => { if (tradeInit) { setTrade(tradeInit); onTradeUsed?.() } }, [tradeInit]) // eslint-disable-line
  const items = useMemo(() => Object.fromEntries(report.items.map((i) => [i.oz, i])), [report])
  const label = (f) => (lang === 'de' ? f.category_label_de : f.category_label)
  const cats = useMemo(() => [...new Set(report.findings.map(label))].sort(), [report, lang]) // eslint-disable-line
  const trades = useMemo(() => [...new Set(report.findings.map((f) => f.trade).filter(Boolean))].sort(), [report])
  const rows = report.findings.filter((f) =>
    (!sev || f.severity === sev) && (!cat || label(f) === cat) && (!trade || f.trade === trade) &&
    (status ? stOf(triage, f.id) === status : (showDismissed || stOf(triage, f.id) !== 'dismissed')) &&
    (!q || `${f.oz} ${f.message} ${f.quote} ${items[f.oz]?.short_text || ''}`.toLowerCase().includes(q.toLowerCase())))
  const hidden = report.findings.filter((f) => stOf(triage, f.id) === 'dismissed').length

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
        <Select label={t('Status')} value={status} onValue={(v) => { setStatus(v); setShown(40) }}>
          <Option value="">{t('All statuses')}</Option>
          {STATUSES.map((s) => <Option key={s} value={s}>{t(STATUS_LABEL[s])}</Option>)}
        </Select>
        <TextField label={t('Search')} placeholder={t('Search item or text…')} value={q} onValue={(v) => { setQ(v); setShown(40) }} style={{ flex: 1, minWidth: 220 }}><Icon slot="leading-icon" name="search" /></TextField>
        <span className="muted">{t('{n} findings', { n: rows.length })}</span>
        {hidden > 0 && !status && <Button variant="text" onClick={() => setShowDismissed((v) => !v)}>{showDismissed ? t('Hide dismissed') : t('Show {n} dismissed', { n: hidden })}</Button>}
      </div>
      <div className="tblwrap">
        <table className="tbl">
          <thead><tr><th style={{ width: 48 }} /><th>{t('Severity')}</th><th>{t('Item')}</th><th>{t('Finding')}</th><th>{t('Category')}</th><th>{t('Status')}</th></tr></thead>
          <tbody>
            {rows.slice(0, shown).map((f) => {
              const it = items[f.oz] || {}
              const expanded = open === f.id
              const st = stOf(triage, f.id)
              return (
                <Fragment key={f.id}>
                  <tr className="hov" onClick={() => setOpen(expanded ? null : f.id)} aria-expanded={expanded} style={st === 'dismissed' ? { opacity: 0.55 } : undefined}>
                    <td><Icon name={expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} /></td>
                    <td><SevChip level={f.severity} /></td>
                    <td style={{ maxWidth: 220 }}><div style={{ fontWeight: 500 }}>{f.oz}</div><div className="md-typescale-body-small muted ellipsis">{(it.short_text || '').slice(0, 60)}</div></td>
                    <td>
                      <div>{lang === 'de' && f.message_de ? f.message_de : f.message} {f.source === 'llm' && <span className="tag" style={{ height: 20 }}><Icon name="auto_awesome" />AI</span>}</div>
                      <div className="md-typescale-body-small muted">{(f.quote || '').slice(0, 140)}</div>
                    </td>
                    <td className="md-typescale-body-small">{label(f)}</td>
                    <td className="nowrap"><span className={`chip st-${st}`}>{t(STATUS_LABEL[st])}</span></td>
                  </tr>
                  {expanded && (
                    <tr className="detail"><td colSpan={6}>
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
                        <div className="mt8">
                          <p><b>{t('Price benchmark (indicative)')}:</b> {fmt(it.price_hint.median)} EUR / {it.unit || t('unit')} ({fmt(it.price_hint.low)} – {fmt(it.price_hint.high)}, {t('{n} similar items', { n: it.price_hint.n })}, {it.price_hint.confidence})</p>
                          {(it.price_hint.matches || []).length > 0 && (
                            <div className="md-typescale-body-small muted"><b>{t('Based on')}:</b>
                              {it.price_hint.matches.map((m, k) => <div key={k}>{m.source} · {m.oz} · {m.text} · {fmt(m.unit_price)} EUR ({Math.round(m.similarity * 100)} %)</div>)}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="row mt8" onClick={(e) => e.stopPropagation()}>
                        <StatusSelect id={f.id} triage={triage} setTriage={setTriage} />
                        <NoteField id={f.id} triage={triage} setTriage={setTriage} />
                      </div>
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

function NoteField({ id, triage, setTriage }) {
  const { t } = useI18n()
  const [v, setV] = useState(triage[id]?.note || '')
  useEffect(() => setV(triage[id]?.note || ''), [id]) // eslint-disable-line
  return <TextField label={t('Note (optional)')} value={v} onValue={setV} onBlur={() => v !== (triage[id]?.note || '') && setTriage(id, stOf(triage, id), v)} style={{ flex: 1, minWidth: 220 }} />
}

function Questions({ pid, aid, report, triage, qstate, setQ }) {
  const { t, lang } = useI18n()
  const Q = report.questions
  const key = (q) => q.fid || q.no
  const visible = Q.filter((q) => stOf(triage, q.fid) !== 'dismissed')
  const isSel = (q) => qstate[key(q)]?.selected ?? (stOf(triage, q.fid) !== 'reviewed')
  const txt = (q) => qstate[key(q)]?.text ?? q.question
  const chosen = visible.filter(isSel)
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState(false)
  const plain = () => chosen.map((q, i) => `${i + 1}. [${q.trade}] ${q.oz && !q.oz.includes('items') ? `Pos. ${q.oz}: ` : ''}${txt(q)}`).join('\n\n')
  const email = () => `Betreff: Bieterfragen zur Ausschreibung\n\nSehr geehrte Damen und Herren,\n\nbei der Bearbeitung unseres Angebots bitten wir um Klärung der folgenden Punkte:\n\n${plain()}\n\nWir bitten um Beantwortung an alle Bieter.\n\nMit freundlichen Grüßen`
  const csv = () => {
    const c = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"'
    return '﻿Nr;Gewerk;Position;Prioritaet;Kategorie;Frage\n' + chosen.map((q) => [q.no, q.trade, q.oz, q.severity, q.category_de || q.category, txt(q)].map(c).join(';')).join('\n')
  }
  const copy = async (what, text) => { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500) }
  const letter = async () => {
    setBusy(true)
    try { download(await api.letter(pid, aid, chosen.map(key)), 'bieterfragen.docx') } finally { setBusy(false) }
  }
  let cur = null
  return (
    <>
      <div className="banner" style={{ margin: '0 0 12px' }}><div className="grow">{t('Drafts for the question phase of the tender. Review and edit before sending. Answers go to all bidders, so do not add prices or strategy. Calex never sends anything.')}</div></div>
      <div className="row mb16">
        <span className="muted grow">{t('{n} of {m} questions selected', { n: chosen.length, m: visible.length })}</span>
        <Button variant="outlined" icon="mail" disabled={!chosen.length} onClick={() => copy('mail', email())}>{copied === 'mail' ? t('Copied') : t('Copy as email')}</Button>
        <Button variant="outlined" icon="content_copy" disabled={!chosen.length} onClick={() => copy('txt', plain())}>{copied === 'txt' ? t('Copied') : t('Copy (DE)')}</Button>
        <Button variant="outlined" icon="download" disabled={!chosen.length} onClick={() => download(plain(), 'calex-bieterfragen.txt')}>.txt</Button>
        <Button variant="outlined" icon="download" disabled={!chosen.length} onClick={() => download(csv(), 'calex-bieterfragen.csv', 'text/csv;charset=utf-8')}>.csv</Button>
        <Button icon="description" disabled={!chosen.length || busy} onClick={letter}>{t('Word letter (DE)')}</Button>
      </div>
      {Q.length === 0 && <p className="muted center" style={{ padding: 32 }}>{t('No high or medium findings, so no questions to ask.')}</p>}
      {visible.map((q) => {
        const head = q.trade !== cur ? (cur = q.trade, <h3 key={`h${q.no}`} className="md-typescale-title-medium" style={{ margin: '20px 0 8px' }}>{q.trade}</h3>) : null
        const st = qstate[key(q)] || {}
        return (
          <Fragment key={q.no}>
            {head}
            <div className="card" style={{ marginBottom: 8, padding: 12, opacity: isSel(q) ? 1 : 0.6 }}>
              <div className="row gap8 mb8">
                <Checkbox checked={isSel(q)} onValue={(v) => setQ(key(q), { selected: v })} aria-label={`${t('Select')} ${q.no}`} />
                <b>{q.no}</b><SevChip level={q.severity} />
                <span className="md-typescale-body-small muted grow">{lang === 'de' && q.category_de ? q.category_de : q.category} · {t('Item')} {q.oz}</span>
                <label className="row gap8 md-typescale-body-small"><Checkbox checked={!!st.sent} onValue={(v) => setQ(key(q), { sent: v })} aria-label={`${t('Sent')} ${q.no}`} />{t('Sent')}</label>
              </div>
              <QuestionText q={q} value={txt(q)} edited={st.text != null} onSave={(v) => setQ(key(q), { text: v })} />
              {lang === 'en' && q.question_en && <div className="md-typescale-body-small muted mt8">{t('English reading copy')}: {q.question_en}</div>}
            </div>
          </Fragment>
        )
      })}
    </>
  )
}

function QuestionText({ q, value, edited, onSave }) {
  const { t } = useI18n()
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <>
      <textarea className="cellin" aria-label={`${t('Question')} ${q.no}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />
      {edited && <div className="md-typescale-body-small muted">{t('Edited by you')} · <button className="linkbtn" onClick={() => onSave(q.question)}>{t('Restore original')}</button></div>}
    </>
  )
}

function Changes({ pid, aid, analyses }) {
  const { t, lang } = useI18n()
  const others = analyses.filter((a) => a.id !== aid)
  const [base, setBase] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { setData(null); api.changes(pid, aid, base).then(setData).catch(setError) }, [pid, aid, base])
  if (error) return <ErrorBox error={error} />
  if (!data) return <div className="center" style={{ padding: 32 }}><CircularProgress indeterminate /></div>
  const list = (rows, kind) => rows.map((f) => (
    <div key={f.id} className="card" style={{ marginBottom: 8, padding: 12 }}>
      <div className="row gap8"><SevChip level={f.severity} /><b>{f.oz}</b><span className="md-typescale-body-small muted">{lang === 'de' ? f.category_label_de : f.category_label}</span></div>
      <div>{lang === 'de' && f.message_de ? f.message_de : f.message}</div>
      {kind === 'resolved' && <div className="md-typescale-body-small muted">{t('No longer found in the newer analysis.')}</div>}
    </div>
  ))
  return (
    <>
      <div className="row mb16">
        <Select label={t('Compare with')} value={base || data.base?.id || ''} onValue={setBase} style={{ minWidth: 320 }}>
          {others.map((a) => <Option key={a.id} value={a.id}>{`${a.title} · ${fmtDate(a.created)}`}</Option>)}
        </Select>
        {data.base && <span className="muted">{t('{n} new · {r} resolved · {u} unchanged', { n: data.new.length, r: data.resolved.length, u: data.unchanged })}</span>}
      </div>
      {!data.base && <p className="muted center" style={{ padding: 32 }}>{t('There is no earlier analysis to compare with. Run another analysis after changing the files (for example after the client answered), and the differences show here.')}</p>}
      {data.base && <>
        <h3 className="md-typescale-title-medium mb8">{t('Resolved since the earlier analysis')} ({data.resolved.length})</h3>
        {data.resolved.length ? list(data.resolved, 'resolved') : <p className="muted">{t('Nothing was resolved.')}</p>}
        <h3 className="md-typescale-title-medium" style={{ margin: '20px 0 8px' }}>{t('New since the earlier analysis')} ({data.new.length})</h3>
        {data.new.length ? list(data.new, 'new') : <p className="muted">{t('Nothing new.')}</p>}
      </>}
    </>
  )
}

function Overview({ pid, report: R, triage, setTriage, qstate, goFindings, goQuestions }) {
  const { t, lang } = useI18n()
  const S = R.summary
  const live = R.findings.filter((f) => stOf(triage, f.id) !== 'dismissed')
  const count = (s) => R.findings.filter((f) => stOf(triage, f.id) === s).length
  const top = live.slice(0, 5)
  const qs = R.questions.filter((q) => stOf(triage, q.fid) !== 'dismissed').slice(0, 3)
  const byTrade = useMemo(() => {
    const m = {}
    for (const f of live) { const k = f.trade || t('General'); (m[k] ||= { high: 0, medium: 0, low: 0 })[f.severity]++ }
    return Object.entries(m).map(([trade, c]) => ({ trade, ...c, score: c.high * 5 + c.medium * 3 + c.low })).sort((a, b) => b.score - a.score).slice(0, 10)
  }, [live, lang]) // eslint-disable-line
  const maxTotal = Math.max(1, ...byTrade.map((x) => x.high + x.medium + x.low))
  const E = S.exposure
  return (
    <div className="col" id="print-summary" style={{ gap: 20 }}>
      <div className="card filled">
        <div className="row gap8"><h3 className="md-typescale-title-large">{t('Overall risk')}</h3><SevChip level={S.overall} /></div>
        <p className="mt8">{t('{h} high-severity findings across {i} flagged items. {c} items are likely to cause change orders.', { h: S.severity.high || 0, i: S.items_flagged, c: S.change_order_items })}</p>
        <p className="muted mt8">{t('{a} still need review, {b} need clarification, {c} reviewed, {d} dismissed.', { a: count('review'), b: count('clarify'), c: count('reviewed'), d: count('dismissed') })}
          {count('reviewed') + count('clarify') + count('dismissed') >= 5 && ` ${t('Of the findings you looked at, {p} % were kept.', { p: Math.round(100 * (count('reviewed') + count('clarify')) / (count('reviewed') + count('clarify') + count('dismissed'))) })}`}</p>
        {R.timing && <p className="md-typescale-body-small muted mt8">{t('Calex read {i} items in {s} seconds and found {f} findings. The AI step, if used, is included.', { i: R.project.items, s: R.timing.seconds, f: S.findings })}</p>}
      </div>

      <div className="card">
        <h3 className="md-typescale-title-medium">{t('Change-order exposure (indicative)')}</h3>
        {E && E.eur > 0 ? (
          <>
            <div className="md-typescale-headline-medium mt8">≈ {fmt(E.eur, 0)} EUR</div>
            <p className="muted mt8">{t('If the quantities of the {n} likely change-order items deviate by {p} % (the VOB/B §2 (3) threshold). Based on {b} prices.', { n: E.items_priced, p: E.deviation_pct, b: E.basis === 'file' ? t('the prices in the file') : E.basis === 'benchmark' ? t('benchmark') : t('file and benchmark') })}
              {E.items_unpriced > 0 && ` ${t('{u} items have no price and are not included.', { u: E.items_unpriced })}`} {t('This is an estimate of the order of magnitude, not a forecast.')}</p>
          </>
        ) : <p className="muted mt8">{t('No prices are available for the change-order items, so no money impact can be shown. Enter your prices in the Bid sheet or add a priced file.')}</p>}
      </div>

      <div className="card">
        <h3 className="md-typescale-title-medium mb8">{t('Top risks')}</h3>
        {top.length === 0 && <p className="muted">{t('No open findings.')}</p>}
        {top.map((f) => (
          <div key={f.id} className="row" style={{ flexWrap: 'nowrap', padding: '8px 0', borderTop: '1px solid var(--md-sys-color-outline-variant)' }}>
            <SevChip level={f.severity} />
            <div className="grow"><b>{f.oz}</b> · {lang === 'de' && f.message_de ? f.message_de : f.message}</div>
            <StatusSelect id={f.id} triage={triage} setTriage={setTriage} compact />
          </div>
        ))}
        <div className="mt8"><Button variant="text" onClick={() => goFindings('')}>{t('All findings')}</Button></div>
      </div>

      <div className="card">
        <h3 className="md-typescale-title-medium mb8">{t('Risk by trade')}</h3>
        {byTrade.map((x) => (
          <button key={x.trade} className="tradebar" onClick={() => goFindings(R.findings.find((f) => (f.trade || t('General')) === x.trade)?.trade || '')} aria-label={`${x.trade}: ${x.high} ${t('high')}, ${x.medium} ${t('medium')}, ${x.low} ${t('low')}`}>
            <span className="ellipsis tradename">{x.trade}</span>
            <span className="tbars">
              <i className="b high" style={{ width: `${(x.high / maxTotal) * 100}%` }} /><i className="b medium" style={{ width: `${(x.medium / maxTotal) * 100}%` }} /><i className="b low" style={{ width: `${(x.low / maxTotal) * 100}%` }} />
            </span>
            <span className="num muted">{x.high + x.medium + x.low}</span>
          </button>
        ))}
        <p className="md-typescale-body-small muted mt8">{t('High')} ■ · {t('Medium')} ■ · {t('Low')} ■</p>
      </div>

      <div className="card">
        <h3 className="md-typescale-title-medium mb8">{t('First questions to ask the client')}</h3>
        {qs.length === 0 && <p className="muted">{t('No high or medium findings, so no questions to ask.')}</p>}
        {qs.map((q) => <p key={q.no} style={{ margin: '6px 0' }}><b>{q.no}</b> · {lang === 'en' && q.question_en ? q.question_en : q.question}</p>)}
        <div className="mt8"><Button variant="text" onClick={goQuestions}>{t('All {n} questions', { n: R.questions.length })}</Button></div>
      </div>

      <div className="row no-print">
        <Button variant="outlined" icon="print" onClick={() => window.print()}>{t('Print / save as PDF')}</Button>
        <Button variant="text" icon="request_quote" onClick={() => go('p', pid, 'bid')}>{t('Open the bid sheet')}</Button>
        <Button variant="text" icon="tune" onClick={() => go('p', pid, 'whatif')}>{t('What-if')}</Button>
      </div>
    </div>
  )
}

export default function ReportView({ pid, aid, analyses = [] }) {
  const { t, lang } = useI18n()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState(0)
  const [triage, setTriageState] = useState({})
  const [qstate, setQState] = useState({})
  const [tradeInit, setTradeInit] = useState('')
  useEffect(() => { setData(null); setTab(0); api.analyses.get(pid, aid).then(setData).catch(setError) }, [pid, aid])
  useEffect(() => { api.triage.get(pid).then(setTriageState).catch(() => {}); api.qstate.get(pid).then(setQState).catch(() => {}) }, [pid])

  const setTriage = useCallback((id, status, note) => {
    setTriageState((m) => ({ ...m, [id]: { status, note: note ?? m[id]?.note ?? '' } }))
    api.triage.put(pid, id, status, note ?? triage[id]?.note ?? '').catch(setError)
  }, [pid, triage])
  const setQ = useCallback((key, patch) => {
    setQState((m) => ({ ...m, [key]: { ...(m[key] || {}), ...patch } }))
    api.qstate.put(pid, key, patch).catch(setError)
  }, [pid])

  if (error) return <><ErrorBox error={error} /><Button variant="text" icon="arrow_back" onClick={() => go('p', pid, 'analyses')}>{t('Analyses')}</Button></>
  if (!data) return <div className="center" style={{ padding: 64 }}><CircularProgress indeterminate /></div>
  const { meta, report: R } = data
  const S = R.summary, L = R.llm, B = R.benchmarks
  const exportXlsx = async () => download(await api.exportReport(R), 'calex-report.xlsx')
  const goFindings = (trade) => { setTradeInit(trade); setTab(1) }
  const open = R.findings.filter((f) => stOf(triage, f.id) === 'review').length

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
        <Kpi value={open} label={t('still need review')} />
        <Kpi value={S.severity.high || 0} label={t('high severity')} />
        <Kpi value={S.change_order_items} label={t('likely change-order items')} />
        <Kpi value={R.questions.length} label={t('bidder questions')} />
        {B?.coverage?.matched > 0 && <Kpi value={`${B.coverage.matched} / ${B.coverage.candidates}`} label={t('items with price benchmark')} />}
      </KpiRow>

      {(R.unconfirmed_files || []).length > 0 && <Banner kind="warn"><b>{t('Not all items are confirmed.')}</b> {t('These files contain AI-extracted items that nobody has confirmed yet: {names}. Check them in Parsed items.', { names: R.unconfirmed_files.join(', ') })}</Banner>}
      {L.status === 'ok' && <p className="md-typescale-body-medium muted mt16">{t('AI added {n} findings, each checked against the item text.', { n: L.findings })}</p>}
      {L.status === 'no_key' && <Banner kind="warn">{t('No AI key is set on the server, so only the rule-based checks ran.')}</Banner>}
      {(L.status === 'partial' || L.status === 'failed') && <Banner kind="warn">{t('AI analysis did not fully run')}: {(L.errors || []).join(' | ').slice(0, 300)}</Banner>}
      {(R.project.notes || []).map((n, i) => <Banner key={i} kind="warn">{n}</Banner>)}
      {S.repeated_patterns?.length > 0 && (
        <Banner>{t('Repeated wording (asked about once, not item by item)')}: {S.repeated_patterns.map((p) => `${lang === 'de' && p.message_de ? p.message_de : p.message} (${p.items})`).join(' · ')}</Banner>
      )}

      <TabsEl activeTabIndex={tab} onChange={(e) => setTab(e.target.activeTabIndex)} style={{ margin: '16px 0' }} className="no-print">
        <PrimaryTab>{t('Overview')}</PrimaryTab>
        <PrimaryTab>{`${t('Findings')} (${R.findings.length})`}</PrimaryTab>
        <PrimaryTab>{`${t('Bidder questions')} (${R.questions.length})`}</PrimaryTab>
        <PrimaryTab>{t('Changes')}</PrimaryTab>
      </TabsEl>
      {tab === 0 && <Overview pid={pid} report={R} triage={triage} setTriage={setTriage} qstate={qstate} goFindings={goFindings} goQuestions={() => setTab(2)} />}
      {tab === 1 && <Findings report={R} triage={triage} setTriage={setTriage} tradeInit={tradeInit} onTradeUsed={() => setTradeInit('')} />}
      {tab === 2 && <Questions pid={pid} aid={aid} report={R} triage={triage} qstate={qstate} setQ={setQ} />}
      {tab === 3 && <Changes pid={pid} aid={aid} analyses={analyses} />}
    </>
  )
}
