import { createTheme } from '@mui/material/styles'

// Google Material 3 flavoured palette (blue seed), light and dark. MUI's component set is Material Design.
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#0b57d0', contrastText: '#ffffff' },
        secondary: { main: '#00639b' },
        error: { main: '#b3261e' },
        warning: { main: '#9a5b00' },
        success: { main: '#146c2e' },
        info: { main: '#00639b' },
        background: { default: '#f8fafd', paper: '#ffffff' },
        text: { primary: '#1f1f1f', secondary: '#444746' },
        divider: '#dadce0',
      },
    },
    dark: {
      palette: {
        primary: { main: '#a8c7fa', contrastText: '#062e6f' },
        secondary: { main: '#7fcfff' },
        error: { main: '#f2b8b5' },
        warning: { main: '#ffc766' },
        success: { main: '#7fd08f' },
        info: { main: '#7fcfff' },
        background: { default: '#131314', paper: '#1e1f20' },
        text: { primary: '#e3e3e3', secondary: '#c4c7c5' },
        divider: '#444746',
      },
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
    h4: { fontWeight: 400, fontSize: '1.75rem' },
    h5: { fontWeight: 400 },
    h6: { fontWeight: 500, fontSize: '1.05rem' },
    button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0.1 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 999, paddingInline: 22 } } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: 16 } } },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: 16 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 8 } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500, minHeight: 48 } } },
    MuiTabs: { styleOverrides: { indicator: { height: 3, borderRadius: '3px 3px 0 0' } } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 28 } } },
    MuiAppBar: { defaultProps: { elevation: 0, color: 'default' } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 500, fontSize: '0.78rem', letterSpacing: 0.4, textTransform: 'uppercase' } } },
  },
})
