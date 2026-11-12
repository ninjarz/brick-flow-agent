import { useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

type Props = {
  value: string
  models: string[]
  label: string
  placeholder: string
  onChange: (value: string) => void
}

export const ModelNameInput = ({ value, models, label, placeholder, onChange }: Props) => {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(-1)
  const options = models.filter(model => model.toLowerCase().includes(filter.toLowerCase()))
  const expanded = open && models.length > 0 && options.length > 0
  const choose = (model: string) => {
    onChange(model)
    setOpen(false)
    input.current?.focus()
  }
  return (
    <div className="model-name-combobox" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <input ref={input} id={id} aria-label={label} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-options`} aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
        value={value} placeholder={placeholder} autoComplete="off"
        onChange={event => { onChange(event.target.value); setFilter(event.target.value); setActive(-1); setOpen(true) }}
        onKeyDown={event => {
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && models.length) {
            event.preventDefault()
            if (!expanded) { setFilter(''); setOpen(true); setActive(event.key === 'ArrowDown' ? 0 : models.length - 1) }
            else setActive(index => event.key === 'ArrowDown' ? Math.min(index + 1, options.length - 1) : Math.max(index - 1, 0))
          }
          if (event.key === 'Enter' && expanded && options[active]) { event.preventDefault(); choose(options[active]) }
          if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) }
        }} />
      {models.length > 0 && <button type="button" className="model-name-toggle" aria-label={label} aria-expanded={expanded} onClick={() => { setFilter(''); setActive(-1); setOpen(!expanded); input.current?.focus() }}><ChevronDown size={16} /></button>}
      {expanded && <ul id={`${id}-options`} className="model-name-options" role="listbox" aria-label={label}>
        {options.map((model, index) => <li key={model} id={`${id}-option-${index}`} role="option" aria-selected={index === active} onMouseDown={event => event.preventDefault()} onClick={() => choose(model)}>{model}</li>)}
      </ul>}
    </div>
  )
}
