import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { api, download } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { Banner, Button, Checkbox, CircularProgress, ErrorBox, Icon, Kpi, KpiRow, Option, PrimaryTab, Select, TabsEl, TextField } from '../m3/ui.jsx'
import { SevChip, fmt } from '../common.jsx'

const num = (v) => { const x = parseFloat(String(v).replace(/\./g, '').replace(',', '.')); return Number.isNaN(x) ? null : x }

const Row = memo(function Row({ it, price, onPrice, t }) {
  const [text, setText] = useState(price != null ? String(price).replace('.', ',') : '')
  useEffect(() => { setText(price != null ? String(price).replace('.', ',') : '') }, [price])
  const total = price != null && it.quantity != null ? price * it.quantity : null
  const h = it.hint
  return (
    <tr>
      <td className="nowrap" style={{ fontWeight: 500 }}>{it.oz}</td>
      <td style={{ maxWidth: 360 }}><div className="ellipsis" title={it.short_text}>{it.short_text}</div>{it.level !== 'none' && <SevChip level={it.level} />}</td>
      <td className="nowrap">{it.quantity != null ? String(it.quantity).replace('.', ',') : ''} {it.unit}</td>
      <td className="price">
        <TextField value={text} onValue={(v) => { setText(v); onPrice(it.oz, num(v)) }} inputmode="decimal" aria-label={`${t('Unit price')} ${it.oz}`}
          style={{ '--md-outlined-text-field-top-space': '8px', '--md-outlined-text-field-bottom-space': '8px' }} />
      </td>
      <td className="num">{fmt(total)}</td>
      <td className="nowrap">
        {h && <><Button variant="text" onClick={() => onPrice(it.oz, h.median)} aria-label={`${t('Use benchmark price')} ${fmt(h.median)}`}>{fmt(h.median)}</Button>
          <span className="md-typescale-body-small muted"> ({fmt(h.low)} – {fmt(h.high)}, {h.n}×, {t(h.confidence)})</span></>}
      </td>
    </tr>
  )
})

function Prices({ pid, files, fid, setFid, onMarkupHint }) {
  const { t } = useI18n()
  const readable = files.filter((f) => !f.error)
  const [hint, setHint] = useState(null)
  useEffect(() => { if (fid) api.bid.context(pid, fid).then((c) => setHint(c.markup_hint)).catch(() => setHint(null)) }, [pid, fid])
  const [sheet, setSheet] = useState(null)
  const [prices, setPrices] = useState({})
  const [markup, setMarkup] = useState('0')
  const [trade, setTrade] = useState('')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(120)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState(null)
  const loaded = useRef(false)

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

  return (
    <div className="col">
      <Banner>{t('Enter your unit prices (EP). Totals update live and are saved in this project. Benchmark values are indicative: they come from earlier priced files for the same or similar items and are never a quote.')}</Banner>
      <div className="filters" style={{ marginBottom: 0 }}>
        <Select label={t('Trade')} value={trade} onValue={(v) => { setTrade(v); setShown(120) }}>
          <Option value="">{t('All trades')}</Option>{trades.map((x) => <Option key={x} value={x}>{x.length > 40 ? x.slice(0, 38) + '…' : x}</Option>)}
        </Select>
        <TextField label={t('Search')} placeholder={t('Search…')} value={q} onValue={(v) => { setQ(v); setShown(120) }} style={{ flex: 1, minWidth: 200 }} />
        <TextField label={t('Markup %')} value={markup} onValue={setMarkup} style={{ width: 120 }} inputmode="decimal" />
      </div>
      {hint && (
        <Banner>
          <b>{t('Suggested markup for risk and profit')}: {String(hint.low).replace('.', ',')} – {String(hint.high).replace('.', ',')} %</b>{' '}
          {t('Rule of thumb from {h} open high and {m} open medium findings. You decide.', { h: hint.open_high, m: hint.open_medium })}{' '}
          <Button variant="text" onClick={() => setMarkup(String(hint.low).replace('.', ','))}>{t('Use {n} %', { n: String(hint.low).replace('.', ',') })}</Button>
        </Banner>
      )}
      <div className="row">
        <Button variant="tonal" icon="auto_fix_high" onClick={fill} disabled={!sheet}>{t('Fill empty from benchmarks')}</Button>
        <Button variant="text" onClick={reset} disabled={!sheet}>{t('Reset to file prices')}</Button>
        <Button variant="outlined" icon="download" onClick={exportXlsx} disabled={!sheet}>{t('Excel')}</Button>
        <span className="grow" />
        {saved === 'saving' && <span className="md-typescale-body-small muted">{t('Saving…')}</span>}
        {saved === 'saved' && <span className="md-typescale-body-small" style={{ color: 'var(--md-sys-color-primary)' }}>✓ {t('Saved')}</span>}
      </div>
      <ErrorBox error={error} />
      {!sheet && !error && <div className="center" style={{ padding: 48 }}><CircularProgress indeterminate /></div>}
      {sheet && (
        <>
          <KpiRow>
            <Kpi value={fmt(totals.net)} label={t('Net total (EUR)')} />
            <Kpi value={fmt(totals.mk)} label={t('Markup {n} %', { n: num(markup) || 0 })} />
            <Kpi value={fmt(totals.gross)} label={t('Total with markup (EUR)')} />
            <Kpi value={`${totals.priced} / ${items.length}`} label={t('items priced')} />
          </KpiRow>
          <p className="md-typescale-body-small muted">{t('Benchmarks: {m} of {c} unpriced items matched, from {h} historical priced items in {p} projects.', { m: sheet.coverage.matched, c: sheet.coverage.candidates, h: sheet.coverage.history_items, p: sheet.coverage.history_projects })} {sheet.coverage.sources?.length > 0 && `${t('Price history from')}: ${sheet.coverage.sources.join(', ')}.`} {t('Change the sources in the Files tab.')}</p>
          <div className="tblwrap" style={{ maxHeight: 640 }}>
            <table className="tbl">
              <thead><tr><th>{t('Item')}</th><th>{t('Description')}</th><th>{t('Qty')}</th><th>EP (EUR)</th><th className="right">{t('Total')}</th><th>{t('Benchmark')}</th></tr></thead>
              <tbody>{rows.slice(0, shown).map((it) => <Row key={it.oz} it={it} price={prices[it.oz] ?? null} onPrice={setPrice} t={t} />)}</tbody>
            </table>
          </div>
          {rows.length > shown && <div className="center"><Button variant="text" onClick={() => setShown((n) => n + 200)}>{t('Show more')} ({rows.length - shown})</Button></div>}
        </>
      )}
    </div>
  )
}

