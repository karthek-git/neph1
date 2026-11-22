import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { Banner, Button, Checkbox, CircularProgress, Dialog, ErrorBox, Icon, IconButton, Kpi, KpiRow, PrimaryTab, TabsEl, TextField } from '../m3/ui.jsx'
import { fmt, fmtDate } from '../common.jsx'
import { ConfirmDialog } from './ProjectsPage.jsx'

const EMPTY = { description: '', unit: '', price: '', source: '', price_date: '', region: '', note: '', wages: '', materials: '', plant: '' }
const num = (v) => { if (v === '' || v == null) return null; const x = parseFloat(String(v).replace(/\./g, '').replace(',', '.')); return Number.isNaN(x) ? null : x }

function EntryDialog({ open, entry, onClose, onSaved }) {
  const { t } = useI18n()
  const [f, setF] = useState(EMPTY)
  const [error, setError] = useState(null)
  useEffect(() => { if (open) { setF(entry ? { ...EMPTY, ...Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, v ?? ''])) } : EMPTY); setError(null) } }, [open, entry])
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    const body = { description: f.description, unit: f.unit, price: num(f.price), wages: num(f.wages), materials: num(f.materials), plant: num(f.plant), source: f.source, price_date: f.price_date, region: f.region, note: f.note }
    if (body.price == null) { setError(new Error(t('Please enter a price.'))); return }
    try { entry ? await api.catalog.edit(entry.id, body) : await api.catalog.add(body); onSaved() } catch (e) { setError(e) }
  }
  return (
    <Dialog open={open} onClose={onClose} title={entry ? t('Edit catalog entry') : t('New catalog entry')} width={640}
      actions={<><Button variant="text" onClick={onClose}>{t('Cancel')}</Button><Button variant="text" onClick={save}>{t('Save')}</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <TextField label={t('Description')} required value={f.description} onValue={set('description')} style={{ width: '100%' }} />
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <TextField label={t('Unit')} value={f.unit} onValue={set('unit')} style={{ width: 110 }} />
          <TextField label={t('Unit price (EUR)')} required value={String(f.price).replace('.', ',')} onValue={set('price')} inputmode="decimal" style={{ flex: 1 }} />
          <TextField label={t('Price date')} type="date" value={f.price_date} onValue={set('price_date')} style={{ flex: 1 }} />
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <TextField label={t('Wages')} value={String(f.wages).replace('.', ',')} onValue={set('wages')} inputmode="decimal" style={{ flex: 1 }} />
          <TextField label={t('Materials')} value={String(f.materials).replace('.', ',')} onValue={set('materials')} inputmode="decimal" style={{ flex: 1 }} />
          <TextField label={t('Plant')} value={String(f.plant).replace('.', ',')} onValue={set('plant')} inputmode="decimal" style={{ flex: 1 }} />
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <TextField label={t('Source')} value={f.source} onValue={set('source')} style={{ flex: 1 }} />
          <TextField label={t('Region')} value={f.region} onValue={set('region')} style={{ flex: 1 }} />
        </div>
        <TextField label={t('Note')} value={f.note} onValue={set('note')} style={{ width: '100%' }} />
      </div>
      <ErrorBox error={error} />
    </Dialog>
  )
}

