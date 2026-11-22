import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { emitChange } from '../bus.js'
import { useI18n } from '../i18n.jsx'
import { Button, CircularProgress, Dialog, ErrorBox, Fab, Icon, IconButton, TextField } from '../m3/ui.jsx'
import { fmtDate } from '../common.jsx'

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
  const input = useRef(null)
  const RECENT = 6

  const load = () => api.projects.list().then(setProjects).catch(setError)
  useEffect(() => { load(); input.current?.focus() }, [])

  const create = async () => {
    if (!name.trim()) { setFieldError(true); input.current?.focus(); return }
    setBusy(true); setError(null)
    try { const p = await api.projects.create(name.trim(), ''); emitChange(); go('p', p.id) } catch (e) { setError(e); setBusy(false) }
  }
  const remove = async () => {
    try { await api.projects.remove(toDelete.id); setToDelete(null); load(); emitChange() } catch (e) { setError(e); setToDelete(null) }
  }
  const shown = projects ? (all ? projects : projects.slice(0, RECENT)) : []

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
        <div style={{ width: '100%', maxWidth: 640 }}><ErrorBox error={error} onClose={() => setError(null)} /></div>
      </section>

      {/* recent projects at the bottom */}
      <section>
        <div className="row mb16" style={{ justifyContent: 'space-between' }}>
          <h2 className="md-typescale-title-large">{t('Recent projects')}</h2>
          {projects && projects.length > RECENT && <Button variant="text" onClick={() => setAll((a) => !a)}>{all ? t('Show fewer') : t('Show all {n}', { n: projects.length })}</Button>}
        </div>
        {projects === null && !error && <div className="center"><CircularProgress indeterminate style={{ '--md-circular-progress-size': '32px' }} /></div>}
        {projects && projects.length === 0 && <p className="muted">{t('Your recent projects will appear here.')}</p>}
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
      <ConfirmDialog open={!!toDelete} title={t('Delete project?')} onClose={() => setToDelete(null)} onConfirm={remove}
        text={toDelete ? t('"{name}" and its {n} files and saved analyses will be permanently deleted.', { name: toDelete.name, n: toDelete.files }) : ''} />
    </>
  )
}
