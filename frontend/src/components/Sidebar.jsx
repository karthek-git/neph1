import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { go } from '../router.js'
import { emitChange, useChangeKey } from '../bus.js'
import { useI18n } from '../i18n.jsx'
import { Fab, Icon, IconButton, Menu, MenuItem, Divider, Segmented } from '../m3/ui.jsx'
import { useThemeMode } from '../m3/theme.js'
import { NewProjectDialog } from './ProjectsPage.jsx'

function NavItem({ icon, label, on, onClick, count, collapsed }) {
  return (
    <button className={`navitem ${on ? 'on' : ''}`} onClick={onClick} title={collapsed ? label : undefined} aria-label={label} aria-current={on ? 'page' : undefined}>
      <md-ripple></md-ripple>
      <Icon name={icon} />
      {!collapsed && <span className="ellipsis">{label}</span>}
      {!collapsed && count > 0 && <span className="count">{count}</span>}
    </button>
  )
}

function Settings({ collapsed }) {
  const { t, lang, setLang } = useI18n()
  const { mode, dark, setMode } = useThemeMode()
  if (collapsed) {
    return (
      <div className="navfoot rail">
        <IconButton icon="translate" label={`${t('Language')}: ${lang === 'en' ? 'English' : 'Deutsch'}`} onClick={() => setLang(lang === 'en' ? 'de' : 'en')} />
        <IconButton icon={dark ? 'dark_mode' : 'light_mode'} label={t('Theme')} onClick={() => setMode(dark ? 'light' : 'dark')} />
      </div>
    )
  }
  return (
    <div className="navfoot">
      <Segmented label={t('Language')} value={lang} onChange={setLang} options={[{ value: 'en', text: 'EN', label: 'English' }, { value: 'de', text: 'DE', label: 'Deutsch' }]} />
      <Segmented label={t('Theme')} value={mode} onChange={setMode}
        options={[{ value: 'light', icon: 'light_mode', label: t('Light') }, { value: 'system', icon: 'brightness_medium', label: t('Device setting') }, { value: 'dark', icon: 'dark_mode', label: t('Dark') }]} />
    </div>
  )
}

export default function Sidebar({ pid, tab, collapsed, onNavigate, onLock }) {
  const { t } = useI18n()
  const [projects, setProjects] = useState([])
  const [creating, setCreating] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const [menu, setMenu] = useState(false)
  const key = useChangeKey()
  useEffect(() => { api.projects.list().then(setProjects).catch(() => {}) }, [key, pid])
  useEffect(() => { onLock?.(menu) }, [menu]) // eslint-disable-line

  const nav = (...p) => { go(...p); onNavigate?.() }
  const current = projects.find((p) => p.id === pid)
  const item = (id, icon, label, count) => <NavItem key={id} collapsed={collapsed} icon={icon} label={label} count={count} on={tab === id} onClick={() => nav('p', pid, id)} />

  return (
    <>
      <div className="nav-scroll">
        {pid && current && !collapsed && (
          <>
            <button className="switcher" ref={setAnchor} onClick={() => setMenu(true)} aria-haspopup="menu" aria-expanded={menu}>
              <md-ripple></md-ripple>
              <span className="grow ellipsis"><b className="ellipsis">{current.name}</b><span className="md-typescale-body-small muted">{t('{n} files', { n: current.files })} · {t('{n} analyses', { n: current.analyses })}</span></span>
              <Icon name="arrow_drop_down" />
            </button>
            <Menu anchor={anchor} open={menu} onClose={() => setMenu(false)}>
              {projects.map((p) => <MenuItem key={p.id} onClick={() => { setMenu(false); nav('p', p.id) }}><div slot="headline">{p.name}</div>{p.id === pid && <Icon slot="end" name="check" />}</MenuItem>)}
              <Divider />
              <MenuItem onClick={() => { setMenu(false); nav() }}><div slot="headline">{t('All projects')}</div></MenuItem>
              <MenuItem onClick={() => { setMenu(false); setCreating(true) }}><div slot="headline">{t('New project')}</div></MenuItem>
            </Menu>
          </>
        )}

        {!pid && (
          <>
            <div style={{ padding: collapsed ? '0 12px 12px' : '0 12px 12px 12px' }}>
              <Fab label={collapsed ? undefined : t('New project')} variant="primary" onClick={() => setCreating(true)} aria-label={t('New project')} style={collapsed ? { '--md-fab-container-height': '56px' } : undefined}>
                <Icon slot="icon" name="add" />
              </Fab>
            </div>
            <NavItem collapsed={collapsed} icon="grid_view" label={t('Projects')} on onClick={() => nav()} />
          </>
        )}

        {pid && (
          <>
            {collapsed && <NavItem collapsed icon="grid_view" label={t('All projects')} onClick={() => nav()} />}
            <div className="navgroup" hidden={collapsed}>{t('Workspace')}</div>
            {item('files', 'folder_open', t('Files'), current?.files)}
            {item('analyses', 'query_stats', t('Analyses'), current?.analyses)}
            <div className="navgroup" hidden={collapsed}>{t('Tools')}</div>
            {item('bid', 'request_quote', t('Bid sheet'))}
            {item('whatif', 'tune', t('What-if'))}
            {item('compare', 'compare_arrows', t('Tender vs award'))}
          </>
        )}
      </div>
      <Settings collapsed={collapsed} />
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); emitChange(); nav('p', p.id) }} />
    </>
  )
}
