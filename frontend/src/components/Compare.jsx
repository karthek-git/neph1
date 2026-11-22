import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { Banner, Button, ErrorBox, Icon, Kpi, KpiRow, LinearProgress, Option, Select } from '../m3/ui.jsx'
import { SevChip } from '../common.jsx'

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
  if (readable.length < 2) return <p className="muted center" style={{ padding: 40 }}>{t('Add at least two files (for example a tender and its award) to compare them.')}</p>
  const B = res?.backtest
  const sel = (label, value, set) => (
    <Select label={label} value={value} onValue={(v) => { set(v); setRes(null) }} style={{ minWidth: 260, flex: 1 }}>
      {readable.map((f) => <Option key={f.id} value={f.id}>{f.name} {f.phase && `(${t(f.phase)})`}</Option>)}
    </Select>
  )
  return (
    <div className="col">
      <Banner>{t('Compares two files of the same BoQ. Items added after the tender are real post-tender changes, a source of change orders.')}</Banner>
      <div className="row">
        {sel(t('Tender'), tender, setTender)}
        <Icon name="compare_arrows" />
        {sel(t('Award or later version'), award, setAward)}
        <Button disabled={!tender || !award || tender === award || busy} onClick={run}>{t('Compare')}</Button>
      </div>
      {busy && <LinearProgress indeterminate />}
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
          <p className="muted">{t('The link to the closest tender item is a rough text-similarity guess: {a} of {b} added items resemble a tender item, and {c} of those were flagged by Calex. Most additions are new products or surcharges with no tender counterpart, so treat this as an illustration, not a statistic.', { a: B.with_related_tender_item, b: B.added, c: B.related_item_was_flagged })}</p>
          <div className="tblwrap" style={{ maxHeight: 560 }}>
            <table className="tbl">
              <thead><tr><th>{t('Item')}</th><th>{t('Added at award')}</th><th>{t('Closest tender item')}</th></tr></thead>
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