function CatalogTab({ data, reload, setError }) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)       // entry, or {} for new
  const [del, setDel] = useState(null)
  const [note, setNote] = useState(null)
  const file = useRef(null)
  const rows = useMemo(() => data.entries.filter((e) => `${e.description} ${e.source} ${e.region}`.toLowerCase().includes(q.toLowerCase())), [data, q])
  const upload = async (f) => {
    try {
      const r = await api.catalog.import(f)
      setNote(t('{n} entries imported.', { n: r.added }) + (r.skipped_count ? ' ' + t('{n} rows were skipped: {why}', { n: r.skipped_count, why: r.skipped.slice(0, 2).map((s) => `${t('row')} ${s.row}: ${s.reason}`).join(' · ') }) : ''))
      reload()
    } catch (e) { setError(e) }
  }
  return (
    <div className="col">
      <Banner>{t('Your reference prices (house prices or imported price books). They are used for price hints, estimates and the what-if, ahead of the history of your projects. Prices are brought to today\'s level using the adjustments.')}</Banner>
      {note && <Banner kind="ok" onClose={() => setNote(null)}>{note}</Banner>}
      <div className="row">
        <TextField label={t('Search')} value={q} onValue={setQ} style={{ minWidth: 240 }}><Icon slot="leading-icon" name="search" /></TextField>
        <span className="muted">{t('{n} entries', { n: data.entries.length })}</span>
        <span className="grow" />
        <Button variant="outlined" icon="upload_file" onClick={() => file.current?.click()}>{t('Import Excel or CSV')}</Button>
        <input ref={file} type="file" hidden accept=".xlsx,.xlsm,.csv,.txt" onChange={(e) => { e.target.files[0] && upload(e.target.files[0]); e.target.value = '' }} />
        <Button icon="add" onClick={() => setEdit({})}>{t('New entry')}</Button>
      </div>
      <p className="md-typescale-body-small muted">{t('Import columns (names in German or English): Description/Beschreibung, Unit/Einheit, Price/EP are required; optional: Source/Quelle, Date/Preisstand, Region, Wages/Lohn, Materials/Material, Plant/Geräte, Note/Bemerkung.')}</p>
      <div className="tblwrap" style={{ maxHeight: 560 }}>
        <table className="tbl">
          <thead><tr><th>{t('Description')}</th><th>{t('Unit')}</th><th className="right">{t('Price')}</th><th className="right">{t('Adjusted today')}</th><th>{t('Source')}</th><th>{t('Price date')}</th><th /></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td style={{ maxWidth: 380 }}>{e.description}{e.note && <div className="md-typescale-body-small muted">{e.note}</div>}</td>
                <td>{e.unit}</td><td className="num">{fmt(e.price)}</td><td className="num"><b>{fmt(e.adjusted_price)}</b></td>
                <td className="md-typescale-body-small">{e.source}{e.region && ` · ${e.region}`}</td><td className="md-typescale-body-small nowrap">{e.price_date}</td>
                <td className="right nowrap"><IconButton icon="edit" label={t('Edit catalog entry')} onClick={() => setEdit(e)} /><IconButton icon="delete" label={t('Delete')} onClick={() => setDel(e)} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="center muted" style={{ padding: 32 }}>{data.entries.length ? t('No entries match the search.') : t('The catalog is empty. Add entries, import a price list, or accept suggestions learned from your projects.')}</td></tr>}
          </tbody>
        </table>
      </div>
      <EntryDialog open={!!edit} entry={edit?.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />
      <ConfirmDialog open={!!del} title={t('Delete catalog entry?')} text={del ? del.description : ''} onClose={() => setDel(null)}
        onConfirm={async () => { try { await api.catalog.remove(del.id); setDel(null); reload() } catch (e) { setError(e); setDel(null) } }} />
    </div>
  )
}

