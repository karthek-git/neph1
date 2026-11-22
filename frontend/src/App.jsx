import { useRef, useState } from 'react'
import { IconButton } from './m3/ui.jsx'
import { useRoute, go } from './router.js'
import { useI18n } from './i18n.jsx'
import { useWide } from './common.jsx'
import ProjectsPage from './components/ProjectsPage.jsx'
import ProjectPage from './components/ProjectPage.jsx'
import Sidebar from './components/Sidebar.jsx'

const OPEN = 296
const RAIL = 80

function Shell({ children, pid, tab }) {
  const { t } = useI18n()
  const wide = useWide()
  const [pinned, setPinned] = useState(() => { try { return localStorage.getItem('calex-pin') === '1' } catch { return false } })
  const [hover, setHover] = useState(false)
  const [lock, setLock] = useState(false)       // keep the rail open while a menu opened from it is showing
  const [mobileOpen, setMobileOpen] = useState(false)
  const timer = useRef(null)
  const toggle = () => {
    if (!wide) { setMobileOpen((o) => !o); return }
    setPinned((c) => { try { localStorage.setItem('calex-pin', c ? '0' : '1') } catch { /* ignore */ } return !c })
  }
  const enter = () => { clearTimeout(timer.current); setHover(true) }
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setHover(false), 160) }
  const expanded = pinned || hover || lock

  return (
    <>
      <header className="bar">
        <IconButton icon={wide && pinned ? 'menu_open' : 'menu'} label={wide ? (pinned ? t('Unpin menu') : t('Pin menu open')) : t('Menu')} onClick={toggle} />
        {pid && <button className="brand" onClick={() => go()}>Calex</button>}
      </header>

      {wide ? (
        <nav className={`nav ${expanded && !pinned ? 'floating' : ''} ${expanded ? '' : 'rail'}`} style={{ width: expanded ? OPEN : RAIL }} onMouseEnter={enter} onMouseLeave={leave}>
          <Sidebar pid={pid} tab={tab} collapsed={!expanded} onLock={setLock} />
        </nav>
      ) : (
        mobileOpen && (
          <>
            <div className="scrim" onClick={() => setMobileOpen(false)} />
            <aside className="drawer"><Sidebar pid={pid} tab={tab} collapsed={false} onNavigate={() => setMobileOpen(false)} onLock={setLock} /></aside>
          </>
        )
      )}
      <main className="main" style={{ marginLeft: wide ? (pinned ? OPEN : RAIL) : 0 }}>
        <div className="page">{children}</div>
      </main>
    </>
  )
}

export default function App() {
  const parts = useRoute()
  const pid = parts[0] === 'p' ? parts[1] : null
  const tab = pid ? (parts[2] || 'files') : null
  return (
    <Shell pid={pid} tab={tab}>
      {pid ? <ProjectPage key={pid} pid={pid} tab={tab} aid={parts[3]} /> : <ProjectsPage />}
    </Shell>
  )
}
