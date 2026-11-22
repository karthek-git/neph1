import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { Banner, Button, CircularProgress, Dialog, Icon, IconButton, LinearProgress, Option, Select, TextField } from '../m3/ui.jsx'
import { useWide } from '../common.jsx'

const PAGE = 100
const KINDS = ['normal', 'optional', 'alternative', 'surcharge', 'lump_sum', 'hourly']

export function StatusChip({ f }) {
  const { t } = useI18n()
  if (!f.status) return null
  const icon = { ok: 'check_circle', check: 'rule', failed: 'error' }[f.status]
  const text = { ok: t('Read well'), check: t('Please check'), failed: t('Could not read') }[f.status]
  return <span className={`chip ${f.status}`}><Icon name={icon} />{text}</span>
}

export function SourceChip({ f }) {
  const { t } = useI18n()
  if (!f.items) return null
  if (f.source === 'ai') return <span className={`chip ${f.confirmed ? 'neutral' : 'check'}`}><Icon name="auto_awesome" />{f.confirmed ? t('AI-extracted, confirmed') : t('AI-extracted, please check')}</span>
  return <span className="chip neutral"><Icon name="rule_settings" />{t('Read by the parser')}{f.edited ? ` · ${t('edited')}` : ''}</span>
}

// AI consent: the file text leaves this machine, so ask once.
export const AI_CONSENT_KEY = 'calex-ai-extract-ok'
export const hasConsent = () => { try { return localStorage.getItem(AI_CONSENT_KEY) === '1' } catch { return false } }
export const giveConsent = () => { try { localStorage.setItem(AI_CONSENT_KEY, '1') } catch { /* ignore */ } }

export function ConsentDialog({ open, onClose, onAccept, names = [] }) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onClose={onClose} title={t('Send file text to the AI service?')} width={520}
      actions={<><Button variant="text" onClick={onClose}>{t('Not now')}</Button><Button variant="text" onClick={() => { giveConsent(); onAccept() }}>{t('Allow and extract')}</Button></>}>
      <p>{t('The normal parser could not read some files. The AI can try to extract their items, but this sends the text of the file to the AI service.')}</p>
      {names.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>{names.map((n) => <li key={n}>{n}</li>)}</ul>}
      <p className="muted mt8">{t('Every item the AI returns is checked against the file text. Items that do not match are dropped, and the rest stay marked "please check" until you confirm them.')}</p>
    </Dialog>
  )
}

