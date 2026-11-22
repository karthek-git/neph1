import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { emitChange } from '../bus.js'
import { useI18n } from '../i18n.jsx'
import { Button, CircularProgress, Dialog, ErrorBox, Fab, Icon, IconButton, LinearProgress, TextField } from '../m3/ui.jsx'
import { fmtDate } from '../common.jsx'
import { ConsentDialog, hasConsent } from './ParsedItems.jsx'

export function NewProjectDialog({ open, onClose, onCreated }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (open) { setName(''); setDescription(''); setError(null) } }, [open])
  const submit = async () => {
    if (!name.trim()) { setError(new Error(t('Please enter a project name.'))); return }
    setBusy(true)
    try { onCreated(await api.projects.create(name.trim(), description.trim())) } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title={t('New project')}
      actions={<><Button variant="text" onClick={onClose}>{t('Cancel')}</Button><Button variant="text" onClick={submit} disabled={busy}>{t('Create')}</Button></>}>
      <p className="muted mb16">{t('A project holds all the BoQ files of one tender. You can run analyses on them at any time.')}</p>
      <div className="col" style={{ gap: 16 }}>
        <TextField label={t('Project name')} required value={name} onValue={setName} placeholder={t('e.g. Training centre and office building')}
          onKeyDown={(e) => e.key === 'Enter' && submit()} style={{ width: '100%' }} />
        <TextField label={t('Description (optional)')} type="textarea" rows={3} value={description} onValue={setDescription} style={{ width: '100%' }} />
      </div>
      <ErrorBox error={error} />
    </Dialog>
  )
}

export function ConfirmDialog({ open, title, text, confirmLabel, onClose, onConfirm }) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onClose={onClose} title={title} width={440}
      actions={<><Button variant="text" onClick={onClose}>{t('Cancel')}</Button><Button variant="text" onClick={onConfirm}>{confirmLabel || t('Delete')}</Button></>}>
      <p>{text}</p>
    </Dialog>
  )
}

