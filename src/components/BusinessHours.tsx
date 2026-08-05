'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { CLIENT_ID } from '@/constants'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface BusinessHour {
  id?: string
  day_of_week: number
  is_open: boolean
  open_time: string
  close_time: string
}

const T = {
  sage: '#2C5F52', gold: '#C8A96E', charcoal: '#4A4A3F',
  card: '#FAFAF8', border: '#D9D4C8',
  muted: 'rgba(74,74,63,0.45)',
}

const sel: React.CSSProperties = {
  padding: '5px 9px', border: `1px solid ${T.border}`,
  borderRadius: 5, fontSize: 12, color: T.charcoal, background: '#fff',
}

function TimeSelect({ value, onChange, after }: {
  value: string; onChange: (v: string) => void; after?: string
}) {
  const normalized = value ? value.slice(0, 5) : ''
  const min = after ? after.slice(0, 5) : null
  const slots: string[] = []
  for (let h = 0; h < 24; h++)
    for (let m = 0; m < 60; m += 15) {
      const s = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      if (!min || s > min) slots.push(s)
    }
  const fmt = (s: string) => {
    const [h, m] = s.split(':').map(Number)
    const ampm = h < 12 ? 'AM' : 'PM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  }
  return (
    <select value={normalized} onChange={e => onChange(e.target.value)} style={sel}>
      <option value="">— Select —</option>
      {slots.map(s => <option key={s} value={s}>{fmt(s)}</option>)}
    </select>
  )
}

export default function BusinessHours() {
  const [hours,   setHours]   = useState<BusinessHour[]>(
    DAYS.map((_, i) => ({ day_of_week: i, is_open: i >= 1 && i <= 5, open_time: '09:00', close_time: '18:00' }))
  )
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [dirty,   setDirty]   = useState(false)
  const [saved,   setSaved]   = useState(false)

  useEffect(() => {
    supabase.from('business_hours').select('*').eq('client_id', CLIENT_ID).order('day_of_week')
      .then(({ data }) => {
        if (data && data.length > 0) {
          const map = new Map(data.map((r: Record<string, unknown>) => [r.day_of_week as number, r]))
          setHours(DAYS.map((_, i) => {
            const r = map.get(i) as Record<string, unknown> | undefined
            return r
              ? { id: r.id as string, day_of_week: i, is_open: r.is_open as boolean, open_time: ((r.open_time as string) ?? '09:00').slice(0, 5), close_time: ((r.close_time as string) ?? '18:00').slice(0, 5) }
              : { day_of_week: i, is_open: false, open_time: '09:00', close_time: '18:00' }
          }))
        }
        setLoading(false)
      })
  }, [])

  const update = (dow: number, patch: Partial<BusinessHour>) => {
    setHours(prev => prev.map(h => h.day_of_week === dow ? { ...h, ...patch } : h))
    setDirty(true); setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    try {
      const { error } = await supabase.from('business_hours').upsert(
        hours.map(h => ({
          client_id:  CLIENT_ID,
          day_of_week: h.day_of_week,
          is_open:    h.is_open,
          open_time:  h.is_open ? (h.open_time  || null) : null,
          close_time: h.is_open ? (h.close_time || null) : null,
        })),
        { onConflict: 'client_id,day_of_week' }
      )
      if (error) throw error
      setDirty(false); setSaved(true)
    } catch (e) { alert('Failed to save: ' + String(e)) }
    finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
      <div style={{ width: 24, height: 24, border: `2px solid ${T.border}`, borderTopColor: T.sage, borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ padding: '28px 32px', maxWidth: 620 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: T.sage, margin: '0 0 3px' }}>Hours of Operation</h1>
          <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>Set the days and times your business is open</p>
        </div>
        <button
          onClick={save}
          disabled={saving || !dirty}
          style={{ background: dirty ? T.sage : T.border, color: dirty ? '#fff' : T.muted, border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: dirty && !saving ? 'pointer' : 'default', transition: 'background .2s' }}
        >
          {saving ? 'Saving…' : saved && !dirty ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      <section>
        <h2 style={{ fontSize: 10.5, fontWeight: 700, color: T.gold, textTransform: 'uppercase' as const, letterSpacing: '.07em', margin: '0 0 12px' }}>
          Hours of Operation
        </h2>
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {hours.map((h, i) => (
            <div key={h.day_of_week} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '11px 18px', borderBottom: i < 6 ? `1px solid ${T.border}` : 'none' }}>

              {/* Toggle */}
              <button
                onClick={() => update(h.day_of_week, { is_open: !h.is_open })}
                style={{ flexShrink: 0, width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', background: h.is_open ? T.sage : T.border, position: 'relative', transition: 'background .2s' }}
              >
                <div style={{ position: 'absolute', top: 3, left: h.is_open ? 18 : 3, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </button>

              {/* Day name */}
              <span style={{ width: 90, fontSize: 13, fontWeight: 500, color: h.is_open ? T.charcoal : T.muted }}>
                {DAYS[h.day_of_week]}
              </span>

              {/* Times or Closed */}
              {h.is_open ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TimeSelect
                    value={h.open_time}
                    onChange={v => update(h.day_of_week, { open_time: v, close_time: h.close_time && h.close_time <= v ? '' : h.close_time })}
                  />
                  <span style={{ fontSize: 11, color: T.muted }}>to</span>
                  <TimeSelect
                    value={h.close_time}
                    onChange={v => update(h.day_of_week, { close_time: v })}
                    after={h.open_time}
                  />
                </div>
              ) : (
                <span style={{ fontSize: 12, color: T.muted, fontStyle: 'italic' }}>Closed</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
