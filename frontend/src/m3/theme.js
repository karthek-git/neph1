import { useEffect, useState } from 'react'
import { argbFromHex, hexFromArgb, Hct, SchemeVibrant, MaterialDynamicColors, TonalPalette } from '@material/material-color-utilities'
import { styles as typescale } from '@material/web/typography/md-typescale-styles.js'

/*
  Material 3 theme generated with Google's material-color-utilities (dynamic colour, Vibrant scheme from a Google-blue seed).
  Every --md-sys-color-* token the Material Web components read is set on :root, for light and dark.
  Custom roles (warning, success) are derived the M3 way, from extra tonal palettes.
*/
const SEED = '#0b57d0'
const ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer', 'error', 'onError', 'errorContainer', 'onErrorContainer',
  'background', 'onBackground', 'surface', 'onSurface', 'surfaceVariant', 'onSurfaceVariant', 'outline', 'outlineVariant', 'shadow', 'scrim',
  'inverseSurface', 'inverseOnSurface', 'inversePrimary', 'surfaceTint', 'surfaceDim', 'surfaceBright',
  'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest',
]
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())

function build(dark) {
  const scheme = new SchemeVibrant(Hct.fromInt(argbFromHex(SEED)), dark, 0)
  const vars = {}
  for (const r of ROLES) vars[`--md-sys-color-${kebab(r)}`] = hexFromArgb(MaterialDynamicColors[r].getArgb(scheme))
  const warn = TonalPalette.fromHueAndChroma(75, 40)
  const ok = TonalPalette.fromHueAndChroma(145, 36)
  vars['--calex-warning-container'] = hexFromArgb(dark ? warn.tone(30) : warn.tone(90))
  vars['--calex-on-warning-container'] = hexFromArgb(dark ? warn.tone(90) : warn.tone(10))
  vars['--calex-success-container'] = hexFromArgb(dark ? ok.tone(30) : ok.tone(90))
  vars['--calex-on-success-container'] = hexFromArgb(dark ? ok.tone(90) : ok.tone(10))
  return vars
}

const KEY = 'calex-theme'
const listeners = new Set()
let mode = (() => { try { return localStorage.getItem(KEY) || 'system' } catch { return 'system' } })()
const media = window.matchMedia('(prefers-color-scheme: dark)')

export const isDark = () => (mode === 'system' ? media.matches : mode === 'dark')

export function applyTheme() {
  const dark = isDark()
  const root = document.documentElement
  for (const [k, v] of Object.entries(build(dark))) root.style.setProperty(k, v)
  root.style.setProperty('color-scheme', dark ? 'dark' : 'light')
  root.dataset.theme = dark ? 'dark' : 'light'
  listeners.forEach((l) => l())
}

export function setThemeMode(m) {
  mode = m
  try { localStorage.setItem(KEY, m) } catch { /* ignore */ }
  applyTheme()
}

export function initTheme() {
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, typescale.styleSheet]
  media.addEventListener('change', () => { if (mode === 'system') applyTheme() })
  applyTheme()
}

export function useThemeMode() {
  const [, force] = useState(0)
  useEffect(() => { const l = () => force((x) => x + 1); listeners.add(l); return () => listeners.delete(l) }, [])
  return { mode, dark: isDark(), setMode: setThemeMode }
}