function Offer({ pid, fid }) {
  const { t } = useI18n()
  const [ctx, setCtx] = useState(null)
  const [vat, setVat] = useState('19')
  const [days, setDays] = useState('30')
  const [pick, setPick] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setCtx(null); api.bid.context(pid, fid).then((c) => { setCtx(c); setPick(Object.fromEntries(c.clarifications.map((x) => [x.id, true]))) }).catch(setError) }, [pid, fid])
  if (error) return <ErrorBox error={error} />
  if (!ctx) return <div className="center" style={{ padding: 48 }}><CircularProgress indeterminate /></div>
  const v = num(vat) || 0
  const mk = ctx.net * (ctx.markup || 0) / 100
  const net2 = ctx.net + mk
  const assumptions = ctx.clarifications.filter((c) => pick[c.id]).map((c) => `${t('Item')} ${c.oz}: ${c.question}${c.note ? ` (${c.note})` : ''}`)
  const make = async () => {
    setBusy(true)
    try { download(await api.bid.offer(pid, fid, { vat_pct: v, validity_days: parseInt(days, 10) || 30, assumptions }), 'angebot.docx') } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return (
    <div className="col">
      <Banner>{t('The offer summary is a German Word document you can edit. Name, company, address and signature stay as placeholders. Calex never sends anything.')}</Banner>
      <KpiRow>
        <Kpi value={fmt(ctx.net)} label={t('Net total (EUR)')} />
        <Kpi value={fmt(mk)} label={t('Markup {n} %', { n: ctx.markup || 0 })} />
        <Kpi value={fmt(net2)} label={t('Offer net (EUR)')} />
        <Kpi value={fmt(net2 * (1 + v / 100))} label={t('Offer gross (EUR)')} />
      </KpiRow>
      {ctx.priced < ctx.items && <Banner kind="warn">{t('{n} of {m} items have no price yet, so the total is incomplete. Go to Prices to fill them.', { n: ctx.items - ctx.priced, m: ctx.items })}</Banner>}
      <div className="row">
        <TextField label={t('VAT %')} value={vat} onValue={setVat} inputmode="decimal" style={{ width: 120 }} />
        <TextField label={t('Offer valid (days)')} value={days} onValue={setDays} inputmode="numeric" style={{ width: 160 }} />
        <span className="muted">{t('The markup is set in Prices.')}</span>
      </div>
      <div className="card">
        <h3 className="md-typescale-title-medium mb8">{t('Assumptions and reservations')}</h3>
        <p className="muted mb8">{t('Taken from the findings you marked "Needs clarification". Untick the ones you do not want in the offer.')}</p>
        {ctx.clarifications.length === 0 && <p className="muted">{t('Nothing marked yet. Mark findings as "Needs clarification" in the report to list them here.')}</p>}
        {ctx.clarifications.map((c) => (
          <label key={c.id} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', padding: '4px 0' }}>
            <Checkbox checked={!!pick[c.id]} onValue={(x) => setPick((p) => ({ ...p, [c.id]: x }))} aria-label={`${t('Item')} ${c.oz}`} />
            <span><b>{c.oz}</b> · {c.question}{c.note && <span className="muted"> ({c.note})</span>}</span>
          </label>
        ))}
      </div>
      <div className="row"><Button icon="description" disabled={busy || !ctx.priced} onClick={make}>{t('Word offer (DE)')}</Button></div>
    </div>
  )
}

