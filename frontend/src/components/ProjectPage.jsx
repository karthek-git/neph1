import { useCallback, useEffect, useState } from 'react'
import { Box, Button, CircularProgress, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined'
import QueryStatsOutlined from '@mui/icons-material/QueryStatsOutlined'
import RequestQuoteOutlined from '@mui/icons-material/RequestQuoteOutlined'
import TuneOutlined from '@mui/icons-material/TuneOutlined'
import CompareArrowsOutlined from '@mui/icons-material/CompareArrowsOutlined'
import { api } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { ErrorBox } from '../common.jsx'
import { ConfirmDialog } from './ProjectsPage.jsx'
import FilesTab from './FilesTab.jsx'
import AnalysesTab from './AnalysesTab.jsx'
import BidSheet from './BidSheet.jsx'
import WhatIf from './WhatIf.jsx'
import Compare from './Compare.jsx'
import EditProjectDialog from './EditProjectDialog.jsx'

const TABS = ['files', 'analyses', 'bid', 'whatif', 'compare']

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

  const current = TABS.includes(tab) ? tab : 'files'
  if (error && !project) {
    return (
      <>
        <ErrorBox error={error} />
        <Button startIcon={<ArrowBackRounded />} onClick={() => go()}>{t('Projects')}</Button>
      </>
    )
  }
  if (!project) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>

  const remove = async () => { try { await api.projects.remove(pid); go() } catch (e) { setError(e); setDeleting(false) } }
  const ctx = { pid, project, files, analyses, reload, loadFiles, loadAnalyses, loadProject, setError }

  return (
    <>
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
        <Tooltip title={t('All projects')}><IconButton onClick={() => go()} aria-label={t('All projects')} sx={{ mt: 0.5 }}><ArrowBackRounded /></IconButton></Tooltip>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h4" noWrap>{project.name}</Typography>
          {project.description && <Typography color="text.secondary">{project.description}</Typography>}
        </Box>
        <Tooltip title={t('Rename project')}><IconButton onClick={() => setEditing(true)}><EditOutlined /></IconButton></Tooltip>
        <Tooltip title={t('Delete project')}><IconButton onClick={() => setDeleting(true)}><DeleteOutline /></IconButton></Tooltip>
      </Stack>
      <ErrorBox error={error} onClose={() => setError(null)} />

      <Tabs value={current} onChange={(_, v) => go('p', pid, v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: 1, borderColor: 'divider', mb: 2.5 }}>
        <Tab value="files" icon={<FolderOpenOutlined />} iconPosition="start" label={`${t('Files')} (${files.length})`} />
        <Tab value="analyses" icon={<QueryStatsOutlined />} iconPosition="start" label={`${t('Analyses')} (${analyses.length})`} />
        <Tab value="bid" icon={<RequestQuoteOutlined />} iconPosition="start" label={t('Bid sheet')} />
        <Tab value="whatif" icon={<TuneOutlined />} iconPosition="start" label={t('What-if')} />
        <Tab value="compare" icon={<CompareArrowsOutlined />} iconPosition="start" label={t('Tender vs award')} />
      </Tabs>

      {current === 'files' && <FilesTab {...ctx} />}
      {current === 'analyses' && <AnalysesTab {...ctx} aid={aid} />}
      {current === 'bid' && <BidSheet {...ctx} />}
      {current === 'whatif' && <WhatIf {...ctx} />}
      {current === 'compare' && <Compare {...ctx} />}

      <EditProjectDialog open={editing} project={project} onClose={() => setEditing(false)} onSaved={(p) => { setProject((x) => ({ ...x, ...p })); setEditing(false) }} />
      <ConfirmDialog open={deleting} title={t('Delete project?')} onClose={() => setDeleting(false)} onConfirm={remove}
        text={t('"{name}" and its {n} files and saved analyses will be permanently deleted.', { name: project.name, n: project.files })} />
    </>
  )
}
