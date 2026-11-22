import { AppBar, Box, Button, Container, IconButton, Toolbar, Tooltip, Typography } from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import TranslateOutlined from '@mui/icons-material/TranslateOutlined'
import CalculateOutlined from '@mui/icons-material/CalculateOutlined'
import { useRoute, go } from './router.js'
import { useI18n } from './i18n.jsx'
import ProjectsPage from './components/ProjectsPage.jsx'
import ProjectPage from './components/ProjectPage.jsx'

function Shell({ children }) {
  const { lang, setLang, t } = useI18n()
  const { mode, systemMode, setMode } = useColorScheme()
  const effective = mode === 'system' ? systemMode : mode
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" sx={{ bgcolor: 'background.default', color: 'text.primary', borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1.5 }}>
          <Box onClick={() => go()} sx={{ display: 'flex', alignItems: 'center', gap: 1.2, cursor: 'pointer' }}>
            <CalculateOutlined color="primary" />
            <Typography variant="h6" sx={{ fontSize: 22, fontWeight: 400 }}>Calex</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
            {t('Find risks in a bill of quantities before you price it')}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" startIcon={<TranslateOutlined />} onClick={() => setLang(lang === 'en' ? 'de' : 'en')} sx={{ color: 'text.secondary' }}>
            {lang === 'en' ? 'EN | DE' : 'DE | EN'}
          </Button>
          <Tooltip title={effective === 'dark' ? t('Light theme') : t('Dark theme')}>
            <IconButton onClick={() => setMode(effective === 'dark' ? 'light' : 'dark')} aria-label="theme">
              {effective === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>{children}</Container>
    </Box>
  )
}

export default function App() {
  const parts = useRoute()
  return (
    <Shell>
      {parts[0] === 'p' && parts[1] ? <ProjectPage key={parts[1]} pid={parts[1]} tab={parts[2] || 'files'} aid={parts[3]} /> : <ProjectsPage />}
    </Shell>
  )
}