export default function ParsedItems({ pid, files, aid: fidParam, loadFiles, loadProject, setError }) {
  const { t } = useI18n()
  const wide = useWide()
  const withItems = files.filter((f) => f.items > 0 || f.status === 'failed' || f.error)
  const fid = fidParam && files.some((f) => f.id === fidParam) ? fidParam : withItems[0]?.id
  const [data, setData] = useState(null)
  const [rows, setRows] = useState([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState({})
  const [src, setSrc] = useState(null)
  const [showSrc, setShowSrc] = useState(false)
  const [consent, setConsent] = useState(false)
  const [note, setNote] = useState(null)

  const apply = useCallback((d) => { setData(d); setRows(d.items.map((r, i) => ({ ...r, _k: `${i}-${Math.random()}` }))); setDirty(false) }, [])
  useEffect(() => {
    if (!fid) { setData(null); return }
    setData(null); setSrc(null); setPage(1); setQ(''); setOpen({}); setNote(null)
    api.files.items(pid, fid).then(apply).catch(setError)
  }, [pid, fid, apply, setError])
  useEffect(() => { if (showSrc && fid && !src) api.files.source(pid, fid).then(setSrc).catch(setError) }, [showSrc, fid, src, pid, setError])

  const refresh = () => { loadFiles(); loadProject() }
  const run = async (label, fn) => {
    setBusy(label); setError(null)
    try { const d = await fn(); if (d) apply(d); refresh(); return d } catch (e) { setError(e) } finally { setBusy('') }
  }
  const edit = (k, field, v) => { setRows((r) => r.map((x) => (x._k === k ? { ...x, [field]: v } : x))); setDirty(true) }
  const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))
  const save = () => run(t('Saving…'), () => api.files.putItems(pid, fid, rows.map(({ _k, text, ...r }) => ({
    ...r, quantity: num(r.quantity), unit_price: num(r.unit_price), total_price: num(r.total_price) }))))
  const del = (k) => { setRows((r) => r.filter((x) => x._k !== k)); setDirty(true) }
  const add = () => { setRows((r) => [...r, { _k: `n-${Date.now()}`, oz: '', short_text: '', long_text: '', quantity: null, unit: '', unit_price: null, total_price: null, kind: 'normal' }]); setDirty(true); setQ(''); setPage(Math.ceil((rows.length + 1) / PAGE)) }
  const extract = async () => {
    const d = await run(t('The AI is reading the file…'), () => api.files.extract(pid, fid))
    if (d?.stats) setNote(t('The AI extracted {k} items. {d} did not match the file text and were dropped. Please check them, then confirm.', { k: d.stats.kept, d: d.stats.dropped }))
  }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? rows.filter((r) => `${r.oz} ${r.short_text} ${r.unit}`.toLowerCase().includes(s)) : rows
  }, [rows, q])
  const f = data?.file
  const missing = (fn) => rows.filter(fn).length

  if (!withItems.length) {
    return <p className="muted center" style={{ padding: 32 }}>{t('No parsed items yet. Upload a BoQ in the Files tab first.')}</p>
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div>
        <h2 className="md-typescale-headline-small">{t('Items · common format')}</h2>
        <p className="muted">{t('What Calex read from each file, in one format you can edit.')}</p>
      </div>
      <div className="row">
        <Select label={t('File')} value={fid} onValue={(v) => go('p', pid, 'items', v)} style={{ minWidth: 280, maxWidth: '100%' }}>
          {withItems.map((x) => <Option key={x.id} value={x.id}>{x.name}</Option>)}
        </Select>
        {f && <><StatusChip f={f} /><SourceChip f={f} /></>}
        <span className="grow" />
        {f && <Button variant="text" icon="description" onClick={() => setShowSrc((v) => !v)}>{showSrc ? t('Hide original text') : t('Show original text')}</Button>}
      </div>

      {busy && <div><LinearProgress indeterminate /><p className="muted mt8">{busy}</p></div>}
      {!data && !busy && <div className="center" style={{ padding: 48 }}><CircularProgress indeterminate /></div>}
      {note && <Banner kind="info" onClose={() => setNote(null)}>{note}</Banner>}

      {f && (
        <>
          {f.status === 'failed' && (
            <Banner kind="error">
              <b>{t('This file could not be read by the parser.')}</b> {f.error}
              <div className="row mt8">
                {data?.ai_available
                  ? <Button variant="tonal" icon="auto_awesome" disabled={!!busy} onClick={() => (hasConsent() ? extract() : setConsent(true))}>{t('Extract with AI')}</Button>
                  : <span className="muted">{t('The AI is not configured on the server, so only manual entry is possible.')}</span>}
              </div>
            </Banner>
          )}
          {f.source === 'ai' && !f.confirmed && (
            <Banner kind="warn">
              <b>{t('These items were extracted by AI and are not confirmed.')}</b> {t('Check them against the original text, correct anything that is wrong, then confirm. An analysis can still run, but its report will carry a warning.')}
              <div className="row mt8"><Button icon="done_all" disabled={!!busy || dirty} onClick={() => run(t('Confirming…'), () => api.files.confirm(pid, fid))}>{t('Confirm items')}</Button>{dirty && <span className="muted">{t('Save your changes first.')}</span>}</div>
            </Banner>
          )}
          {(f.warnings || []).filter((w) => f.status !== 'failed').length > 0 && (
            <Banner kind="warn"><b>{t('Quality notes')}</b><ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>{f.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Banner>
          )}
          {f.status === 'check' && f.source === 'parser' && (
            <div className="row"><span className="muted">{t('The parser read this file, but some values look incomplete. You can fix them below, or try the AI on the original text.')}</span>
              {data?.ai_available && <Button variant="text" icon="auto_awesome" disabled={!!busy} onClick={() => (hasConsent() ? extract() : setConsent(true))}>{t('Re-read with AI')}</Button>}</div>
          )}

          <div className="row">
            <TextField label={t('Search items')} placeholder={t('Number, text or unit')} value={q} onValue={(v) => { setQ(v); setPage(1) }} style={{ minWidth: 240 }}><Icon slot="leading-icon" name="search" /></TextField>
            <span className="muted">{t('{n} items', { n: rows.length })} · {t('{n} without quantity', { n: missing((r) => r.quantity == null && r.kind !== 'lump_sum') })} · {t('{n} without unit', { n: missing((r) => !r.unit && r.kind !== 'lump_sum') })}</span>
            <span className="grow" />
            <Button variant="text" icon="add" onClick={add}>{t('Add item')}</Button>
            <Button variant="text" icon="restart_alt" disabled={!!busy} onClick={() => run(t('Reading the original file again…'), () => api.files.reparse(pid, fid))}>{t('Re-parse original')}</Button>
            <Button icon="save" disabled={!dirty || !!busy} onClick={save}>{t('Save changes')}</Button>
          </div>

          <div className={`split ${showSrc && wide ? 'two' : ''}`}>
            <div className="tblwrap" style={{ maxHeight: '70vh' }}>
              <table className="tbl" style={{ minWidth: 960 }}>
                <thead><tr>
                  <th style={{ width: 130 }}>{t('Item no.')}</th><th>{t('Short text')}</th><th style={{ width: 100 }} className="right">{t('Quantity')}</th>
                  <th style={{ width: 80 }}>{t('Unit')}</th><th style={{ width: 110 }} className="right">{t('Unit price')}</th><th style={{ width: 120 }} className="right">{t('Total')}</th>
                  <th style={{ width: 130 }}>{t('Type')}</th><th style={{ width: 96 }} />
                </tr></thead>
                <tbody>
                  {shown.slice(0, page * PAGE).map((r) => (
                    <FragmentRow key={r._k} r={r} edit={edit} del={del} open={!!open[r._k]} toggle={() => setOpen((o) => ({ ...o, [r._k]: !o[r._k] }))} t={t} />
                  ))}
                </tbody>
              </table>
              {shown.length > page * PAGE && <div className="center" style={{ padding: 12 }}><Button variant="text" onClick={() => setPage((p) => p + 1)}>{t('Show more ({n} left)', { n: shown.length - page * PAGE })}</Button></div>}
              {shown.length === 0 && <p className="muted center" style={{ padding: 24 }}>{rows.length ? t('No items match the search.') : t('No items yet. Add one, or use the AI extraction above.')}</p>}
            </div>
            {showSrc && (
              <aside className="srcpane" aria-label={t('Original text')}>
                <div className="row mb8"><b className="grow">{t('Original text')}</b><IconButton icon="close" label={t('Hide original text')} onClick={() => setShowSrc(false)} /></div>
                {src ? <pre>{src.text}{src.truncated ? '\n…' : ''}</pre> : <CircularProgress indeterminate />}
              </aside>
            )}
          </div>
        </>
      )}
      <ConsentDialog open={consent} onClose={() => setConsent(false)} names={f ? [f.name] : []} onAccept={() => { setConsent(false); extract() }} />
    </div>
  )
}

