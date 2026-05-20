'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const D = {
  sage: '#2C5F52', gold: '#C8A96E', charcoal: '#4A4A3F',
  page: '#F5F0E8', card: '#FAFAF8', border: '#D9D4C8',
  steel: '#4A7B6A', red: '#B94040',
  muted: 'rgba(74,74,63,0.55)',
}

export type StaffRole = 'Spa Therapist' | 'Esthetician' | 'Reception' | 'Event Coordinator' | 'Other'
export type StaffStatus = 'Active' | 'Inactive'

export interface StaffMember {
  id: string
  client_id: string
  name: string
  role: StaffRole
  status: StaffStatus
  phone: string
  email: string
  notes: string
}

const ROLES: StaffRole[] = ['Spa Therapist', 'Esthetician', 'Reception', 'Event Coordinator', 'Other']

const ROLE_COLORS: Record<StaffRole, string> = {
  'Spa Therapist':    '#2C5F52',
  'Esthetician':      '#6B5B3E',
  'Reception':        '#4A7B6A',
  'Event Coordinator':'#8B7355',
  'Other':            '#888',
}

interface StaffForm {
  id?: string
  name: string
  role: StaffRole
  status: StaffStatus
  phone: string
  email: string
  notes: string
}

const BLANK: StaffForm = {
  name: '', role: 'Spa Therapist', status: 'Active',
  phone: '', email: '', notes: '',
}

const SEED_KEY = 'sandalo_seeded_staff_v1'
const SEED_MEMBERS: Omit<StaffMember, 'id' | 'client_id'>[] = [
  { name: 'Maria Mesa',        role: 'Spa Therapist', status: 'Active', phone: '', email: '', notes: '' },
  { name: 'Steven Espinosa',   role: 'Spa Therapist', status: 'Active', phone: '', email: '', notes: '' },
  { name: 'Cristina Molina',   role: 'Spa Therapist', status: 'Active', phone: '', email: '', notes: '' },
  { name: 'Yonaira Vergara',   role: 'Spa Therapist', status: 'Active', phone: '', email: '', notes: '' },
  { name: 'Astrid Garcia',     role: 'Spa Therapist', status: 'Active', phone: '', email: '', notes: '' },
  { name: 'Sara Orrego',       role: 'Spa Therapist', status: 'Active', phone: '', email: '', notes: '' },
  { name: 'Emily Murphy',      role: 'Spa Therapist', status: 'Active', phone: '', email: '', notes: '' },
  { name: 'Sandra Puerta',     role: 'Spa Therapist', status: 'Active', phone: '', email: '', notes: '' },
  { name: 'Danyela Galeano',   role: 'Spa Therapist', status: 'Active', phone: '', email: '', notes: '' },
  { name: 'Wages',             role: 'Reception',     status: 'Active', phone: '', email: '', notes: '' },
]

