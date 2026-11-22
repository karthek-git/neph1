import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { Banner, Button, Checkbox, Dialog, ErrorBox, Icon, IconButton, LinearProgress, TextField } from '../m3/ui.jsx'
import { fmt, fmtDate } from '../common.jsx'
import { AutoPanel, RunChecklist, useAutoRun } from './AutoRun.jsx'
import { ConsentDialog, SourceChip, StatusChip, hasConsent } from './ParsedItems.jsx'

function SamplesDialog({ open, onClose, pid, onAdded }) {
  const { t } = useI18n()
  const [all, setAll] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (open) { setSel([]); setQ(''); setError(null); api.samples().then(setAll).catch(setError) } }, [open])
  const shown = useMemo(() => all.filter((n) => n.toLowerCase().includes(q.toLowerCase())), [all, q])
  const add = async () => {
    setBusy(true)
    try { await api.files.addSamples(pid, sel); onAdded(); onClose() } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title={t('Add files from the challenge dataset')} width={720}
      actions={<><Button variant="text" onClick={onClose}>{t('Cancel')}</Button><Button variant="text" disabled={!sel.length || busy} onClick={add}>{t('Add {n} files', { n: sel.length })}</Button></>}>
      <TextField label={t('Search')} placeholder={t('Search…')} value={q} onValue={setQ} style={{ width: '100%' }}><Icon slot="leading-icon" name="search" /></TextField>
      <ErrorBox error={error} />
      <div style={{ maxHeight: 380, overflow: 'auto', marginTop: 8 }}>
        {shown.map((n) => (
          <label key={n} className="row" style={{ flexWrap: 'nowrap', padding: '4px 0', cursor: 'pointer' }}>
            <Checkbox checked={sel.includes(n)} onValue={(v) => setSel((s) => (v ? [...s, n] : s.filter((x) => x !== n)))} aria-label={`${t('Select')} ${n.split('/').pop()}`} />
            <span className="grow"><span className="ellipsis" style={{ display: 'block' }}>{n.split('/').pop()}</span><span className="md-typescale-body-small muted ellipsis" style={{ display: 'block' }}>{n.split('/').slice(0, -1).join(' / ')}</span></span>
          </label>
        ))}
        {shown.length === 0 && <p className="muted" style={{ padding: 16 }}>{t('No samples found.')}</p>}
      </div>
    </Dialog>
  )
}

function NoteInput({ pid, fid, value, onSaved }) {
  const { t } = useI18n()
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <input className="cellin" style={{ marginTop: 4, minWidth: 140 }} aria-label={t('Version note')} placeholder={t('Note, e.g. after client answers')} value={v} maxLength={200}
    onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && api.fileNote(pid, fid, v).then(onSaved)} />
}

