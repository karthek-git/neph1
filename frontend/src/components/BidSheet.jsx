import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { api, download } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { Banner, Button, CircularProgress, ErrorBox, Kpi, KpiRow, Option, Select, TextField } from '../m3/ui.jsx'
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

  if (!readable.length) return <p className="muted center" style={{ padding: 40 }}>{t('Upload a BoQ file first.')}</p>
  return (
    <div className="col">
      <Banner>{t('Enter your unit prices (EP). Totals update live and are saved in this project. Benchmark values are indicative: they come from earlier priced files for the same or similar items and are never a quote.')}</Banner>
      <div className="filters" style={{ marginBottom: 0 }}>
        <Select label={t('File')} value={fid} onValue={setFid} style={{ minWidth: 240 }}>{readable.map((f) => <Option key={f.id} value={f.id}>{f.name}</Option>)}</Select>
        <Select label={t('Trade')} value={trade} onValue={(v) => { setTrade(v); setShown(120) }}>
          <Option value="">{t('All trades')}</Option>{trades.map((x) => <Option key={x} value={x}>{x.length > 40 ? x.slice(0, 38) + '…' : x}</Option>)}
        </Select>
        <TextField label={t('Search')} placeholder={t('Search…')} value={q} onValue={(v) => { setQ(v); setShown(120) }} style={{ flex: 1, minWidth: 200 }} />
        <TextField label={t('Markup %')} value={markup} onValue={setMarkup} style={{ width: 120 }} inputmode="decimal" />
      </div>
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
          <p className="md-typescale-body-small muted">{t('Benchmarks: {m} of {c} unpriced items matched, from {h} historical priced items in {p} projects.', { m: sheet.coverage.matched, c: sheet.coverage.candidates, h: sheet.coverage.history_items, p: sheet.coverage.history_projects })}</p>
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
