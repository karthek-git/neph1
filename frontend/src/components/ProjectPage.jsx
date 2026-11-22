import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { emitChange } from '../bus.js'
import { useI18n } from '../i18n.jsx'
import { Button, CircularProgress, ErrorBox, IconButton } from '../m3/ui.jsx'
import { ConfirmDialog } from './ProjectsPage.jsx'
import EditProjectDialog from './EditProjectDialog.jsx'
import FilesTab from './FilesTab.jsx'
import AnalysesTab from './AnalysesTab.jsx'
import BidSheet from './BidSheet.jsx'
import WhatIf from './WhatIf.jsx'
import Compare from './Compare.jsx'
import ParsedItems from './ParsedItems.jsx'

function Countdown({ label, date }) {
  const { t } = useI18n()
  if (!date) return null
  const days = Math.ceil((new Date(date + 'T23:59:59') - new Date()) / 86400000)
  const cls = days < 0 ? 'failed' : days <= 3 ? 'check' : 'neutral'
  const txt = days < 0 ? t('{n} days overdue', { n: -days }) : days === 0 ? t('today') : days === 1 ? t('tomorrow') : t('in {n} days', { n: days })
  return <span className={`chip ${cls}`} title={date}>{label}: {new Date(date + 'T12:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' })} · {txt}</span>
}

const TABS = ['files', 'items', 'analyses', 'bid', 'whatif', 'compare']

export default function ProjectPage({ pid, tab, aid }) {
  const { t } = useI18n()
  const [project, setProject] = useState(null)
  const [files, setFiles] = useState([])
  const [analyses, setAnalyses] = useState([])
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadProject = useCallback(() => api.projects.get(pid).then(setProject).catch(setError), [pid])
  const loadFiles = useCallback(() => api.files.list(pid).then(setFiles).catch(setError), [pid])
  const loadAnalyses = useCallback(() => api.analyses.list(pid).then(setAnalyses).catch(setError), [pid])
  const reload = useCallback(() => { loadProject(); loadFiles(); loadAnalyses() }, [loadProject, loadFiles, loadAnalyses])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { if (project) emitChange() }, [files.length, analyses.length]) // eslint-disable-line

  const current = TABS.includes(tab) ? tab : 'files'
  if (error && !project) {
    return <><ErrorBox error={error} /><Button variant="text" icon="arrow_back" onClick={() => go()}>{t('Projects')}</Button></>
  }
  if (!project) return <div className="center" style={{ padding: 64 }}><CircularProgress indeterminate /></div>

  const remove = async () => { try { await api.projects.remove(pid); emitChange(); go() } catch (e) { setError(e); setDeleting(false) } }
  const ctx = { pid, project, files, analyses, reload, loadFiles, loadAnalyses, loadProject, setError }

  return (
    <>
      <div className="row mb16" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <IconButton icon="arrow_back" label={t('All projects')} onClick={() => go()} />
        <div className="grow">
          <h1 className="md-typescale-headline-medium ellipsis">{project.name}</h1>
          {project.description && <p className="muted">{project.description}</p>}
          <div className="row gap8">
            <Countdown label={t('Questions due')} date={project.question_deadline} />
            <Countdown label={t('Bid due')} date={project.bid_deadline} />
          </div>
        </div>
        <IconButton icon="edit" label={t('Rename project')} onClick={() => setEditing(true)} />
        <IconButton icon="delete" label={t('Delete project')} onClick={() => setDeleting(true)} />
      </div>
      <ErrorBox error={error} onClose={() => setError(null)} />

      {current === 'files' && <FilesTab {...ctx} />}
      {current === 'items' && <ParsedItems {...ctx} aid={aid} />}
      {current === 'analyses' && <AnalysesTab {...ctx} aid={aid} />}
      {current === 'bid' && <BidSheet {...ctx} />}
      {current === 'whatif' && <WhatIf {...ctx} />}
      {current === 'compare' && <Compare {...ctx} />}

      <EditProjectDialog open={editing} project={project} onClose={() => setEditing(false)} onSaved={(p) => { setProject((x) => ({ ...x, ...p })); setEditing(false); emitChange() }} />
      <ConfirmDialog open={deleting} title={t('Delete project?')} onClose={() => setDeleting(false)} onConfirm={remove}
        text={t('"{name}" and its {n} files and saved analyses will be permanently deleted.', { name: project.name, n: project.files })} />
    </>
  )
}