export default function FilesTab({ pid, files, loadFiles, loadAnalyses, loadProject, setError }) {
  const { t } = useI18n()
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const [selected, setSelected] = useState(null)   // null = all readable files
  const [useLlm, setUseLlm] = useState(true)
  const [llmAvailable, setLlmAvailable] = useState(true)
  const [samples, setSamples] = useState(false)
  const [hasSamples, setHasSamples] = useState(false)
  const [needConsent, setNeedConsent] = useState(null)   // failed files waiting for the one-time AI consent
  const [autoOn, setAutoOnState] = useState(() => { try { return localStorage.getItem('calex-auto-run') === '1' } catch { return false } })
  const [groups, setGroups] = useState([])
  const input = useRef(null)
  const loadVersions = () => api.versions(pid).then(setGroups).catch(() => setGroups([]))
  const vsig = files.map((f) => `${f.id}:${f.items}:${f.phase}:${f.error}`).join('|')
  useEffect(() => { if (files.length) loadVersions(); else setGroups([]) }, [pid, vsig]) // eslint-disable-line
  const vmap = Object.fromEntries(groups.flatMap((g) => g.versions.map((v) => [v.file_id, v])))
  const groupSize = Object.fromEntries(groups.flatMap((g) => g.versions.map((v) => [v.file_id, g.versions.filter((x) => !x.duplicate).length])))
  const ungrouped = files.filter((f) => !vmap[f.id])
  const auto = useAutoRun({ pid, useLlm, onDone: () => { loadAnalyses(); loadProject() } })
  const setAutoOn = (v) => { setAutoOnState(v); try { localStorage.setItem('calex-auto-run', v ? '1' : '0') } catch { /* ignore */ } }

  useEffect(() => {
    api.status().then((s) => { setLlmAvailable(s.llm_available); if (!s.llm_available) setUseLlm(false) }).catch(() => {})
    api.samples().then((s) => setHasSamples(s.length > 0)).catch(() => {})
  }, [])

  const readable = files.filter((f) => !f.error)
  // Tender files are ticked by default: a bid or award is the same BoQ at a later stage, so analysing it too would count every item twice.
  const tenders = readable.filter((f) => f.phase === 'tender')
  const defaults = (tenders.length ? tenders : readable).map((f) => f.id)
  const chosen = selected === null ? defaults : selected.filter((id) => readable.some((f) => f.id === id))
  const toggle = (id) => setSelected((s) => { const cur = s === null ? defaults : s; return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })

  const upload = async (list) => {
    if (!list.length) return
    setBusy(t('Uploading…')); setNotice(null)
    try {
      const r = await api.files.upload(pid, list)
      const msgs = (r.rejected || []).map((x) => `${x.name}: ${x.error}`)
      loadFiles(); loadProject()
      if (msgs.length) setNotice(msgs.join(' · '))
      loadFiles(); loadProject()
      if (autoOn && r.files?.length && !(r.files || []).some((f) => f.status === 'failed' && llmAvailable)) auto.start()
    } catch (e) { setError(e) } finally { setBusy('') }
  }
  // a file the parser could not read: the AI tries it automatically, once per file (after a one-time consent)
  useEffect(() => {
    if (!llmAvailable) return
    const seen = (id) => { try { return sessionStorage.getItem('calex-tried-' + id) === '1' } catch { return false } }
    const todo = files.filter((f) => f.status === 'failed' && !seen(f.id))
    if (!todo.length) return
    todo.forEach((f) => { try { sessionStorage.setItem('calex-tried-' + f.id, '1') } catch { /* ignore */ } })
    if (hasConsent()) {
      extractAll(todo).then((msgs) => { setNotice(msgs.join(' · ')); loadFiles(); loadProject(); if (autoOn) auto.start() }).finally(() => setBusy(''))
    } else setNeedConsent(todo)
  }, [files, llmAvailable]) // eslint-disable-line
  const extractAll = async (list) => {
    const out = []
    for (const f of list) {
      setBusy(t('The parser could not read {name}. The AI is extracting its items…', { name: f.name }))
      try {
        const d = await api.files.extract(pid, f.id)
        out.push(t('{name}: the AI extracted {k} items ({d} dropped because they did not match the text). Please check them in Items.', { name: f.name, k: d.stats.kept, d: d.stats.dropped }))
      } catch (e) { out.push(`${f.name}: ${e.message}`) }
    }
    return out
  }
  const afterConsent = async () => {
    const list = needConsent; setNeedConsent(null); setBusy(' ')
    try { const msgs = await extractAll(list); setNotice(msgs.join(' · ')); loadFiles(); loadProject(); if (autoOn) auto.start() } finally { setBusy('') }
  }
  const remove = async (f) => { try { await api.files.remove(pid, f.id); loadFiles(); loadProject() } catch (e) { setError(e) } }
  return (
    <div className="col" style={{ gap: 24 }}>
      <div className={`dropzone ${over ? 'over' : ''}`} role="button" tabIndex={0}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]) }}
        onClick={() => input.current?.click()} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}>
        <input ref={input} type="file" multiple hidden accept=".x83,.x84,.x86,.d83,.d84,.d86,.xml,.pdf,.xlsx,.xlsm,.docx" onChange={(e) => { upload([...e.target.files]); e.target.value = '' }} />
        <Icon name="upload_file" />
        <h2 className="md-typescale-title-large">{t('Drop BoQ files here or click to choose')}</h2>
        <p className="muted">{t('GAEB (X83, X84, X86, D83, D84, D86), PDF, Excel (.xlsx) or Word (.docx). Several files at once are fine.')}</p>
        {hasSamples && <div className="mt8" onClick={(e) => e.stopPropagation()}><Button variant="text" icon="library_add" onClick={() => setSamples(true)}>{t('Add from the challenge dataset')}</Button></div>}
      </div>
      {busy && <div><LinearProgress indeterminate /><p className="muted mt8">{busy}</p></div>}
      <AutoPanel auto={auto} />
      {notice && <Banner kind="warn" onClose={() => setNotice(null)}>{notice}</Banner>}

      {files.length === 0 ? (
        <p className="muted center" style={{ padding: 24 }}>{t('No files yet. Upload the BoQ files of this tender to get started.')}</p>
      ) : (
        <>
          <RunChecklist pid={pid} files={files} auto={auto} useLlm={useLlm} setUseLlm={setUseLlm} llmAvailable={llmAvailable}
            chosenIds={chosen} selectionChanged={selected !== null} autoOn={autoOn} setAutoOn={setAutoOn} />

          <div className="tblwrap">
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 56 }}><Checkbox checked={readable.length > 0 && chosen.length === readable.length} indeterminate={chosen.length > 0 && chosen.length < readable.length}
                  onValue={(v) => setSelected(v ? readable.map((f) => f.id) : [])} aria-label={t('Select all files')} /></th>
                <th>{t('File')}</th><th>{t('Version')}</th><th>{t('Phase')}</th><th>{t('Reading')}</th><th className="right">{t('Items')}</th><th className="right">{t('Total (EUR)')}</th><th>{t('Added')}</th><th />
              </tr></thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.stage + g.name}>
                    <tr className="grouphead"><td colSpan={9}><span className="tag filled">{t(g.stage)}</span> <b>{g.name}</b> <span className="muted md-typescale-body-small">{g.versions.length > 1 ? t('{n} versions', { n: g.versions.length }) : ''}</span></td></tr>
                    {g.versions.map((v) => files.filter((x) => x.id === v.file_id).map((f) => (
                  <tr key={f.id}>
                    <td><Checkbox disabled={!!f.error} checked={chosen.includes(f.id)} onValue={() => toggle(f.id)} aria-label={`${t('Select')} ${f.name}`} /></td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{f.name}</div>
                      <div className="md-typescale-body-small muted">{(f.size / 1024).toFixed(0)} KB</div>
                      {f.error && <div className="md-typescale-body-small row gap8" style={{ color: 'var(--md-sys-color-error)' }}><Icon name="error" style={{ fontSize: 16 }} />{f.error}</div>}
                    </td>
                    <td>
                      {vmap[f.id] && vmap[f.id].number > 0 && <div className="row gap8"><span className="tag filled">v{vmap[f.id].number} · {t(vmap[f.id].tag)}</span>{vmap[f.id].current && groupSize[f.id] > 1 && <span className="chip ok">{t('Current')}</span>}</div>}
                      {vmap[f.id]?.tag === 'Duplicate' && <span className="chip check">{t('Duplicate')}</span>}
                      <NoteInput pid={pid} fid={f.id} value={vmap[f.id]?.note || ''} onSaved={loadVersions} />
                    </td>
                    <td>{f.phase && <span className="tag">{t(f.phase)}</span>}</td>
                    <td>
                      <div className="row gap8"><StatusChip f={f} /><SourceChip f={f} /></div>
                      <div className="row gap8 mt8">
                        {f.items > 0 && <Button variant="text" icon="table_rows" onClick={() => go('p', pid, 'items', f.id)}>{t('Review items')}</Button>}
                        {f.status === 'failed' && <Button variant="text" icon="auto_awesome" onClick={() => go('p', pid, 'items', f.id)}>{t('Fix or extract')}</Button>}
                      </div>
                    </td>
                    <td className="num">{f.items || ''}</td>
                    <td className="num">{fmt(f.total)}</td>
                    <td className="md-typescale-body-small muted nowrap">{fmtDate(f.uploaded)}</td>
                    <td className="right"><IconButton icon="delete" label={`${t('Remove file')} ${f.name}`} onClick={() => remove(f)} /></td>
                  </tr>
                    )))}
                  </Fragment>
                ))}
                {ungrouped.map((f) => (
                  <tr key={f.id}>
                    <td><Checkbox disabled={!!f.error} checked={chosen.includes(f.id)} onValue={() => toggle(f.id)} aria-label={`${t('Select')} ${f.name}`} /></td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{f.name}</div>
                      <div className="md-typescale-body-small muted">{(f.size / 1024).toFixed(0)} KB</div>
                      {f.error && <div className="md-typescale-body-small row gap8" style={{ color: 'var(--md-sys-color-error)' }}><Icon name="error" style={{ fontSize: 16 }} />{f.error}</div>}
                    </td>
                    <td>
                      {vmap[f.id] && vmap[f.id].number > 0 && <div className="row gap8"><span className="tag filled">v{vmap[f.id].number} · {t(vmap[f.id].tag)}</span>{vmap[f.id].current && groupSize[f.id] > 1 && <span className="chip ok">{t('Current')}</span>}</div>}
                      {vmap[f.id]?.tag === 'Duplicate' && <span className="chip check">{t('Duplicate')}</span>}
                      <NoteInput pid={pid} fid={f.id} value={vmap[f.id]?.note || ''} onSaved={loadVersions} />
                    </td>
                    <td>{f.phase && <span className="tag">{t(f.phase)}</span>}</td>
                    <td>
                      <div className="row gap8"><StatusChip f={f} /><SourceChip f={f} /></div>
                      <div className="row gap8 mt8">
                        {f.items > 0 && <Button variant="text" icon="table_rows" onClick={() => go('p', pid, 'items', f.id)}>{t('Review items')}</Button>}
                        {f.status === 'failed' && <Button variant="text" icon="auto_awesome" onClick={() => go('p', pid, 'items', f.id)}>{t('Fix or extract')}</Button>}
                      </div>
                    </td>
                    <td className="num">{f.items || ''}</td>
                    <td className="num">{fmt(f.total)}</td>
                    <td className="md-typescale-body-small muted nowrap">{fmtDate(f.uploaded)}</td>
                    <td className="right"><IconButton icon="delete" label={`${t('Remove file')} ${f.name}`} onClick={() => remove(f)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ConsentDialog open={!!needConsent} onClose={() => setNeedConsent(null)} names={(needConsent || []).map((f) => f.name)} onAccept={afterConsent} />
      <SamplesDialog open={samples} onClose={() => setSamples(false)} pid={pid} onAdded={() => { loadFiles(); loadProject(); if (autoOn) auto.start() }} />
    </div>
  )
}
