import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { useI18n } from '../i18n.jsx'
import { Button, Checkbox, CircularProgress, Icon, IconButton, LinearProgress, Switch } from '../m3/ui.jsx'
import { fmt } from '../common.jsx'

/*
  Automatic analysis. The server's plan looks at the stage of every file:
    tender                -> risk analysis (tender files only, a later stage is never merged into it)
    tender + award        -> also the tender-vs-award comparison
    priced bid / award    -> also what-if scenarios on the priced file
  The steps are shown on screen while they run.
*/
export function useAutoRun({ pid, useLlm, onDone }) {
  const { t } = useI18n()
  const [steps, setSteps] = useState(null)
  const [info, setInfo] = useState('')
  const [running, setRunning] = useState(false)
  const busy = useRef(false)
  const again = useRef(false)
  const patch = (id, p) => setSteps((s) => s && s.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const last = useRef({})
  // opts: which steps to run (risk, compare, estimate, whatif), scenario names, file ids for the risk analysis, useLlm
  const start = async (opts) => {
    if (opts && opts.nativeEvent) opts = undefined          // called as a click handler
    if (opts) last.current = opts
    if (busy.current) { again.current = true; return }      // an upload arrived mid-run: run once more afterwards
    busy.current = true; setRunning(true)
    try {
      do {
        again.current = false
        const o = { risk: true, compare: true, estimate: true, whatif: true, scenarios: null, ids: null, useLlm, ...last.current }
        const plan = await api.plan(pid)
        const riskIds = o.ids && o.ids.length ? o.ids : plan.risk.file_ids
        if (!riskIds.length) { setSteps(null); break }
        const list = []
        if (o.risk) list.push({ id: 'risk', icon: 'query_stats', label: t('Risk analysis of the tender files'), sub: o.ids && o.ids.length ? t('{n} files', { n: o.ids.length }) : plan.risk.names.join(', '), status: 'pending' })
        if (o.compare) plan.compare.forEach((c, i) => list.push({ id: `c${i}`, icon: 'compare_arrows', label: c.kind === 'version' ? t('New version vs previous version') : t('Tender vs award'), sub: `${c.tender} ↔ ${c.later}`, status: 'pending', ref: c }))
        if (o.estimate) plan.estimates.forEach((e, i) => list.push({ id: `e${i}`, icon: 'payments', label: t('Indicative price from your earlier priced files'), sub: e.name, status: 'pending', ref: e }))
        if (o.whatif) plan.whatif.forEach((w, i) => list.push({ id: `w${i}`, icon: 'tune', label: t('What-if scenarios'), sub: w.basis ? `${w.name} · ${w.basis === 'bid' ? t('using your saved bid prices') : t('using indicative benchmark prices')}` : w.name, status: 'pending', ref: w }))
        if (o.whatif) plan.whatif_blocked.forEach((b, i) => list.push({ id: `b${i}`, icon: 'tune', label: t('What-if scenarios'), sub: b.name, status: 'pending', ref: b, blocked: true }))
        const parts = [`${plan.tenders.length} ${t('tender')}`]
        if (plan.later.length) parts.push(plan.later.map((l) => t(l.phase)).join(', '))
        setInfo(`${t('Detected')}: ${parts.join(' + ')}`)
        setSteps(list)

        for (const st of list) {
          patch(st.id, { status: 'running' })
          try {
            if (st.id === 'risk') {
              const done = o.ids && o.ids.length ? null : plan.already_done
              if (done && (done.use_llm || !o.useLlm)) { patch('risk', { status: 'skipped', detail: t('Already analysed'), link: ['p', pid, 'analyses', done.id] }); continue }
              const meta = await api.analyses.run(pid, { file_ids: riskIds, use_llm: o.useLlm, title: riskIds.length > 1 ? t('{n} files', { n: riskIds.length }) : '' })
              patch('risk', { status: 'done', detail: t('{n} findings ({h} high) · {q} questions', { n: meta.summary.findings, h: meta.summary.severity?.high || 0, q: meta.summary.questions }), link: ['p', pid, 'analyses', meta.id] })
              onDone?.()
            } else if (st.id.startsWith('c')) {
              const r = await api.compare(pid, { tender_file_id: st.ref.tender_id, award_file_id: st.ref.later_id })
              patch(st.id, { status: 'done', detail: t('{n} added, {r} removed, {c} changed', { n: r.added.length, r: r.removed.length, c: r.changed.length + (r.text_changed?.length || 0) + (r.price_changed?.length || 0) }), link: ['p', pid, 'compare'] })
            } else if (st.id.startsWith('e')) {
              patch(st.id, { status: 'done', detail: t('{total} EUR for {m} of {c} items that have a benchmark price (indicative, not a quote)', { total: fmt(st.ref.total), m: st.ref.matched, c: st.ref.candidates }), link: ['p', pid, 'bid'] })
            } else if (st.blocked) {
              patch(st.id, { status: 'skipped', detail: t('No prices to base a what-if on yet. Enter your prices in the Bid sheet to enable it.'), link: ['p', pid, 'bid'] })
            } else {
              const presets = await api.presets()
              const rows = []
              let baseline = null
              for (const p of presets.filter((x) => !o.scenarios || o.scenarios.includes(x.name))) {
                try {
                  const { name, ...sc } = p
                  const r = await api.whatif(pid, { file_id: st.ref.file_id, scenarios: [sc], include_optional: true, split: {}, use_bid: st.ref.basis === 'bid', use_benchmark: st.ref.basis === 'benchmark' })
                  baseline = r.baseline
                  rows.push({ name: t(name), delta: r.delta, pct: r.delta_pct })
                } catch { /* a scenario that does not apply is skipped */ }
              }
              patch(st.id, { status: 'done', detail: baseline != null ? `${t('Baseline')}: ${fmt(baseline)} EUR${st.ref.basis === 'benchmark' ? ' · ' + t('only items with a benchmark price are included') : ''}` : '', rows, link: ['p', pid, 'whatif'] })
            }
          } catch (e) { patch(st.id, { status: 'error', detail: String(e.message || e).slice(0, 200) }) }
        }
      } while (again.current)
    } catch (e) { setSteps([{ id: 'err', icon: 'error', label: t('Automatic analysis'), status: 'error', detail: String(e.message || e) }]) }
    finally { busy.current = false; setRunning(false) }
  }
  return { steps, info, running, start, dismiss: () => setSteps(null) }
}

const ICON = { pending: 'radio_button_unchecked', skipped: 'history', done: 'check_circle', error: 'error' }

export function AutoPanel({ auto }) {
  const { t } = useI18n()
  if (!auto.steps) return null
  return (
    <div className="card filled" role="status" aria-live="polite">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <div className="grow">
          <h2 className="md-typescale-title-large">{t('Automatic analysis')}</h2>
          <p className="muted">{auto.running ? t('Running automatically…') : t('Finished')} {auto.info && `· ${auto.info}`}</p>
        </div>
        {!auto.running && <Button variant="text" icon="refresh" onClick={auto.start}>{t('Run again')}</Button>}
        {!auto.running && <IconButton icon="close" label={t('Dismiss')} onClick={auto.dismiss} />}
      </div>
      {auto.running && <div className="mt8"><LinearProgress indeterminate /></div>}
      <ol className="steps">
        {auto.steps.map((s) => (
          <li key={s.id} className={s.status}>
            <span className="stepicon">
              {s.status === 'running' ? <CircularProgress indeterminate style={{ '--md-circular-progress-size': '24px' }} /> : <Icon name={ICON[s.status] || 'radio_button_unchecked'} />}
            </span>
            <div className="grow">
              <div style={{ fontWeight: 500 }}>{s.label}</div>
              {s.sub && <div className="md-typescale-body-small muted ellipsis">{s.sub}</div>}
              {s.detail && <div className="md-typescale-body-medium" style={s.status === 'error' ? { color: 'var(--md-sys-color-error)' } : undefined}>{s.detail}</div>}
              {s.rows?.length > 0 && (
                <table className="mini">
                  <tbody>{s.rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="num">{r.delta >= 0 ? '+' : ''}{fmt(r.delta)} EUR</td><td className="num muted">{r.pct >= 0 ? '+' : ''}{fmt(r.pct)} %</td></tr>)}</tbody>
                </table>
              )}
            </div>
            {s.link && s.status !== 'running' && <Button variant="text" onClick={() => go(...s.link)}>{t('Open')}</Button>}
          </li>
        ))}
      </ol>
    </div>
  )
}

