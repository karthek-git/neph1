import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { AssistChip, Banner, Button, ErrorBox, Icon, IconButton, Kpi, KpiRow, LinearProgress, Option, Select, Switch, TextField } from '../m3/ui.jsx'
import { fmt } from '../common.jsx'

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
  const [useBid, setUseBid] = useState(true)
  const [useBench, setUseBench] = useState(false)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { api.presets().then(setPresets).catch(() => {}) }, [])
  useEffect(() => {
    if (fid || !readable.length) return
    setFid((readable.find((f) => f.priced > 0) || readable[0]).id)
  }, [readable, fid])

  useEffect(() => {      // show the quick scenarios without a click: on the file's own prices, or for a tender on bid / benchmark prices
    if (autoRan.current || !presets.length || !fid) return
    const f = readable.find((x) => x.id === fid)
    if (!f) return
    autoRan.current = true
    const priced = f.priced > 0
    setUseBench(!priced); setSc(presets); run(presets, { bid: true, bench: !priced })
  }, [presets, fid, readable]) // eslint-disable-line
  const addCustom = () => { setSc((s) => [...s, { scope: scope.trim(), component: comp, pct: pctNum(pct) }]); setScope('') }
  const label = (s) => s.name ? t(s.name) : `${s.scope ? `“${s.scope.slice(0, 24)}” ` : t('all items') + ' '}${t(s.component)} ${s.pct > 0 ? '+' : ''}${s.pct} %`
  const autoRan = useRef(false)
  const run = async (scs = sc, o = {}) => {
    setBusy(true); setError(null); setRes(null)
    try {
      setRes(await api.whatif(pid, {
        file_id: fid, scenarios: scs.map(({ name, ...r }) => ({ name: name ? t(name) : undefined, ...r })), include_optional: optional, use_bid: o.bid ?? useBid, use_benchmark: o.bench ?? useBench,
        split: Object.fromEntries(Object.entries(split).map(([k, v]) => [k, pctNum(v) / 100])),
      }))
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  if (!readable.length) return <p className="muted center" style={{ padding: 40 }}>{t('Upload a BoQ file first.')}</p>
  const sign = (n) => (n >= 0 ? '+' : '')

  return (
    <div className="col">
      <Banner>{t('Shows what happens to the total if prices change. It works on a priced file (bid, award, offer), or on a tender using your saved bid prices or indicative benchmark prices. A keyword or regex limits a change to matching items, for example a material.')}</Banner>
      <Select label={t('File')} value={fid} onValue={(v) => { setFid(v); setRes(null) }} style={{ maxWidth: 420 }}>
        {readable.map((f) => <Option key={f.id} value={f.id}>{f.name}{f.priced ? '' : ` (${t('no prices')})`}</Option>)}
      </Select>
      <div>
        <div className="md-typescale-title-small mb8">{t('Quick scenarios')}</div>
        <div className="chips">{presets.map((p) => <AssistChip key={p.name} label={t(p.name)} onClick={() => setSc((s) => [...s, p])}><Icon slot="icon" name="add" /></AssistChip>)}</div>
      </div>
      <div className="row">
        <TextField label={t('Items matching (regex, empty = all)')} value={scope} onValue={setScope} style={{ flex: 2, minWidth: 240 }} />
        <Select label={t('Cost part')} value={comp} onValue={setComp} style={{ minWidth: 170 }}>{COMPONENTS.map((c) => <Option key={c} value={c}>{c === 'price' ? t('whole price') : t(c)}</Option>)}</Select>
        <TextField label="%" value={pct} onValue={setPct} style={{ width: 100 }} />
        <Button variant="tonal" icon="add" onClick={addCustom}>{t('Add scenario')}</Button>
      </div>
      <div className="chips">
        {sc.length === 0 && <span className="muted">{t('No scenarios yet.')}</span>}
        {sc.map((s, i) => <span key={i} className="tag filled" style={{ height: 32 }}>{label(s)}<IconButton icon="close" label={t('Delete')} onClick={() => setSc((x) => x.filter((_, j) => j !== i))} style={{ '--md-icon-button-state-layer-size': '24px', marginRight: -6 }} /></span>)}
      </div>
      <details>
        <summary className="muted">{t('Assumed cost split (used only if the file has no real split)')}</summary>
        <div className="row mt8">{Object.keys(split).map((k) => <TextField key={k} label={`${t(k)} %`} value={split[k]} onValue={(v) => setSplit((s) => ({ ...s, [k]: v }))} style={{ width: 120 }} />)}</div>
      </details>
      <div className="row">
        <label className="row gap8"><Switch selected={optional} onValue={setOptional} aria-label={t('Include optional and alternative items')} />{t('Include optional and alternative items')}</label>
        <label className="row gap8"><Switch selected={useBid} onValue={setUseBid} aria-label={t('Use my saved bid prices')} />{t('Use my saved bid prices')}</label>
        <label className="row gap8"><Switch selected={useBench} onValue={setUseBench} aria-label={t('Use indicative benchmark prices for unpriced items')} />{t('Use indicative benchmark prices for unpriced items')}</label>
        <Button icon="play_arrow" disabled={!sc.length || busy || !fid} onClick={() => run()}>{t('Run what-if')}</Button>
      </div>
      {busy && <LinearProgress indeterminate />}
      <ErrorBox error={error} />
      {res && (
        <div className="col">
          <KpiRow>
            <Kpi value={fmt(res.baseline)} label={t('Baseline (EUR)')} />
            <Kpi value={fmt(res.scenario)} label={t('Scenario (EUR)')} />
            <Kpi value={`${sign(res.delta)}${fmt(res.delta)}`} label={t('Difference (EUR)')} />
            <Kpi value={`${sign(res.delta)}${fmt(res.delta_pct)} %`} label={t('Difference')} />
          </KpiRow>
          <p className="muted">
            {res.scenarios.map((s) => `${s.name}: ${t('{n} items', { n: s.items_affected })}`).join(' · ')} · {t('Cost split')}: {res.split_source === 'file' ? t('from the file') : `${t('assumed')} (${Object.entries(res.split_used).map(([a, b]) => `${t(a)} ${Math.round(b * 100)} %`).join(', ')})`}
          </p>
          {res.basis && (res.basis.bid_items > 0 || res.basis.benchmark_items > 0) && (
            <Banner kind={res.basis.benchmark_items > 0 ? 'warn' : 'info'}>
              {t('Baseline built from')}: {[res.basis.file_items > 0 && t('{n} prices in the file', { n: res.basis.file_items }), res.basis.bid_items > 0 && t('{n} of your saved bid prices', { n: res.basis.bid_items }),
                res.basis.benchmark_items > 0 && t('{n} indicative benchmark prices', { n: res.basis.benchmark_items })].filter(Boolean).join(' · ')}.
              {' '}{t('Items without a price (lump sums, hourly work, no benchmark match) are not included: the baseline covers {p} of {t} items.', { p: res.items_priced, t: res.basis.total_items })}
            </Banner>
          )}
          {res.assumptions.map((a) => <Banner key={a} kind="warn">{a}</Banner>)}
          {res.outside_total && (res.outside_total.optional.items > 0 || res.outside_total.alternative.items > 0) && (
            <Banner>
              {t('Items outside the base total')}: {res.outside_total.optional.items > 0 && `${t('optional')} ${fmt(res.outside_total.optional.eur)} EUR (${t('{n} items', { n: res.outside_total.optional.items })})`}
              {res.outside_total.optional.items > 0 && res.outside_total.alternative.items > 0 && ' · '}
              {res.outside_total.alternative.items > 0 && `${t('alternative')} ${fmt(res.outside_total.alternative.eur)} EUR (${t('{n} items', { n: res.outside_total.alternative.items })})`}.
              {' '}{t('If the client orders them, the price changes by this much. Use the switch above to include or exclude them.')}
            </Banner>
          )}
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>{t('Trade')}</th><th className="right">{t('Baseline')}</th><th className="right">{t('Difference')}</th></tr></thead>
            <tbody>{res.by_trade.filter((x) => x.delta).map((x) => <tr key={x.trade}><td>{x.trade}</td><td className="num">{fmt(x.baseline)}</td><td className="num">{sign(x.delta)}{fmt(x.delta)}</td></tr>)}</tbody>
          </table></div>
          <h3 className="md-typescale-title-large">{t('Most affected items')}</h3>
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>{t('Item')}</th><th>{t('Description')}</th><th className="right">{t('Baseline')}</th><th className="right">{t('Difference')}</th></tr></thead>
            <tbody>{res.top_items.map((x) => <tr key={x.oz}><td style={{ fontWeight: 500 }}>{x.oz}</td><td>{x.short_text}</td><td className="num">{fmt(x.baseline)}</td><td className="num">{sign(x.delta)}{fmt(x.delta)}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}
