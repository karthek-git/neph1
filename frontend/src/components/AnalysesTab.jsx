import { useState } from 'react'
import { Box, Button, Card, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import QueryStatsOutlined from '@mui/icons-material/QueryStatsOutlined'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import { api } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { SevChip, fmtDate } from '../common.jsx'
import ReportView from './ReportView.jsx'

const LLM = { ok: 'Gemini used', skipped: 'Rules only', no_key: 'Rules only (no key)', partial: 'Gemini partly failed', failed: 'Gemini failed' }

export default function AnalysesTab({ pid, analyses, loadAnalyses, loadProject, setError, aid }) {
  const { t } = useI18n()
  const [removing, setRemoving] = useState(null)
  if (aid) return <ReportView pid={pid} aid={aid} />

  const remove = async (a, e) => {
    e.stopPropagation(); setRemoving(a.id)
    try { await api.analyses.remove(pid, a.id); loadAnalyses(); loadProject() } catch (err) { setError(err) } finally { setRemoving(null) }
  }
  if (!analyses.length) {
    return (
      <Card sx={{ textAlign: 'center', py: 6, bgcolor: 'action.hover', border: 'none' }}>
        <QueryStatsOutlined sx={{ fontSize: 56, color: 'primary.main' }} />
        <Typography variant="h6">{t('No analyses yet')}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>{t('Pick files on the Files tab and run an analysis. Each result is saved here.')}</Typography>
        <Button variant="contained" onClick={() => go('p', pid, 'files')}>{t('Go to files')}</Button>
      </Card>
    )
  }
  return (
    <Stack spacing={1.5}>
      {analyses.map((a) => (
        <Card key={a.id} onClick={() => go('p', pid, 'analyses', a.id)} sx={{ p: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={0.5}>
                <Typography variant="h6" noWrap sx={{ maxWidth: '100%' }}>{a.title}</Typography>
                <SevChip level={a.summary.overall} />
                <Chip size="small" variant="outlined" icon={a.llm_status === 'ok' ? <AutoAwesomeOutlined /> : undefined} label={t(LLM[a.llm_status] || a.llm_status)} />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {fmtDate(a.created)} · {t('{n} files', { n: a.file_ids.length })} · {t('{n} items', { n: a.summary.items })} · {t('{n} findings', { n: a.summary.findings })} ({a.summary.severity?.high || 0} {t('high')}) · {t('{n} questions', { n: a.summary.questions })}
              </Typography>
            </Box>
            <Tooltip title={t('Delete analysis')}><IconButton disabled={removing === a.id} onClick={(e) => remove(a, e)}><DeleteOutline /></IconButton></Tooltip>
          </Stack>
        </Card>
      ))}
    </Stack>
  )
}