function FragmentRow({ r, edit, del, open, toggle, t }) {
  const inp = (field, cls = '', ph) => <input className={`cellin ${cls}`} aria-label={`${t(field)} ${r.oz}`} placeholder={ph} value={r[field] ?? ''} onChange={(e) => edit(r._k, field, e.target.value)} />
  return (
    <>
      <tr>
        <td>{inp('oz')}</td>
        <td>{inp('short_text')}</td>
        <td>{inp('quantity', 'num')}</td>
        <td>{inp('unit')}</td>
        <td>{inp('unit_price', 'num')}</td>
        <td>{inp('total_price', 'num')}</td>
        <td>
          <select className="cellin" aria-label={`${t('Type')} ${r.oz}`} value={r.kind} onChange={(e) => edit(r._k, 'kind', e.target.value)}>
            {KINDS.map((k) => <option key={k} value={k}>{t(k)}</option>)}
          </select>
        </td>
        <td className="right nowrap">
          <IconButton icon={open ? 'expand_less' : 'notes'} label={t('Long text')} onClick={toggle} />
          <IconButton icon="delete" label={`${t('Remove item')} ${r.oz}`} onClick={() => del(r._k)} />
        </td>
      </tr>
      {open && <tr className="detail"><td colSpan={8}><textarea className="cellin" aria-label={`${t('Long text')} ${r.oz}`} value={r.long_text || ''} onChange={(e) => edit(r._k, 'long_text', e.target.value)} /></td></tr>}
    </>
  )
}
