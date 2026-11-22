import React from 'react'
import { createComponent } from '@lit/react'

import { MdFilledButton } from '@material/web/button/filled-button.js'
import { MdFilledTonalButton } from '@material/web/button/filled-tonal-button.js'
import { MdOutlinedButton } from '@material/web/button/outlined-button.js'
import { MdTextButton } from '@material/web/button/text-button.js'
import { MdFab } from '@material/web/fab/fab.js'
import { MdIconButton } from '@material/web/iconbutton/icon-button.js'
import { MdIcon } from '@material/web/icon/icon.js'
import { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js'
import { MdOutlinedSelect } from '@material/web/select/outlined-select.js'
import { MdSelectOption } from '@material/web/select/select-option.js'
import { MdCheckbox } from '@material/web/checkbox/checkbox.js'
import { MdSwitch } from '@material/web/switch/switch.js'
import { MdDialog } from '@material/web/dialog/dialog.js'
import { MdMenu } from '@material/web/menu/menu.js'
import { MdMenuItem } from '@material/web/menu/menu-item.js'
import { MdDivider } from '@material/web/divider/divider.js'
import { MdLinearProgress } from '@material/web/progress/linear-progress.js'
import { MdCircularProgress } from '@material/web/progress/circular-progress.js'
import { MdAssistChip } from '@material/web/chips/assist-chip.js'
import { MdChipSet } from '@material/web/chips/chip-set.js'
import { MdPrimaryTab } from '@material/web/tabs/primary-tab.js'
import { MdTabs } from '@material/web/tabs/tabs.js'
import { MdRipple } from '@material/web/ripple/ripple.js'

// Thin React bindings for Google's Material Web components (@material/web) via @lit/react.
const wrap = (tagName, elementClass, events) => createComponent({ tagName, elementClass, react: React, events })

export const FilledButton = wrap('md-filled-button', MdFilledButton)
export const TonalButton = wrap('md-filled-tonal-button', MdFilledTonalButton)
export const OutlinedButton = wrap('md-outlined-button', MdOutlinedButton)
export const TextButton = wrap('md-text-button', MdTextButton)
export const Fab = wrap('md-fab', MdFab)
export const IconButtonEl = wrap('md-icon-button', MdIconButton)
export const IconEl = wrap('md-icon', MdIcon)
export const TextFieldEl = wrap('md-outlined-text-field', MdOutlinedTextField, { onInput: 'input', onChange: 'change' })
export const SelectEl = wrap('md-outlined-select', MdOutlinedSelect, { onChange: 'change' })
export const SelectOption = wrap('md-select-option', MdSelectOption)
export const CheckboxEl = wrap('md-checkbox', MdCheckbox, { onChange: 'change' })
export const SwitchEl = wrap('md-switch', MdSwitch, { onChange: 'change' })
export const DialogEl = wrap('md-dialog', MdDialog, { onClosed: 'closed', onCancel: 'cancel' })
export const MenuEl = wrap('md-menu', MdMenu, { onClosed: 'closed' })
export const MenuItem = wrap('md-menu-item', MdMenuItem)
export const Divider = wrap('md-divider', MdDivider)
export const LinearProgress = wrap('md-linear-progress', MdLinearProgress)
export const CircularProgress = wrap('md-circular-progress', MdCircularProgress)
export const AssistChip = wrap('md-assist-chip', MdAssistChip)
export const ChipSet = wrap('md-chip-set', MdChipSet)
export const PrimaryTab = wrap('md-primary-tab', MdPrimaryTab)
export const TabsEl = wrap('md-tabs', MdTabs, { onChange: 'change' })
export const Ripple = wrap('md-ripple', MdRipple)

export const Icon = ({ name, ...p }) => <IconEl {...p}>{name}</IconEl>

export function Button({ variant = 'filled', icon, children, ...p }) {
  const C = { filled: FilledButton, tonal: TonalButton, outlined: OutlinedButton, text: TextButton }[variant]
  return <C {...p}>{icon && <Icon slot="icon" name={icon} />}{children}</C>
}

export const IconButton = ({ icon, label, ...p }) => (
  <IconButtonEl aria-label={label} title={label} {...p}><Icon name={icon} /></IconButtonEl>
)

export function TextField({ onValue, onInput, ...p }) {
  return <TextFieldEl onInput={(e) => { onInput?.(e); onValue?.(e.target.value) }} {...p} />
}

export function Select({ onValue, children, ...p }) {
  return <SelectEl onChange={(e) => onValue?.(e.target.value)} {...p}>{children}</SelectEl>
}
export const Option = ({ value, children, selected }) => (
  <SelectOption value={value} selected={selected}><div slot="headline">{children}</div></SelectOption>
)

export const Checkbox = ({ checked, onValue, ...p }) => <CheckboxEl checked={!!checked} onChange={(e) => onValue?.(e.target.checked)} {...p} />
export const Switch = ({ selected, onValue, ...p }) => <SwitchEl selected={!!selected} onChange={(e) => onValue?.(e.target.selected)} {...p} />

// Modal dialog: `open` controls it; onClose fires for scrim, Escape and actions.
export function Dialog({ open, onClose, title, children, actions, width = 560 }) {
  return (
    <DialogEl open={open} onClosed={() => onClose?.()} onCancel={() => onClose?.()} style={{ '--md-dialog-container-max-width': `${width}px`, width: '100%', maxWidth: width }}>
      <div slot="headline">{title}</div>
      <div slot="content">{children}</div>
      <div slot="actions">{actions}</div>
    </DialogEl>
  )
}

// Menu anchored to an element; keeps itself closed/opened through `open`.
export function Menu({ anchor, open, onClose, children }) {
  return <MenuEl anchorElement={anchor || undefined} open={open && !!anchor} onClosed={() => onClose?.()}>{children}</MenuEl>
}

/* ---- pieces Material Web does not ship: built to the M3 spec with the same tokens ---- */
export const Kpi = ({ value, label }) => (
  <div className="kpi"><div className="md-typescale-headline-small">{value}</div><div className="md-typescale-body-small muted">{label}</div></div>
)
export const KpiRow = ({ children }) => <div className="kpis">{children}</div>
export const Banner = ({ kind = 'info', onClose, children }) => (
  <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    <div className="grow">{children}</div>
    {onClose && <IconButton icon="close" label="Close" onClick={onClose} />}
  </div>
)
export const ErrorBox = ({ error, onClose }) => (error ? <Banner kind="error" onClose={onClose}>{String(error.message || error)}</Banner> : null)
export const Segmented = ({ value, onChange, options, label }) => (
  <div className="seg" role="group" aria-label={label}>
    {options.map((o) => (
      <button key={o.value} type="button" className={value === o.value ? 'on' : ''} aria-pressed={value === o.value} aria-label={o.label} title={o.label} onClick={() => onChange(o.value)}>
        <md-ripple></md-ripple>
        {value === o.value && <Icon name="check" />}
        {o.icon ? <Icon name={o.icon} /> : <span>{o.text}</span>}
      </button>
    ))}
  </div>
)
