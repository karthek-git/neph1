import { useEffect, useState } from 'react'
import {
  Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, IconButton, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AddRounded from '@mui/icons-material/AddRounded'
import FolderOutlined from '@mui/icons-material/FolderOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined'
import QueryStatsOutlined from '@mui/icons-material/QueryStatsOutlined'
import { api } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { ErrorBox, fmtDate } from '../common.jsx'

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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('New project')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('A project holds all the BoQ files of one tender. You can run analyses on them at any time.')}
        </DialogContentText>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField autoFocus required label={t('Project name')} value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={t('e.g. Training centre and office building')} />
          <TextField label={t('Description (optional)')} value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} />
        </Stack>
        <ErrorBox error={error} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>{t('Create')}</Button>
      </DialogActions>
    </Dialog>
  )
}

export function ConfirmDialog({ open, title, text, confirmLabel, onClose, onConfirm }) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><DialogContentText>{text}</DialogContentText></DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>{confirmLabel || t('Delete')}</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function ProjectsPage() {
  const { t } = useI18n()
  const [projects, setProjects] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const load = () => api.projects.list().then(setProjects).catch(setError)
  useEffect(() => { load() }, [])

  const remove = async () => {
    try { await api.projects.remove(toDelete.id); setToDelete(null); load() } catch (e) { setError(e); setToDelete(null) }
  }

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h4">{t('Projects')}</Typography>
        <Button variant="contained" startIcon={<AddRounded />} onClick={() => setCreating(true)} size="large">{t('New project')}</Button>
      </Stack>
      <ErrorBox error={error} onClose={() => setError(null)} />
      {projects === null && !error && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}

      {projects && projects.length === 0 && (
        <Card sx={{ textAlign: 'center', py: 8, px: 3, bgcolor: 'action.hover', border: 'none' }}>
          <FolderOutlined sx={{ fontSize: 64, color: 'primary.main', mb: 1 }} />
          <Typography variant="h5" gutterBottom>{t('Create your first project')}</Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 520, mx: 'auto', mb: 3 }}>
            {t('Add the bill of quantities files for a tender (GAEB or PDF), then find risks, draft bidder questions and prepare your bid.')}
          </Typography>
          <Button variant="contained" size="large" startIcon={<AddRounded />} onClick={() => setCreating(true)}>{t('New project')}</Button>
        </Card>
      )}

      {projects && projects.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2 }}>
          {projects.map((p) => (
            <Card key={p.id} sx={{ position: 'relative' }}>
              <CardActionArea onClick={() => go('p', p.id)} sx={{ p: 0.5 }}>
                <CardContent>
                  <Stack direction="row" spacing={1.2} alignItems="center" sx={{ mb: 0.5, pr: 4 }}>
                    <FolderOutlined color="primary" />
                    <Typography variant="h6" noWrap>{p.name}</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {p.description || t('No description')}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
                    <Chip size="small" icon={<InsertDriveFileOutlined />} label={t('{n} files', { n: p.files })} />
                    <Chip size="small" icon={<QueryStatsOutlined />} label={t('{n} analyses', { n: p.analyses })} />
                    {p.items > 0 && <Chip size="small" variant="outlined" label={t('{n} items', { n: p.items })} />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>{t('Updated')} {fmtDate(p.updated)}</Typography>
                </CardContent>
              </CardActionArea>
              <Tooltip title={t('Delete project')}>
                <IconButton size="small" sx={{ position: 'absolute', top: 8, right: 8 }} onClick={() => setToDelete(p)} aria-label={t('Delete project')}>
                  <DeleteOutline fontSize="small" />
                </IconButton>
              </Tooltip>
            </Card>
          ))}
        </Box>
      )}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); go('p', p.id) }} />
      <ConfirmDialog open={!!toDelete} title={t('Delete project?')} onClose={() => setToDelete(null)} onConfirm={remove}
        text={toDelete ? t('"{name}" and its {n} files and saved analyses will be permanently deleted.', { name: toDelete.name, n: toDelete.files }) : ''} />
    </>
  )
}
