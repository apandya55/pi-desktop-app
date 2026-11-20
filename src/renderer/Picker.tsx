import { Command } from 'cmdk'
import { Check, ChevronDown, Search } from 'lucide-react'
import { DropdownMenu, Popover } from 'radix-ui'
import { useState } from 'react'
import type { ReactNode } from 'react'
import './menus.css'

export interface Option {
  id: string
  label: string
  detail?: string
  tooltip?: string
  icon?: ReactNode
}

interface Props {
  label: string
  icon?: ReactNode
  title: string
  triggerId?: string
  triggerClassName?: string
  options: Option[]
  value?: string
  open: boolean
  disabled?: boolean
  searchLabel?: string
  emptyText?: string
  heading?: string
  variant?: 'model' | 'folder' | 'thinking'
  side?: 'top' | 'bottom'
  align?: 'left' | 'right'
  action?: { label: string; icon?: ReactNode; run: () => void }
  onToggle: () => void
  onClose: () => void
  onSelect: (id: string) => void
}

function OptionContent({ option, checked }: { option: Option; checked: boolean }) {
  return <>
    {option.icon}
    <span className="menu-row-label"><strong>{option.label}</strong></span>
    {option.detail && <small className="menu-row-detail">{option.detail}</small>}
    {checked && <Check size={13} className="menu-check" aria-hidden="true" />}
  </>
}

function SearchableOptions({ searchLabel, title, heading, emptyText, options, value, action, onSelect }: {
  searchLabel: string
} & Pick<Props, 'title' | 'heading' | 'emptyText' | 'options' | 'value' | 'action' | 'onSelect'>) {
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase()
  const matches = options.filter((option) => {
    const searchable = [option.label, option.detail, option.tooltip].join(' ').toLowerCase()
    return searchable.includes(search)
  })
  return (
    <Command label={title} className="menu-command" shouldFilter={false} loop>
      <label className="menu-search">
        <Search size={14} aria-hidden="true" />
        <Command.Input value={query} onValueChange={setQuery} placeholder={searchLabel + '…'} aria-label={searchLabel} />
      </label>
      <Command.List className="menu-list" label={title}>
        <div className="menu-results">
          {heading && matches.length > 0 && <div className="menu-heading">{heading}</div>}
          {matches.map((option) => (
            <Command.Item key={option.id} value={'option:' + option.id} className="menu-row"
              title={option.tooltip} data-checked={value === option.id || undefined} onSelect={() => onSelect(option.id)}>
              <OptionContent option={option} checked={value === option.id} />
            </Command.Item>
          ))}
          {matches.length === 0 && (search || emptyText) && <div className="menu-empty" role="status">
            {search ? 'No matches.' : emptyText}
          </div>}
        </div>
        {action && (
          <div className="menu-footer">
            <Command.Item value="action:picker-footer" className="menu-row" onSelect={action.run}>
              {action.icon}{action.label}
            </Command.Item>
          </div>
        )}
      </Command.List>
    </Command>
  )
}

export function Picker({ label, icon, title, triggerId, triggerClassName,
  options, value, open, disabled, searchLabel, emptyText, heading, variant, side = 'top',
  align = 'right', action, onToggle, onClose, onSelect }: Props) {
  const trigger = (
    <button id={triggerId} className={['ghost-button picker-trigger', triggerClassName].filter(Boolean).join(' ')}
      type="button" title={`${title}: ${label}`} aria-label={`${title}: ${label}`} disabled={disabled}>
      {icon}<span>{label}</span><ChevronDown className="picker-chevron" size={11} aria-hidden="true" />
    </button>
  )
  const content = {
    className: 'menu-surface',
    side,
    align: align === 'left' ? 'start' as const : 'end' as const,
    sideOffset: 6,
    collisionPadding: 8,
    'aria-label': title,
    'data-variant': variant,
  }
  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen) onToggle()
    else onClose()
  }
  const choose = (id: string) => {
    onClose()
    onSelect(id)
  }
  const runAction = () => {
    onClose()
    action?.run()
  }

  return (
    <div className="picker">
      {searchLabel ? (
        <Popover.Root open={open} onOpenChange={changeOpen}>
          <Popover.Trigger asChild>{trigger}</Popover.Trigger>
          <Popover.Portal>
            <Popover.Content {...content} data-searchable="true">
              <SearchableOptions searchLabel={searchLabel} title={title} heading={heading} emptyText={emptyText}
                options={options} value={value} action={action && { ...action, run: runAction }} onSelect={choose} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        <DropdownMenu.Root open={open} onOpenChange={changeOpen} modal={false}>
          <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content {...content} loop>
              <DropdownMenu.Label className="menu-heading">{heading ?? title}</DropdownMenu.Label>
              <DropdownMenu.RadioGroup value={value} className="menu-list" onValueChange={onSelect}>
                {options.map((option) => (
                  <DropdownMenu.RadioItem className="menu-row" key={option.id} value={option.id} textValue={option.label}
                    title={option.tooltip}>
                    <OptionContent option={option} checked={value === option.id} />
                  </DropdownMenu.RadioItem>
                ))}
                {options.length === 0 && emptyText && <div className="menu-empty">{emptyText}</div>}
              </DropdownMenu.RadioGroup>
              {action && <>
                <DropdownMenu.Separator className="menu-divider" />
                <DropdownMenu.Item className="menu-row menu-action" onSelect={action.run}>
                  {action.icon}{action.label}
                </DropdownMenu.Item>
              </>}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  )
}
