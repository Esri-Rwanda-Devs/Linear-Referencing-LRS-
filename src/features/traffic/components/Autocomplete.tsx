import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

export interface AutoOption {
  /** Text put into the box when the option is chosen. */
  value: string
  /** Main text of the suggestion. */
  label: string
  /** Smaller text beside it, for example the number of sections. */
  hint?: string
}

interface Props {
  label: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  options: AutoOption[]
  /** Maximum suggestions shown. */
  limit?: number
  /** Compact form for toolbars: the label is only read by screen readers and there is no bottom margin. */
  compact?: boolean
}

/** Text of a suggestion with the typed part in bold. */
function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<strong>{text.slice(i, i + query.length)}</strong>{text.slice(i + query.length)}</>
}

/** Search box with a suggestion list (ARIA combobox): arrow keys, Enter, Escape and mouse all work. */
export function Autocomplete({ label, placeholder, value, onChange, options, limit = 8, compact = false }: Props) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    const scored = options
      .map((o) => {
        const hay = `${o.value} ${o.label}`.toLowerCase()
        const at = q ? hay.indexOf(q) : 0
        // Suggestions that start with the typed text come first.
        return { o, score: at < 0 ? -1 : o.value.toLowerCase().startsWith(q) || o.label.toLowerCase().startsWith(q) ? 0 : 1 }
      })
      .filter((x) => x.score >= 0)
    scored.sort((a, b) => a.score - b.score || a.o.value.localeCompare(b.o.value, undefined, { numeric: true }))
    return scored.slice(0, limit).map((x) => x.o)
  }, [options, value, limit])

  const choose = (o: AutoOption) => {
    onChange(o.value)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => (matches.length ? (a + 1) % matches.length : -1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => (matches.length ? (a <= 0 ? matches.length - 1 : a - 1) : -1))
    } else if (e.key === 'Enter' && open && active >= 0 && matches[active]) {
      e.preventDefault()
      choose(matches[active])
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false) }
    }
  }

  const showList = open && matches.length > 0

  return (
    <div className={`field autocomplete${compact ? ' compact' : ''}`}>
      <label htmlFor={`${id}-input`} className={compact ? 'sr-only' : undefined}><span>{label}</span></label>
      <div className="ac-box">
        <input
          id={`${id}-input`}
          ref={inputRef}
          className="input"
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1) }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); setActive(-1) }}
          onKeyDown={onKeyDown}
        />
        {value && (
          <button
            type="button"
            className="ac-clear"
            aria-label={`Clear ${label.toLowerCase()}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(''); inputRef.current?.focus() }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M2 2l8 8M10 2 2 10" /></svg>
          </button>
        )}
        {showList && (
          <ul className="ac-list" id={listId} role="listbox" aria-label={`${label} suggestions`}>
            {matches.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                // mousedown (not click) so the input keeps focus and the list doesn't close first
                onMouseDown={(e) => { e.preventDefault(); choose(o) }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="ac-main"><Highlight text={o.label} query={value.trim()} /></span>
                {o.hint && <span className="ac-hint">{o.hint}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
