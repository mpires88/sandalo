'use client'

import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

interface CategoryGroup {
  section: string
  accounts: string[]
}

interface Props {
  value: string
  onChange: (val: string) => void
  categories?: string[]
  groups?: CategoryGroup[] | null
  placeholder?: string
  style?: CSSProperties
  onCreate?: (name: string) => void
}

interface DropPos {
  top: number
  bottom: number
  left: number
  width: number
}

export default function CategoryInput({
  value,
  onChange,
  categories = [],
  groups = null,
  placeholder = '— no category —',
  style = {},
  onCreate,
}: Props) {
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const [dropPos, setDropPos] = useState<DropPos | null>(null)
  const [query, setQuery] = useState(value ?? '')
  const [mounted, setMounted] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])
  useEffect(() => {
    setQuery(value ?? '')
  }, [value])

  const displayItems = buildDisplayItems(groups, categories, query)
  const hasItems = displayItems.some(x => x.type === 'account')

  const select = (cat: string) => {
    setQuery(cat)
    onChange(cat)
    setOpen(false)
  }

  const openDropdown = () => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      setOpenUp(spaceBelow < 280)
      setDropPos({
        top: r.bottom + 2,
        bottom: window.innerHeight - r.top + 2,
        left: r.left,
        width: r.width,
      })
    }
    setOpen(true)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    onChange(e.target.value)
    openDropdown()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter') {
      const first = displayItems.find(x => x.type === 'account')
      if (first) select(first.name!)
    }
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Render dropdown as a portal so overflow:hidden parents never clip it
  const portal =
    mounted && open && dropPos && (hasItems || !!onCreate)
      ? createPortal(
          <div
            style={{
              position: 'fixed',
              top: openUp ? 'auto' : dropPos.top,
              bottom: openUp ? dropPos.bottom : 'auto',
              left: dropPos.left,
              width: dropPos.width,
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,.15)',
              zIndex: 9999,
              maxHeight: 260,
              overflowY: 'auto',
            }}
          >
            {displayItems.map((item, i) =>
              item.type === 'header' ? (
                <div key={`h-${i}`} style={headerSt}>
                  {item.section}
                </div>
              ) : (
                <div
                  key={item.name}
                  style={acctSt}
                  onMouseDown={() => select(item.name!)}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {groups ? <span style={{ paddingLeft: 8 }}>{item.name}</span> : item.name}
                </div>
              ),
            )}
            {onCreate && (
              <div
                style={createBtnSt}
                onMouseDown={() => {
                  onCreate(query)
                  setOpen(false)
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                + Create new account{query.trim() ? `: "${query.trim()}"` : ''}
              </div>
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', ...style }}>
      <input
        style={inpSt}
        value={query}
        onChange={handleChange}
        onFocus={openDropdown}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />
      {portal}
    </div>
  )
}

type DisplayItem =
  | { type: 'header'; section: string; name?: undefined }
  | { type: 'account'; name: string; section?: undefined }

function buildDisplayItems(groups: CategoryGroup[] | null, categories: string[], query: string): DisplayItem[] {
  const q = query.trim().toLowerCase()
  if (groups) {
    const items: DisplayItem[] = []
    for (const { section, accounts } of groups) {
      const filtered = q ? accounts.filter(a => a.toLowerCase().includes(q)) : accounts
      if (!filtered.length) continue
      items.push({ type: 'header', section })
      filtered.forEach(name => items.push({ type: 'account', name }))
    }
    return items
  }
  const filtered = q ? categories.filter(c => c.toLowerCase().includes(q)) : categories
  return filtered.map(name => ({ type: 'account', name }))
}

const inpSt: CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  color: '#111827',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
}
const headerSt: CSSProperties = {
  padding: '5px 10px 3px',
  fontSize: 10,
  fontWeight: 700,
  color: '#9ca3af',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  background: '#f9fafb',
  borderBottom: '1px solid #f3f4f6',
  userSelect: 'none',
  position: 'sticky',
  top: 0,
}
const acctSt: CSSProperties = {
  padding: '7px 10px',
  fontSize: 13,
  color: '#111827',
  cursor: 'pointer',
  background: 'transparent',
  userSelect: 'none',
}
const createBtnSt: CSSProperties = {
  padding: '7px 10px',
  fontSize: 12,
  fontWeight: 500,
  color: '#2C5F52',
  cursor: 'pointer',
  background: 'transparent',
  userSelect: 'none',
  borderTop: '1px solid #f3f4f6',
}