export default function ProjectsPage() {
  const { t } = useI18n()
  const [projects, setProjects] = useState(null)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [fieldError, setFieldError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [all, setAll] = useState(false)
  const [over, setOver] = useState(false)
  const [uploading, setUploading] = useState('')
  const [filter, setFilter] = useState('')
  const input = useRef(null)
  const picker = useRef(null)
  const folder = useRef(null)
  const [imp, setImp] = useState(null)          // import progress / summary
  const [consent, setConsent] = useState(null)  // pending import waiting for the one-time AI consent
  const RECENT = 6

  const load = () => api.projects.list().then(setProjects).catch(setError)
  useEffect(() => { load(); input.current?.focus() }, [])

  const create = async () => {
    if (!name.trim()) { setFieldError(true); input.current?.focus(); return }
    setBusy(true); setError(null)
    try { const p = await api.projects.create(name.trim(), ''); emitChange(); go('p', p.id) } catch (e) { setError(e); setBusy(false) }
  }
  // second way to start: drop the files, the project is created from them and named after the first file (or the typed name)
  const startFromFiles = async (list) => {
    if (!list.length) return
    const stem = list[0].name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || t('New project')
    setUploading(t('Creating the project and reading {n} file(s)…', { n: list.length })); setError(null)
    let p = null
    try {
      p = await api.projects.create((name.trim() || stem).slice(0, 120), '')
      await api.files.upload(p.id, list)
      emitChange(); go('p', p.id, 'files')
    } catch (e) {
      setError(e)
      if (p) { emitChange(); go('p', p.id, 'files') }       // project exists even if every file was rejected
    } finally { setUploading('') }
  }
  // Import past projects: each sub-folder becomes a project (named after the folder), loose files go into "Pre-Calex".
  // Files are fully processed (parse, AI fallback for unreadable ones, quality check, stored). No risk analysis is run.
  const importFolder = async (list, withAi) => {
    const groups = new Map()
    for (const f of list) {
      const parts = (f.webkitRelativePath || f.name).split('/')
      const key = parts.length > 2 ? parts[1] : parts.length === 2 ? 'Pre-Calex' : 'Pre-Calex'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(f)
    }
    const total = list.length
    const summary = { projects: [], files: 0, unreadable: [], ai: 0, done: 0, total, current: '' }
    setImp({ ...summary, running: true })
    for (const [name, files] of groups) {
      summary.current = name
      setImp({ ...summary, running: true })
      try {
        const p = await api.projects.create(name.slice(0, 120), '')
        let ok = 0
        for (let i = 0; i < files.length; i += 5) {                      // small batches keep requests light
          const r = await api.files.upload(p.id, files.slice(i, i + 5))
          ok += r.files.length; summary.files += r.files.length; summary.done += Math.min(5, files.length - i)
          for (const f of r.files.filter((x) => x.status === 'failed')) {
            if (withAi) {
              try { await api.files.extract(p.id, f.id); summary.ai++ } catch { summary.unreadable.push(`${name}/${f.name}`) }
            } else summary.unreadable.push(`${name}/${f.name}`)
          }
          setImp({ ...summary, running: true })
        }
        summary.projects.push({ id: p.id, name, files: ok })
      } catch (e) { summary.unreadable.push(`${name}: ${e.message}`) }
    }
    emitChange(); load()
    setImp({ ...summary, running: false })
  }
  const startImport = (list) => {
    if (!list.length) return
    if (hasConsent()) importFolder(list, true); else setConsent(list)
  }
  const remove = async () => {
    try { await api.projects.remove(toDelete.id); setToDelete(null); load(); emitChange() } catch (e) { setError(e); setToDelete(null) }
  }
  const matches = projects ? projects.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(filter.trim().toLowerCase())) : []
  const shown = projects ? (all || filter.trim() ? matches : matches.slice(0, RECENT)) : []

  return (
    <>
      {/* hero, like the Google search page: wordmark, one wide input, one button */}
      <section className="hero">
        <h1 className="wordmark">Calex</h1>
        <p className="md-typescale-body-large muted" style={{ margin: '12px 0 32px', maxWidth: 560 }}>{t('Find risks in a bill of quantities before you price it')}</p>
        <div className={`searchbar ${fieldError ? 'err' : ''}`}>
          <Icon name="add" />
          <input ref={input} value={name} maxLength={120} placeholder={t('New project name')} aria-label={t('New project name')}
            onChange={(e) => { setName(e.target.value); setFieldError(false) }} onKeyDown={(e) => e.key === 'Enter' && create()} />
        </div>
        <div className="help-err" role="alert">{fieldError ? t('Please enter a project name.') : ''}</div>
        <div className="mt8"><Fab label={t('New project')} variant="primary" onClick={create} disabled={busy}><Icon slot="icon" name="add" /></Fab></div>
        <p className="muted" style={{ margin: '20px 0 8px' }}>{t('or')}</p>
        <div className={`dropzone compact ${over ? 'over' : ''}`} role="button" tabIndex={0} aria-label={t('Drop BoQ files here to start a project')}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); startFromFiles([...e.dataTransfer.files]) }}
          onClick={() => picker.current?.click()} onKeyDown={(e) => e.key === 'Enter' && picker.current?.click()}>
          <input ref={picker} type="file" multiple hidden accept=".x83,.x84,.x86,.d83,.d84,.d86,.xml,.pdf,.xlsx,.xlsm,.docx" onChange={(e) => { startFromFiles([...e.target.files]); e.target.value = '' }} />
          <Icon name="upload_file" />
          <div style={{ fontWeight: 500 }}>{t('Drop BoQ files here to start a project')}</div>
          <div className="md-typescale-body-small muted">{t('The project is created for you and named after the first file.')}</div>
        </div>
        {uploading && <div style={{ width: '100%', maxWidth: 640 }}><LinearProgress indeterminate /><p className="muted mt8">{uploading}</p></div>}
        <div style={{ width: '100%', maxWidth: 640 }}><ErrorBox error={error} onClose={() => setError(null)} /></div>
      </section>

      {/* recent projects at the bottom */}
      <section>
        <div className="row mb16" style={{ justifyContent: 'space-between' }}>
          <h2 className="md-typescale-title-large">{t('Recent projects')}</h2>
          {projects && projects.length > 3 && <TextField label={t('Search projects')} value={filter} onValue={setFilter} style={{ minWidth: 220 }}><Icon slot="leading-icon" name="search" /></TextField>}
          <Button variant="text" icon="drive_folder_upload" onClick={() => folder.current?.click()}>{t('Import past projects')}</Button>
          <input ref={folder} type="file" hidden multiple webkitdirectory="" directory="" onChange={(e) => { startImport([...e.target.files].filter((f) => /\.(x83|x84|x86|d83|d84|d86|xml|pdf|xlsx|xlsm|docx)$/i.test(f.name))); e.target.value = '' }} />
          {projects && projects.length > RECENT && !filter.trim() && <Button variant="text" onClick={() => setAll((a) => !a)}>{all ? t('Show fewer') : t('Show all {n}', { n: projects.length })}</Button>}
        </div>
        {projects === null && !error && <div className="center"><CircularProgress indeterminate style={{ '--md-circular-progress-size': '32px' }} /></div>}
        {projects && projects.length === 0 && <p className="muted">{t('Your recent projects will appear here.')}</p>}
        {projects && projects.length > 0 && filter.trim() && matches.length === 0 && <p className="muted">{t('No projects match the search.')}</p>}
        {projects && projects.length > 0 && (
          <div className="grid-cards">
            {shown.map((p) => (
              <div key={p.id} className="card click" role="link" tabIndex={0} onClick={() => go('p', p.id)} onKeyDown={(e) => e.key === 'Enter' && go('p', p.id)}>
                <md-ripple></md-ripple>
                <div className="row gap8" style={{ flexWrap: 'nowrap', marginBottom: 4, paddingRight: 40 }}>
                  <Icon name="folder" style={{ color: 'var(--md-sys-color-primary)' }} />
                  <h3 className="md-typescale-title-medium ellipsis">{p.name}</h3>
                </div>
                <p className="md-typescale-body-medium muted ellipsis">{p.description || t('No description')}</p>
                <div className="chips mt16">
                  <span className="tag"><Icon name="description" />{t('{n} files', { n: p.files })}</span>
                  <span className="tag"><Icon name="query_stats" />{t('{n} analyses', { n: p.analyses })}</span>
                  {p.items > 0 && <span className="tag">{t('{n} items', { n: p.items })}</span>}
                </div>
                <p className="md-typescale-body-small muted mt16">{t('Updated')} {fmtDate(p.updated)}</p>
                <div style={{ position: 'absolute', top: 4, right: 4 }} onClick={(e) => e.stopPropagation()}>
                  <IconButton icon="delete" label={t('Delete project')} onClick={() => setToDelete(p)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <Dialog open={!!imp} onClose={() => !imp?.running && setImp(null)} title={imp?.running ? t('Importing past projects…') : t('Import finished')} width={560}
        actions={imp?.running ? null : <Button variant="text" onClick={() => setImp(null)}>{t('Close')}</Button>}>
        {imp?.running && <><LinearProgress value={imp.total ? imp.done / imp.total : 0} /><p className="muted mt8">{t('{d} of {n} files · {p}', { d: imp.done, n: imp.total, p: imp.current })}</p></>}
        {imp && !imp.running && (
          <>
            <p>{t('{p} projects with {f} files were created. Open a project to run an analysis; nothing was analysed during the import.', { p: imp.projects.length, f: imp.files })}</p>
            {imp.ai > 0 && <p className="mt8">{t('{n} files could not be read by the parser and were extracted by the AI. They are marked "please check" in each project.', { n: imp.ai })}</p>}
            {imp.unreadable.length > 0 && <><p className="mt8"><b>{t('Could not be read')}</b></p><ul style={{ margin: 0, paddingLeft: 20 }}>{imp.unreadable.slice(0, 12).map((x) => <li key={x}>{x}</li>)}</ul></>}
          </>
        )}
      </Dialog>
      <ConsentDialog open={!!consent} onClose={() => setConsent(null)} names={[]} onAccept={() => { const l = consent; setConsent(null); importFolder(l, true) }} />
      <ConfirmDialog open={!!toDelete} title={t('Delete project?')} onClose={() => setToDelete(null)} onConfirm={remove}
        text={toDelete ? t('"{name}" and its {n} files and saved analyses will be permanently deleted.', { name: toDelete.name, n: toDelete.files }) : ''} />
    </>
  )
}
