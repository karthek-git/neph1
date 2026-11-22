import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { Button, Dialog, ErrorBox, TextField } from '../m3/ui.jsx'

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
    <Dialog open={open} onClose={onClose} title={t('Rename project')}
      actions={<><Button variant="text" onClick={onClose}>{t('Cancel')}</Button><Button variant="text" onClick={save}>{t('Save')}</Button></>}>
      <div className="col" style={{ gap: 16 }}>
        <TextField label={t('Project name')} required value={name} onValue={setName} style={{ width: '100%' }} />
        <TextField label={t('Description (optional)')} type="textarea" rows={3} value={description} onValue={setDescription} style={{ width: '100%' }} />
      </div>
      <ErrorBox error={error} />
    </Dialog>
  )
}