function Suggestions({ reload, setError }) {
  const { t } = useI18n()
  const [s, setS] = useState(null)
  const [pick, setPick] = useState({})
  const [log, setLog] = useState([])
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => { setS(null); api.catalog.suggestions().then((r) => { setS(r); setPick({}) }).catch(setError); api.catalog.log().then(setLog).catch(() => {}) }, [setError])
  useEffect(() => { load() }, [load])
  if (!s) return <div className="center" style={{ padding: 48 }}><CircularProgress indeterminate /></div>
  const all = [...s.update, ...s.new]
  const chosen = all.filter((x) => pick[x.key])
  const accept = async () => { try { const r = await api.catalog.accept(chosen); setMsg(t('{a} entries added, {u} prices updated.', { a: r.added, u: r.updated })); reload(); load() } catch (e) { setError(e) } }
  const reject = async () => { try { await api.catalog.reject(chosen.map((x) => x.key)); load() } catch (e) { setError(e) } }
  const row = (x) => (
    <label key={x.key} className="row" style={{ flexWrap: 'nowrap', padding: '6px 0', borderTop: '1px solid var(--md-sys-color-outline-variant)' }}>
      <Checkbox checked={!!pick[x.key]} onValue={(v) => setPick((p) => ({ ...p, [x.key]: v }))} aria-label={x.description} />
      <span className="grow"><b>{x.description}</b><span className="md-typescale-body-small muted" style={{ display: 'block' }}>{t('{n} prices seen', { n: x.n })} · {x.sources.join(', ')}</span></span>
      <span className="num nowrap">{x.kind === 'update' ? <>{fmt(x.current_price)} → <b>{fmt(x.price)}</b> <span className={`chip ${Math.abs(x.diff_pct) > 25 ? 'check' : 'neutral'}`}>{x.diff_pct > 0 ? '+' : ''}{fmt(x.diff_pct, 1)} %</span></> : <b>{fmt(x.price)}</b>} / {x.unit}</span>
    </label>
  )
  return (
    <div className="col">
      <Banner>{t('Calex compares the priced files of your projects with the catalog and proposes changes. Nothing changes until you accept it, and every accepted change is logged with its source.')}</Banner>
      {msg && <Banner kind="ok" onClose={() => setMsg(null)}>{msg}</Banner>}
      <KpiRow><Kpi value={s.update_total} label={t('price differences')} /><Kpi value={s.new_total} label={t('new items')} /><Kpi value={chosen.length} label={t('selected')} /></KpiRow>
      <div className="row">
        <Button icon="done_all" disabled={!chosen.length} onClick={accept}>{t('Accept selected')}</Button>
        <Button variant="text" icon="block" disabled={!chosen.length} onClick={reject}>{t('Reject selected')}</Button>
        <Button variant="text" icon="select_all" onClick={() => setPick(Object.fromEntries(all.map((x) => [x.key, true])))}>{t('Select all shown')}</Button>
        <Button variant="text" icon="refresh" onClick={load}>{t('Check again')}</Button>
      </div>
      <div className="card">
        <h3 className="md-typescale-title-medium">{t('Price differences')} ({s.update_total})</h3>
        {s.update.length === 0 && <p className="muted mt8">{t('No differences above 10 %.')}</p>}
        {s.update.map(row)}
      </div>
      <div className="card">
        <h3 className="md-typescale-title-medium">{t('New items not in the catalog')} ({s.new_total})</h3>
        {s.new.length === 0 && <p className="muted mt8">{t('Nothing new. Add priced bids or awards to your projects to learn from them.')}</p>}
        {s.new.map(row)}
        {s.new_total > s.new.length && <p className="md-typescale-body-small muted mt8">{t('Showing the {n} most frequent. Accept some, and more appear.', { n: s.new.length })}</p>}
      </div>
      <div className="card">
        <h3 className="md-typescale-title-medium mb8">{t('Change log')}</h3>
        {log.length === 0 && <p className="muted">{t('No changes yet.')}</p>}
        {log.slice(0, 15).map((l) => <div key={l.id} className="md-typescale-body-small" style={{ padding: '3px 0' }}><span className="muted">{fmtDate(l.at)}</span> · <b>{t(l.action)}</b> · {l.detail} <span className="muted">({l.source})</span></div>)}
      </div>
    </div>
  )
}