function Export({ pid, fid, file }) {
  const { t } = useI18n()
  const [ctx, setCtx] = useState(null)
  const [withMk, setWithMk] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setCtx(null); api.bid.context(pid, fid).then(setCtx).catch(setError) }, [pid, fid])
  if (error && !ctx) return <ErrorBox error={error} />
  if (!ctx) return <div className="center" style={{ padding: 48 }}><CircularProgress indeterminate /></div>
  const isX83 = /\.(x83|xml)$/i.test(file?.name || '')
  const go84 = async () => {
    setBusy(true); setError(null)
    try { const b = await api.bid.x84(pid, fid, withMk); download(b, (file.name.replace(/\.(x83|xml)$/i, '') + '.X84'), 'application/xml') } catch (e) { setError(e) } finally { setBusy(false) }
  }
  const checks = [
    { ok: ctx.priced > 0, text: t('{n} of {m} items are priced.', { n: ctx.priced, m: ctx.items }) },
    { ok: ctx.unpriced.length === 0, text: ctx.unpriced.length ? t('{n} items without a price, e.g. {x}.', { n: ctx.unpriced.length, x: ctx.unpriced.slice(0, 4).join(', ') }) : t('Every item has a price.') },
    { ok: isX83, text: isX83 ? t('The original is a GAEB X83, so a priced X84 can be written.') : t('The original is not an X83. A priced X84 can only be written into an X83 tender; use the Excel export instead.') },
  ]
  return (
    <div className="col">
      <Banner kind="warn">{t('The X84 is written into a copy of your original X83: only the prices and the phase marker change. It is checked by reading it back, but it is not certified against any client software. Test the import before you submit.')}</Banner>
      <div className="card">
        <h3 className="md-typescale-title-medium mb8">{t('Check before export')}</h3>
        {checks.map((c) => <div key={c.text} className="row gap8" style={{ flexWrap: 'nowrap', padding: '4px 0' }}><Icon name={c.ok ? 'check_circle' : 'warning'} style={{ color: c.ok ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-error)' }} /><span>{c.text}</span></div>)}
      </div>
      <label className="row gap8">
        <Checkbox checked={withMk} onValue={setWithMk} aria-label={t('Include my markup in the unit prices')} />{t('Include my markup ({n} %) in the unit prices', { n: ctx.markup || 0 })}
      </label>
      <ErrorBox error={error} onClose={() => setError(null)} />
      <div className="row"><Button icon="download" disabled={!isX83 || !ctx.priced || busy} onClick={go84}>{t('Download priced GAEB X84')}</Button></div>
    </div>
  )
}

export default function BidSheet({ pid, files }) {
  const { t } = useI18n()
  const readable = files.filter((f) => !f.error)
  const [fid, setFid] = useState('')
  const [tab, setTab] = useState(0)
  useEffect(() => { if (!fid && readable.length) setFid(readable.find((f) => f.phase === 'tender')?.id || readable[0].id) }, [readable, fid])
  if (!readable.length) return <p className="muted center" style={{ padding: 40 }}>{t('Upload a BoQ file first.')}</p>
  const file = readable.find((f) => f.id === fid)
  return (
    <div className="col">
      <div className="row">
        <Select label={t('File')} value={fid} onValue={setFid} style={{ minWidth: 260 }}>{readable.map((f) => <Option key={f.id} value={f.id}>{f.name}</Option>)}</Select>
      </div>
      <TabsEl activeTabIndex={tab} onChange={(e) => setTab(e.target.activeTabIndex)}>
        <PrimaryTab>{t('Prices')}</PrimaryTab><PrimaryTab>{t('Offer')}</PrimaryTab><PrimaryTab>{t('Export')}</PrimaryTab>
      </TabsEl>
      {fid && tab === 0 && <Prices pid={pid} files={files} fid={fid} setFid={setFid} />}
      {fid && tab === 1 && <Offer pid={pid} fid={fid} />}
      {fid && tab === 2 && <Export pid={pid} fid={fid} file={file} />}
    </div>
  )
}
