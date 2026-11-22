import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, InputAdornment,
  LinearProgress, List, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import LibraryAddOutlined from '@mui/icons-material/LibraryAddOutlined'
import ErrorOutline from '@mui/icons-material/ErrorOutline'
import SearchRounded from '@mui/icons-material/SearchRounded'
import { api } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { ErrorBox, fmt, fmtDate } from '../common.jsx'

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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('Add files from the challenge dataset')}</DialogTitle>
      <DialogContent>
        <TextField fullWidth autoFocus placeholder={t('Search…')} value={q} onChange={(e) => setQ(e.target.value)} sx={{ mb: 1 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment> } }} />
        <ErrorBox error={error} />
        <List dense sx={{ maxHeight: 420, overflow: 'auto' }}>
          {shown.map((n) => (
            <ListItemButton key={n} onClick={() => setSel((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]))}>
              <ListItemIcon sx={{ minWidth: 40 }}><Checkbox edge="start" checked={sel.includes(n)} tabIndex={-1} disableRipple /></ListItemIcon>
              <ListItemText primary={n.split('/').pop()} secondary={n.split('/').slice(0, -1).join(' / ')} />
            </ListItemButton>
          ))}
          {shown.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>{t('No samples found.')}</Typography>}
        </List>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="contained" disabled={!sel.length || busy} onClick={add}>{t('Add {n} files', { n: sel.length })}</Button>
      </DialogActions>
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
    setBusy(useLlm ? t('Analysing with Gemini. This can take up to a minute…') : t('Analysing…')); setError(null)
    try {
      const meta = await api.analyses.run(pid, { file_ids: chosen, use_llm: useLlm, title: chosen.length > 1 ? t('{n} files', { n: chosen.length }) : '' })
      loadAnalyses(); loadProject()
      go('p', pid, 'analyses', meta.id)
    } catch (e) { setError(e) } finally { setBusy('') }
  }

  return (
    <Stack spacing={2.5}>
      <Box
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]) }}
        onClick={() => input.current?.click()}
        sx={{ border: 2, borderStyle: 'dashed', borderColor: over ? 'primary.main' : 'divider', borderRadius: 4, py: 4, px: 2, textAlign: 'center', cursor: 'pointer',
          bgcolor: over ? 'action.hover' : 'transparent', transition: '120ms' }}
      >
        <input ref={input} type="file" multiple hidden accept=".x83,.x84,.x86,.d83,.d84,.d86,.xml,.pdf" onChange={(e) => { upload([...e.target.files]); e.target.value = '' }} />
        <UploadFileOutlined sx={{ fontSize: 40, color: 'primary.main' }} />
        <Typography variant="h6">{t('Drop BoQ files here or click to choose')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('GAEB X83, X84, X86, D83, D84, D86 or text PDF. Several files at once are fine.')}</Typography>
        {hasSamples && (
          <Button sx={{ mt: 1.5 }} startIcon={<LibraryAddOutlined />} onClick={(e) => { e.stopPropagation(); setSamples(true) }}>{t('Add from the challenge dataset')}</Button>
        )}
      </Box>
      {busy && <Box><LinearProgress /><Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>{busy}</Typography></Box>}
      {notice && <Alert severity="warning" onClose={() => setNotice(null)}>{notice}</Alert>}

      {files.length === 0 ? (
        <Typography color="text.secondary" align="center" sx={{ py: 3 }}>{t('No files yet. Upload the BoQ files of this tender to get started.')}</Typography>
      ) : (
        <>
          <Card sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
              <Box>
                <Typography variant="h6">{t('Run an analysis')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {chosen.length > 1 ? t('{n} files are analysed together, so missing items across trades can be found.', { n: chosen.length }) : t('Select the files to analyse. Results are saved in this project.')}
                </Typography>
              </Box>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <Tooltip title={llmAvailable ? '' : t('Set GEMINI_API_KEY on the server to enable this.')}>
                  <span><FormControlLabel disabled={!llmAvailable} control={<Switch checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />} label={t('Gemini text analysis')} /></span>
                </Tooltip>
                <Button variant="contained" size="large" startIcon={<PlayArrowRounded />} disabled={!chosen.length || !!busy} onClick={analyse}>
                  {t('Analyse {n} files', { n: chosen.length })}
                </Button>
              </Stack>
            </Stack>
          </Card>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox checked={readable.length > 0 && chosen.length === readable.length} indeterminate={chosen.length > 0 && chosen.length < readable.length}
                      onChange={(e) => setSelected(e.target.checked ? readable.map((f) => f.id) : [])} />
                  </TableCell>
                  <TableCell>{t('File')}</TableCell><TableCell>{t('Phase')}</TableCell><TableCell align="right">{t('Items')}</TableCell>
                  <TableCell align="right">{t('Total (EUR)')}</TableCell><TableCell>{t('Added')}</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {files.map((f) => (
                  <TableRow key={f.id} hover>
                    <TableCell padding="checkbox"><Checkbox disabled={!!f.error} checked={chosen.includes(f.id)} onChange={() => toggle(f.id)} /></TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{f.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{(f.size / 1024).toFixed(0)} KB</Typography>
                      {f.error && <Typography variant="caption" color="error" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><ErrorOutline sx={{ fontSize: 14 }} />{f.error}</Typography>}
                    </TableCell>
                    <TableCell>{f.phase && <Chip size="small" label={t(f.phase)} variant="outlined" />}</TableCell>
                    <TableCell align="right">{f.items || ''}</TableCell>
                    <TableCell align="right">{fmt(f.total)}</TableCell>
                    <TableCell><Typography variant="caption" color="text.secondary">{fmtDate(f.uploaded)}</Typography></TableCell>
                    <TableCell align="right"><Tooltip title={t('Remove file')}><IconButton size="small" onClick={() => remove(f)}><DeleteOutline fontSize="small" /></IconButton></Tooltip></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      <SamplesDialog open={samples} onClose={() => setSamples(false)} pid={pid} onAdded={() => { loadFiles(); loadProject() }} />
    </Stack>
  )
}