export default function Staff({ clientId }: { clientId: string }) {
  const [staff, setStaff]       = useState<StaffMember[]>([])
  const [ytdPaid, setYtdPaid]   = useState<Record<string, number>>({})
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [modal, setModal]       = useState(false)
  const [form, setForm]         = useState<StaffForm>({ ...BLANK })
  const [saving, setSaving]     = useState(false)
  const [formErr, setFormErr]   = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (typeof window !== 'undefined' && !localStorage.getItem(SEED_KEY)) {
        await supabase.from('staff')
          .upsert(
            SEED_MEMBERS.map(m => ({ client_id: clientId, ...m })),
            { onConflict: 'client_id,name', ignoreDuplicates: true }
          )
        localStorage.setItem(SEED_KEY, '1')
      }

      const { data, error: err } = await supabase
        .from('staff').select('*').eq('client_id', clientId).order('name')
      if (err) { setError(err.message); return }
      setStaff(data ?? [])

      // Load YTD compensation from bank transactions
      const yearStart = `${new Date().getFullYear()}-01-01`
      const staffNames = (data ?? []).map((m: StaffMember) => m.name)
      if (staffNames.length > 0) {
        const { data: txnData } = await supabase
          .from('bank_transactions')
          .select('account, amount')
          .eq('client_id', clientId)
          .gte('transaction_date', yearStart)
          .in('account', staffNames)
        const ytd: Record<string, number> = {}
        for (const t of (txnData ?? [])) {
          if (!ytd[t.account]) ytd[t.account] = 0
          ytd[t.account] += Math.abs(parseFloat(t.amount) || 0)
        }
        setYtdPaid(ytd)
      }
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setForm({ ...BLANK })
    setFormErr('')
    setModal(true)
  }

  function openEdit(m: StaffMember) {
    setForm({ id: m.id, name: m.name, role: m.role, status: m.status, phone: m.phone, email: m.email, notes: m.notes })
    setFormErr('')
    setModal(true)
  }

  function closeModal() { setModal(false) }

  async function save() {
    if (!form.name.trim()) { setFormErr('Name is required.'); return }
    setSaving(true)
    try {
      const name = form.name.trim()
      if (form.id) {
        await supabase.from('staff').update({
          name, role: form.role, status: form.status,
          phone: form.phone.trim(), email: form.email.trim(), notes: form.notes.trim(),
        }).eq('id', form.id)

        // Sync linked COA entry name if it changed
        const existing = staff.find(m => m.id === form.id)
        if (existing && existing.name !== name) {
          await supabase.from('categories')
            .update({ name })
            .eq('staff_id', form.id)
            .eq('client_id', clientId)
        }
      } else {
        const { data: newStaff } = await supabase.from('staff').insert({
          client_id: clientId,
          name, role: form.role, status: form.status,
          phone: form.phone.trim(), email: form.email.trim(), notes: form.notes.trim(),
        }).select('id').single()

        // Auto-create COA entry under Therapist Compensation
        if (newStaff?.id) {
          const { data: maxData } = await supabase
            .from('categories').select('sort_order')
            .eq('client_id', clientId)
            .order('sort_order', { ascending: false })
            .limit(1)
            .single()
          await supabase.from('categories').insert({
            client_id: clientId,
            name,
            sort_order: (maxData?.sort_order ?? 0) + 10,
            pl_section: 'Operating Expenses',
            parent: 'Therapist Compensation',
            staff_id: newStaff.id,
          })
        }
      }
      closeModal()
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setDeleting(id)
    try {
      await supabase.from('staff').delete().eq('id', id)
      setStaff(prev => prev.filter(m => m.id !== id))
    } finally {
      setDeleting(null)
    }
  }

  const byRole = (role: StaffRole) => staff.filter(m => m.status === 'Active' && m.role === role).length
  const active = staff.filter(m => m.status === 'Active').length

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: D.muted }}>
      Loading staff…
    </div>
  )

  if (error) return (
    <div style={{ padding: 32, color: D.red }}>{error}</div>
  )

  return (
    <div style={{ padding: '28px 32px', background: D.page, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: D.charcoal }}>Staff Directory</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: D.muted }}>
            Therapists, estheticians, and support staff
          </p>
        </div>
        <button onClick={openAdd} style={{
          background: D.sage, color: '#fff', border: 'none', borderRadius: 6,
          padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          + Add Staff
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Active', value: active },
          { label: 'Spa Therapists', value: byRole('Spa Therapist') },
          { label: 'Estheticians', value: byRole('Esthetician') },
          { label: 'Reception', value: byRole('Reception') },
        ].map(c => (
          <div key={c.label} style={{
            background: D.card, border: `1px solid ${D.border}`, borderRadius: 8,
            padding: '12px 20px', minWidth: 120,
          }}>
            <div style={{ fontSize: 11, color: D.muted, marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: D.charcoal }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {staff.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>
            No staff members yet. Click "+ Add Staff" to get started.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F0EBE0', borderBottom: `1px solid ${D.border}` }}>
                {['Name', 'Role', 'Status', 'Phone', 'Email', 'Notes', 'YTD Paid', ''].map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', textAlign: 'left', fontWeight: 600,
                    color: D.charcoal, fontSize: 11.5, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((m, i) => (
                <tr key={m.id} style={{
                  borderBottom: i < staff.length - 1 ? `1px solid ${D.border}` : 'none',
                  background: i % 2 === 0 ? D.card : '#F7F4EE',
                }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: D.charcoal }}>{m.name}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      background: ROLE_COLORS[m.role] + '18',
                      color: ROLE_COLORS[m.role],
                      border: `1px solid ${ROLE_COLORS[m.role]}40`,
                      borderRadius: 4, padding: '2px 8px', fontSize: 11.5, fontWeight: 500,
                    }}>
                      {m.role}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      background: m.status === 'Active' ? '#2E7D5218' : '#88888818',
                      color: m.status === 'Active' ? '#2E7D52' : '#888',
                      border: `1px solid ${m.status === 'Active' ? '#2E7D5240' : '#88888840'}`,
                      borderRadius: 4, padding: '2px 8px', fontSize: 11.5, fontWeight: 500,
                    }}>
                      {m.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: m.phone ? D.charcoal : D.muted }}>
                    {m.phone || '—'}
                  </td>
                  <td style={{ padding: '10px 14px', color: m.email ? D.charcoal : D.muted }}>
                    {m.email || '—'}
                  </td>
                  <td style={{ padding: '10px 14px', color: D.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.notes || '—'}
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 600, color: ytdPaid[m.name] ? D.sage : D.muted }}>
                    {ytdPaid[m.name] ? `$${ytdPaid[m.name].toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openEdit(m)} style={{
                      background: 'transparent', border: `1px solid ${D.border}`,
                      borderRadius: 4, padding: '3px 10px', fontSize: 11.5,
                      cursor: 'pointer', color: D.charcoal, marginRight: 6,
                    }}>Edit</button>
                    <button
                      onClick={() => remove(m.id)}
                      disabled={deleting === m.id}
                      style={{
                        background: 'transparent', border: `1px solid ${D.red}40`,
                        borderRadius: 4, padding: '3px 10px', fontSize: 11.5,
                        cursor: 'pointer', color: D.red,
                        opacity: deleting === m.id ? 0.5 : 1,
                      }}
                    >
                      {deleting === m.id ? '…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{
            background: '#fff', borderRadius: 10, width: 480, maxWidth: '95vw',
            padding: 28, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700, color: D.charcoal }}>
              {form.id ? 'Edit Staff Member' : 'Add Staff Member'}
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Full name"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Role</label>
                <select
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value as StaffRole }))}
                  style={inputStyle}
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as StaffStatus }))}
                  style={inputStyle}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="(617) 555-0000"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="name@example.com"
                  style={inputStyle}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Certifications, schedule notes, etc."
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
            </div>

            {formErr && (
              <div style={{ marginTop: 12, color: D.red, fontSize: 12 }}>{formErr}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={closeModal} style={{
                background: 'transparent', border: `1px solid ${D.border}`,
                borderRadius: 6, padding: '8px 18px', fontSize: 13, cursor: 'pointer', color: D.charcoal,
              }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{
                background: D.sage, color: '#fff', border: 'none',
                borderRadius: 6, padding: '8px 18px', fontSize: 13,
                fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}>
                {saving ? 'Saving…' : (form.id ? 'Save Changes' : 'Add Staff')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11.5, fontWeight: 600,
  color: 'rgba(74,74,63,0.7)', marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13,
  border: '1px solid #D9D4C8', borderRadius: 5,
  background: '#fff', color: '#4A4A3F', boxSizing: 'border-box',
}
