import { useEffect, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { ErrorBox } from '../common.jsx'

export default function EditProjectDialog({ open, project, onClose, onSaved }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => { if (open) { setName(project.name); setDescription(project.description || ''); setError(null) } }, [open, project])
  const save = async () => {
    if (!name.trim()) { setError(new Error(t('Please enter a project name.'))); return }
    try { onSaved(await api.projects.patch(project.id, { name: name.trim(), description })) } catch (e) { setError(e) }
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('Rename project')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField autoFocus required label={t('Project name')} value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label={t('Description (optional)')} value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} />
        </Stack>
        <ErrorBox error={error} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="contained" onClick={save}>{t('Save')}</Button>
      </DialogActions>
    </Dialog>
  )
}
