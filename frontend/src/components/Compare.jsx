import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { Banner, Button, ErrorBox, Icon, Kpi, KpiRow, LinearProgress, Option, Select } from '../m3/ui.jsx'
import { SevChip, fmt } from '../common.jsx'

export default function Compare({ pid, files }) {
  const { t } = useI18n()
  const readable = files.filter((f) => !f.error)
  const [tender, setTender] = useState('')
  const [award, setAward] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(null)
  const [groups, setGroups] = useState([])
  const sig = files.map((f) => `${f.id}:${f.items}`).join('|')
  useEffect(() => { api.plan(pid).then(setPlan).catch(() => {}); api.versions(pid).then(setGroups).catch(() => {}) }, [pid, sig])
  const vlabel = Object.fromEntries(groups.flatMap((g) => g.versions.filter((v) => v.number > 0).map((v) => [v.file_id, `${t(g.stage)} v${v.number} · ${t(v.tag)}${v.current && g.versions.length > 1 ? ` (${t('Current')})` : ''}`])))
  // smart default: the newest version against the one before it, else tender against award
  useEffect(() => {
    if (tender || award || !plan) return
    const c = plan.compare[0]
    if (c) { setTender(c.tender_id); setAward(c.later_id); return }
    setTender((readable.find((f) => f.phase === 'tender') || readable[0] || {}).id || '')
    setAward((readable.find((f) => f.phase === 'award') || readable[1] || {}).id || '')
  }, [plan, readable, tender, award])

  const autoRan = useRef(false)
  const run = async () => {
    setBusy(true); setError(null); setRes(null)
    try { setRes(await api.compare(pid, { tender_file_id: tender, award_file_id: award })) } catch (e) { setError(e) } finally { setBusy(false) }
  }
  useEffect(() => {      // a tender and its award are there: show the comparison without a click
    if (autoRan.current || !tender || !award || tender === award) return
    if (plan?.compare.some((c) => c.tender_id === tender && c.later_id === award)) { autoRan.current = true; run() }
  }, [tender, award, plan]) // eslint-disable-line
  if (readable.length < 2) return <p className="muted center" style={{ padding: 40 }}>{t('Add at least two files (for example a tender and its award) to compare them.')}</p>
  const B = res?.backtest
  const sel = (label, value, set) => (
    <Select label={label} value={value} onValue={(v) => { set(v); setRes(null) }} style={{ minWidth: 260, flex: 1 }}>
      {readable.map((f) => <Option key={f.id} value={f.id}>{f.name} {vlabel[f.id] ? `(${vlabel[f.id]})` : f.phase ? `(${t(f.phase)})` : ''}</Option>)}
    </Select>
  )
  return (
    <div className="col">
      <Banner>{t('Compares two files of the same BoQ: two versions of a tender after the client answered, a tender and its bid or award. Items added later are real changes, a source of change orders.')}</Banner>
      {plan?.compare.length > 0 && (
        <div className="row gap8">
          <span className="muted">{t('Quick comparisons')}:</span>
          {plan.compare.map((c) => (
            <Button key={c.tender_id + c.later_id} variant="tonal" onClick={() => { setTender(c.tender_id); setAward(c.later_id); setRes(null); setTimeout(() => document.getElementById('cmp-run')?.click(), 0) }}>
              {vlabel[c.later_id] || c.later} {t('vs')} {vlabel[c.tender_id] || c.tender}
            </Button>
          ))}
        </div>
      )}
      <div className="row">
        {sel(t('Older or base file'), tender, setTender)}
        <Icon name="compare_arrows" />
        {sel(t('Newer file (later version, bid or award)'), award, setAward)}
        <Button id="cmp-run" disabled={!tender || !award || tender === award || busy} onClick={run}>{t('Compare')}</Button>
      </div>
      {busy && <LinearProgress indeterminate />}
      <ErrorBox error={error} />
      {res && (
        <>
          <KpiRow>
            <Kpi value={res.tender.items} label={t('tender items')} />
            <Kpi value={res.award.items} label={t('award items')} />
            <Kpi value={res.added.length} label={t('added later')} />
            <Kpi value={res.removed.length} label={t('removed')} />
            <Kpi value={res.changed.length} label={t('quantity or unit changed')} />
            <Kpi value={res.text_changed.length} label={t('wording changed')} />
            <Kpi value={res.price_changed.length} label={t('prices changed')} />
          </KpiRow>
          {res.totals.old != null && res.totals.new != null && <p className="mt8">{t('Total price')}: {fmt(res.totals.old)} → {fmt(res.totals.new)} EUR ({res.totals.new >= res.totals.old ? '+' : ''}{fmt((res.totals.new - res.totals.old) / res.totals.old * 100)} %)</p>}
          {res.changed.length > 0 && (
            <div className="tblwrap mt16" style={{ maxHeight: 320 }}><table className="tbl"><thead><tr><th>{t('Item')}</th><th>{t('Description')}</th><th>{t('Before')}</th><th>{t('After')}</th></tr></thead>
              <tbody>{res.changed.map((c) => <tr key={c.oz}><td style={{ fontWeight: 500 }}>{c.oz}</td><td>{c.short_text}</td><td className="num">{c.tender}</td><td className="num">{c.award}</td></tr>)}</tbody></table></div>
          )}
          {res.text_changed.length > 0 && (
            <div className="tblwrap mt16" style={{ maxHeight: 320 }}><table className="tbl"><thead><tr><th>{t('Item')}</th><th>{t('Before')}</th><th>{t('After')}</th></tr></thead>
              <tbody>{res.text_changed.map((c) => <tr key={c.oz}><td style={{ fontWeight: 500 }}>{c.oz}</td><td>{c.old}</td><td>{c.new}</td></tr>)}</tbody></table></div>
          )}
          {res.price_changed.length > 0 && (
            <div className="tblwrap mt16" style={{ maxHeight: 320 }}><table className="tbl"><thead><tr><th>{t('Item')}</th><th>{t('Description')}</th><th className="right">{t('Before')}</th><th className="right">{t('After')}</th><th className="right">%</th></tr></thead>
              <tbody>{res.price_changed.map((c) => <tr key={c.oz}><td style={{ fontWeight: 500 }}>{c.oz}</td><td>{c.short_text}</td><td className="num">{fmt(c.old)}</td><td className="num">{fmt(c.new)}</td><td className="num">{c.pct != null ? `${c.pct > 0 ? '+' : ''}${fmt(c.pct, 1)}` : ''}</td></tr>)}</tbody></table></div>
          )}
          <p className="muted">{t('The link to the closest tender item is a rough text-similarity guess: {a} of {b} added items resemble a tender item, and {c} of those were flagged by Calex. Most additions are new products or surcharges with no tender counterpart, so treat this as an illustration, not a statistic.', { a: B.with_related_tender_item, b: B.added, c: B.related_item_was_flagged })}</p>
          <div className="tblwrap" style={{ maxHeight: 560 }}>
            <table className="tbl">
              <thead><tr><th>{t('Item')}</th><th>{t('Added later')}</th><th>{t('Closest tender item')}</th></tr></thead>
              <tbody>
                {res.added.map((a) => (
                  <tr key={a.oz}>
                    <td style={{ fontWeight: 500 }}>{a.oz}</td><td>{a.short_text}</td>
                    <td>{a.closest_tender_item ? <>{a.closest_tender_item.oz} · {a.closest_tender_item.short_text} <SevChip level={a.closest_tender_item.tender_level === 'none' ? 'low' : a.closest_tender_item.tender_level} /></> : <span className="md-typescale-body-small muted">{t('none')}</span>}</td>
                  </tr>
                ))}
                {res.added.length === 0 && <tr><td colSpan={3} className="center muted" style={{ padding: 24 }}>{t('No items were added.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
