import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import '@fontsource/roboto/800.css'
import '@fontsource/material-symbols-outlined/index.css'
import './styles.css'
import { initTheme } from './m3/theme.js'
import { I18nProvider } from './i18n.jsx'
import App from './App.jsx'

initTheme()
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
)