function Adjustments({ data, reload, setError }) {
  const { t } = useI18n()
  const [yr, setYr] = useState(String(data.settings.yearly_increase_pct).replace('.', ','))
  const [rf, setRf] = useState(String(data.settings.region_factor).replace('.', ','))
  const [oldIdx, setOldIdx] = useState('')
  const [newIdx, setNewIdx] = useState('')
  const [ok, setOk] = useState(false)
  const calc = num(oldIdx) && num(newIdx) ? ((num(newIdx) / num(oldIdx) - 1) * 100) : null
  const save = async () => { try { await api.catalog.settings({ yearly_increase_pct: num(yr) || 0, region_factor: num(rf) || 1 }); setOk(true); reload() } catch (e) { setError(e) } }
  return (
    <div className="col">
      <Banner>{t('Old prices are brought to today\'s level: price × (1 + yearly increase) ^ years since the price date × regional factor. The result is shown as "Adjusted today" and used for hints and estimates.')}</Banner>
      <div className="card">
        <div className="row">
          <TextField label={t('Yearly price increase (%)')} value={yr} onValue={(v) => { setYr(v); setOk(false) }} inputmode="decimal" style={{ width: 220 }} />
          <TextField label={t('Regional factor')} value={rf} onValue={(v) => { setRf(v); setOk(false) }} inputmode="decimal" style={{ width: 180 }} />
          <Button icon="save" onClick={save}>{t('Save')}</Button>
          {ok && <span style={{ color: 'var(--md-sys-color-primary)' }}>✓ {t('Saved')}</span>}
        </div>
        <p className="md-typescale-body-small muted mt8">{t('1.00 means no regional difference (for example 1.08 for a region that is 8 % more expensive).')}</p>
      </div>
      <div className="card">
        <h3 className="md-typescale-title-medium mb8">{t('Work out the yearly increase from a price index')}</h3>
        <p className="muted mb8">{t('Official construction price indices are published for free by the German Federal Statistical Office (Destatis, GENESIS-Online, theme 61261, licence Data Licence Germany – Attribution 2.0). Enter the index value at the date of your old prices and today\'s value. Calex does not fetch the index automatically yet.')}</p>
        <div className="row">
          <TextField label={t('Index at the price date')} value={oldIdx} onValue={setOldIdx} inputmode="decimal" style={{ width: 200 }} />
          <TextField label={t('Index today')} value={newIdx} onValue={setNewIdx} inputmode="decimal" style={{ width: 200 }} />
          {calc != null && <><b>{calc >= 0 ? '+' : ''}{fmt(calc, 1)} %</b><Button variant="tonal" onClick={() => { setYr(String(Math.round(calc * 10) / 10).replace('.', ',')); setOk(false) }}>{t('Use as yearly increase')}</Button></>}
        </div>
        <p className="mt8"><a href="https://www.destatis.de/DE/Themen/Wirtschaft/Preise/Baupreise-Immobilienpreisindex/_inhalt.html" target="_blank" rel="noreferrer">{t('Open the Destatis construction price indices')}</a></p>
      </div>
      <div className="card">
        <h3 className="md-typescale-title-medium mb8">{t('Where to find price data')}</h3>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>{t('Destatis GENESIS-Online: official construction price indices, free (for the adjustments above).')}</li>
          <li>{t('Price books such as BKI, STLB-Bau or the Rudolf Müller Baupreise are commercial: export them to Excel or CSV and import them here if you hold a licence.')}</li>
          <li>{t('Heinze Baupreisinfo shows free reference prices on its website; check its terms before copying values.')}</li>
          <li>{t('Your own earlier bids and awards are the best source: put them in projects and accept the suggestions.')}</li>
        </ul>
      </div>
    </div>
  )
}

export default function CatalogPage({ tab }) {
  const { t } = useI18n()
  const TABS = ['entries', 'suggestions', 'adjustments']
  const idx = Math.max(0, TABS.indexOf(tab))
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const reload = useCallback(() => api.catalog.list().then(setData).catch(setError), [])
  useEffect(() => { reload() }, [reload])
  return (
    <>
      <h1 className="md-typescale-headline-medium mb16">{t('Price catalog')}</h1>
      <ErrorBox error={error} onClose={() => setError(null)} />
      <TabsEl activeTabIndex={idx} onChange={(e) => go('catalog', TABS[e.target.activeTabIndex])} style={{ marginBottom: 16 }}>
        <PrimaryTab>{t('Catalog')}</PrimaryTab><PrimaryTab>{t('Suggestions from projects')}</PrimaryTab><PrimaryTab>{t('Adjustments')}</PrimaryTab>
      </TabsEl>
      {!data ? <div className="center" style={{ padding: 48 }}><CircularProgress indeterminate /></div> : (
        <>
          {idx === 0 && <CatalogTab data={data} reload={reload} setError={setError} />}
          {idx === 1 && <Suggestions reload={reload} setError={setError} />}
          {idx === 2 && <Adjustments key={JSON.stringify(data.settings)} data={data} reload={reload} setError={setError} />}
        </>
      )}
    </>
  )
}
