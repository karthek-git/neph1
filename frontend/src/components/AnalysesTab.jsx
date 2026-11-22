import { useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { Button, Icon, IconButton } from '../m3/ui.jsx'
import { SevChip, fmtDate } from '../common.jsx'
import ReportView from './ReportView.jsx'

const LLM = { ok: 'AI used', skipped: 'Rules only', no_key: 'Rules only (no key)', partial: 'AI partly failed', failed: 'AI failed' }

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
      <div className="card filled center" style={{ padding: 48 }}>
        <Icon name="query_stats" style={{ fontSize: 56, color: 'var(--md-sys-color-primary)', '--md-icon-size': '56px' }} />
        <h2 className="md-typescale-title-large mt8">{t('No analyses yet')}</h2>
        <p className="muted mb16">{t('Pick files on the Files tab and run an analysis. Each result is saved here.')}</p>
        <Button onClick={() => go('p', pid, 'files')}>{t('Go to files')}</Button>
      </div>
    )
  }
  return (
    <div className="col" style={{ gap: 12 }}>
      {analyses.map((a) => (
        <div key={a.id} className="card click" role="link" tabIndex={0} onClick={() => go('p', pid, 'analyses', a.id)} onKeyDown={(e) => e.key === 'Enter' && go('p', pid, 'analyses', a.id)}>
          <md-ripple></md-ripple>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <div className="grow">
              <div className="row gap8">
                <h3 className="md-typescale-title-medium ellipsis">{a.title}</h3>
                <SevChip level={a.summary.overall} />
                <span className="tag">{a.llm_status === 'ok' && <Icon name="auto_awesome" />}{t(LLM[a.llm_status] || a.llm_status)}</span>
              </div>
              <p className="md-typescale-body-medium muted mt8">
                {fmtDate(a.created)} · {t('{n} files', { n: a.file_ids.length })} · {t('{n} items', { n: a.summary.items })} · {t('{n} findings', { n: a.summary.findings })} ({a.summary.severity?.high || 0} {t('high')}) · {t('{n} questions', { n: a.summary.questions })}
              </p>
            </div>
            <div onClick={(e) => e.stopPropagation()}><IconButton icon="delete" label={t('Delete analysis')} disabled={removing === a.id} onClick={(e) => remove(a, e)} /></div>
          </div>
        </div>
      ))}
    </div>
  )
}
