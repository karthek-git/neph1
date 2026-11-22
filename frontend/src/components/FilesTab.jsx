import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { Banner, Button, Checkbox, Dialog, ErrorBox, Icon, IconButton, LinearProgress, Switch, TextField } from '../m3/ui.jsx'
import { fmt, fmtDate } from '../common.jsx'

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
  const input = useRef(null)

  useEffect(() => {
    api.status().then((s) => { setLlmAvailable(s.llm_available); if (!s.llm_available) setUseLlm(false) }).catch(() => {})
    api.samples().then((s) => setHasSamples(s.length > 0)).catch(() => {})
  }, [])

  const readable = files.filter((f) => !f.error)
  const chosen = selected === null ? readable.map((f) => f.id) : selected.filter((id) => readable.some((f) => f.id === id))
  const toggle = (id) => setSelected((s) => { const cur = s === null ? readable.map((f) => f.id) : s; return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })

  const upload = async (list) => {
    if (!list.length) return
    setBusy(t('Uploading…')); setNotice(null)
    try {
      const r = await api.files.upload(pid, list)
      if (r.rejected?.length) setNotice(r.rejected.map((x) => `${x.name}: ${x.error}`).join(' · '))
      loadFiles(); loadProject()
    } catch (e) { setError(e) } finally { setBusy('') }
  }
  const remove = async (f) => { try { await api.files.remove(pid, f.id); loadFiles(); loadProject() } catch (e) { setError(e) } }
  const analyse = async () => {
    setBusy(useLlm ? t('Analysing with AI. This can take up to a minute…') : t('Analysing…')); setError(null)
    try {
      const meta = await api.analyses.run(pid, { file_ids: chosen, use_llm: useLlm, title: chosen.length > 1 ? t('{n} files', { n: chosen.length }) : '' })
      loadAnalyses(); loadProject()
      go('p', pid, 'analyses', meta.id)
    } catch (e) { setError(e) } finally { setBusy('') }
  }

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
      {notice && <Banner kind="warn" onClose={() => setNotice(null)}>{notice}</Banner>}

      {files.length === 0 ? (
        <p className="muted center" style={{ padding: 24 }}>{t('No files yet. Upload the BoQ files of this tender to get started.')}</p>
      ) : (
        <>
          <div className="card filled">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="grow">
                <h2 className="md-typescale-title-large">{t('Run an analysis')}</h2>
                <p className="muted">{chosen.length > 1 ? t('{n} files are analysed together, so missing items across trades can be found.', { n: chosen.length }) : t('Select the files to analyse. Results are saved in this project.')}</p>
              </div>
              <label className="row gap8" title={llmAvailable ? '' : t('Set the AI API key on the server to enable this.')} style={{ opacity: llmAvailable ? 1 : 0.5 }}>
                <Switch selected={useLlm} disabled={!llmAvailable} onValue={setUseLlm} aria-label={t('AI text analysis')} />
                {t('AI text analysis')}
              </label>
              <Button icon="play_arrow" disabled={!chosen.length || !!busy} onClick={analyse}>{t('Analyse {n} files', { n: chosen.length })}</Button>
            </div>
          </div>

          <div className="tblwrap">
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 56 }}><Checkbox checked={readable.length > 0 && chosen.length === readable.length} indeterminate={chosen.length > 0 && chosen.length < readable.length}
                  onValue={(v) => setSelected(v ? readable.map((f) => f.id) : [])} aria-label={t('Select all files')} /></th>
                <th>{t('File')}</th><th>{t('Phase')}</th><th className="right">{t('Items')}</th><th className="right">{t('Total (EUR)')}</th><th>{t('Added')}</th><th />
              </tr></thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td><Checkbox disabled={!!f.error} checked={chosen.includes(f.id)} onValue={() => toggle(f.id)} aria-label={`${t('Select')} ${f.name}`} /></td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{f.name}</div>
                      <div className="md-typescale-body-small muted">{(f.size / 1024).toFixed(0)} KB</div>
                      {f.error && <div className="md-typescale-body-small row gap8" style={{ color: 'var(--md-sys-color-error)' }}><Icon name="error" style={{ fontSize: 16 }} />{f.error}</div>}
                    </td>
                    <td>{f.phase && <span className="tag">{t(f.phase)}</span>}</td>
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
      <SamplesDialog open={samples} onClose={() => setSamples(false)} pid={pid} onAdded={() => { loadFiles(); loadProject() }} />
    </div>
  )
}