const AUTO_KEY = 'calex-auto-run'

/* "What would you like to run?": asks first. The server's plan says which steps make sense for the files in the project;
   steps that do not apply are shown greyed out with the reason. */
export function RunChecklist({ pid, files, auto, useLlm, setUseLlm, llmAvailable, chosenIds, selectionChanged, autoOn, setAutoOn }) {
  const { t } = useI18n()
  const [plan, setPlan] = useState(null)
  const [presets, setPresets] = useState([])
  const [on, setOn] = useState({ risk: true, compare: true, estimate: true, whatif: true })
  const [sc, setSc] = useState(null)          // selected scenario names; null = all
  const [showSc, setShowSc] = useState(false)
  const [hist, setHist] = useState(null)
  const [showHist, setShowHist] = useState(false)
  const sig = files.map((f) => `${f.id}:${f.phase}:${f.items}:${f.confirmed}:${f.error}`).join('|')
  useEffect(() => { if (files.length) api.plan(pid).then(setPlan).catch(() => setPlan(null)); else setPlan(null) }, [pid, sig, auto.running]) // eslint-disable-line
  useEffect(() => { api.presets().then(setPresets).catch(() => {}) }, [])
  useEffect(() => { if (files.length) api.history.get(pid).then(setHist).catch(() => setHist(null)) }, [pid, sig])
  const setSources = async (next) => { try { setHist(await api.history.put(pid, next)); api.plan(pid).then(setPlan).catch(() => {}) } catch { /* ignore */ } }
  const cfg = (h, over = {}) => ({ projects: h.sources.filter((s) => s.kind === 'project' && s.selected).map((s) => s.id), dataset: !!h.sources.find((s) => s.kind === 'dataset' && s.selected), include_own: h.include_own, ...over })
  if (!plan || !plan.risk.file_ids.length) return null
  const can = {
    risk: true,
    compare: plan.compare.length > 0,
    estimate: plan.estimates.length > 0,
    whatif: plan.whatif.length > 0,
  }
  const why = {
    compare: t('Needs a tender and its award, or two versions of the same BoQ.'),
    estimate: t('No earlier priced files match this tender closely enough.'),
    whatif: plan.whatif_blocked.length ? t('No prices to base it on yet. Enter your prices in the Bid sheet, or add a priced bid or award.') : t('Needs a priced file, saved bid prices, or matching benchmark prices.'),
  }
  const unconfirmed = files.filter((f) => f.items > 0 && !f.confirmed)
  const picked = Object.entries(on).filter(([k, v]) => v && can[k]).map(([k]) => k)
  const run = () => auto.start({ risk: !!on.risk, compare: !!(on.compare && can.compare), estimate: !!(on.estimate && can.estimate), whatif: !!(on.whatif && can.whatif),
    scenarios: sc, ids: selectionChanged ? chosenIds : null, useLlm })
  const Row = ({ id, icon, title, sub, children }) => (
    <li className={`runrow ${can[id] ? '' : 'off'}`}>
      <Checkbox disabled={!can[id]} checked={can[id] && on[id]} onValue={(v) => setOn((o) => ({ ...o, [id]: v }))} aria-label={title} />
      <Icon name={icon} />
      <div className="grow">
        <div style={{ fontWeight: 500 }}>{title}</div>
        <div className="md-typescale-body-small muted">{can[id] ? sub : why[id]}</div>
        {can[id] && on[id] && children}
      </div>
    </li>
  )
  return (
    <div className="card filled">
      <h2 className="md-typescale-title-large">{t('What would you like to run?')}</h2>
      <p className="muted">{t('Pick the steps. Steps that do not fit the files in this project are greyed out.')}</p>
      {unconfirmed.length > 0 && <div className="banner warn"><div className="grow">{t('{n} file(s) contain AI-extracted items that are not confirmed yet. You can still run, but the results will carry a warning.', { n: unconfirmed.length })} <Button variant="text" onClick={() => go('p', pid, 'items', unconfirmed[0].id)}>{t('Review')}</Button></div></div>}
      <ul className="runlist">
        <Row id="risk" icon="query_stats" title={t('Risk analysis')} sub={`${t('Errors, vague scope, risk shifted to you, change-order potential and bidder questions')} · ${selectionChanged ? chosenIds.length : plan.risk.names.length} ${t('files')}`}>
          <label className="row gap8 mt8" style={{ opacity: llmAvailable ? 1 : 0.5 }} title={llmAvailable ? '' : t('Set the AI API key on the server to enable this.')}>
            <Switch selected={useLlm} disabled={!llmAvailable} onValue={setUseLlm} aria-label={t('AI text analysis')} />{t('AI text analysis')}
          </label>
        </Row>
        <Row id="compare" icon="compare_arrows" title={plan.compare.every((c) => c.kind === 'version') ? t('New version vs previous version') : t('Tender vs award')} sub={plan.compare.map((c) => `${c.tender} ↔ ${c.later}`).join(' · ')} />
        <Row id="estimate" icon="payments" title={t('Indicative price estimate')} sub={plan.estimates.map((e) => `${e.name}: ${e.matched}/${e.candidates} ${t('items matched')}`).join(' · ')} />
        <Row id="whatif" icon="tune" title={t('What-if scenarios')} sub={plan.whatif.map((w) => w.name).join(' · ')}>
          <div className="mt8">
            <Button variant="text" icon={showSc ? 'expand_less' : 'expand_more'} onClick={() => setShowSc((v) => !v)}>{sc ? t('{n} scenarios selected', { n: sc.length }) : t('All scenarios')}</Button>
            {showSc && presets.map((p) => {
              const sel = sc ? sc.includes(p.name) : true
              return <label key={p.name} className="row gap8" style={{ flexWrap: 'nowrap' }}><Checkbox checked={sel} onValue={(v) => { const cur = sc || presets.map((x) => x.name); setSc(v ? [...new Set([...cur, p.name])] : cur.filter((x) => x !== p.name)) }} aria-label={t(p.name)} />{t(p.name)}</label>
            })}
          </div>
        </Row>
      </ul>
      {hist && hist.sources.length > 0 && (
        <div className="mt8">
          <Button variant="text" icon={showHist ? 'expand_less' : 'history'} onClick={() => setShowHist((v) => !v)}>
            {t('Price history from {n} sources', { n: hist.sources.filter((s) => s.selected).length })}
          </Button>
          {showHist && (
            <div className="card mt8">
              <p className="muted mb8">{t('Estimates and benchmark prices are based on priced files of your earlier projects. Pick the ones that are comparable to this job.')}</p>
              {hist.sources.map((s) => (
                <label key={s.id} className="row" style={{ flexWrap: 'nowrap', padding: '4px 0' }}>
                  <Checkbox checked={s.selected} onValue={(v) => {
                    const list = new Set(cfg(hist).projects); if (s.kind === 'project') { v ? list.add(s.id) : list.delete(s.id) }
                    setSources(cfg(hist, { projects: [...list], ...(s.kind === 'dataset' ? { dataset: v } : {}) }))
                  }} aria-label={s.name} />
                  <span className="grow"><b>{s.name}</b><span className="md-typescale-body-small muted" style={{ display: 'block' }}>{t('{n} priced items', { n: s.items })}{s.ai_items > 0 ? ` · ${t('{n} AI-extracted', { n: s.ai_items })}` : ''}</span></span>
                  <span className={`chip ${s.matched > 0 ? 'ok' : 'neutral'}`}>{t('matches {m} of {c} items', { m: s.matched, c: s.candidates })}</span>
                </label>
              ))}
              <label className="row gap8 mt8"><Switch selected={hist.include_own} onValue={(v) => setSources(cfg(hist, { include_own: v }))} aria-label={t("Include this project's own prices")} />{t("Include this project's own prices (for demos and tests)")}</label>
            </div>
          )}
        </div>
      )}
      <div className="row mt8">
        <label className="row gap8">
          <Switch selected={autoOn} onValue={setAutoOn} aria-label={t('Run recommended steps automatically after upload')} />
          {t('Run recommended steps automatically after upload')}
        </label>
        <span className="grow" />
        <Button icon="play_arrow" disabled={!picked.length || auto.running} onClick={run}>{t('Run {n} selected', { n: picked.length })}</Button>
      </div>
    </div>
  )
}
