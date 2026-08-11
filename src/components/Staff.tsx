'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { CLIENT_ID } from '@/constants'

const D = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  card: '#FAFAF8',
  border: '#D9D4C8',
  steel: '#4A7B6A',
  red: '#B94040',
  green: '#2E7D52',
  muted: 'rgba(74,74,63,0.55)',
}

const ROLES = ['Massage Therapist', 'Esthetician', 'Front Desk', 'Event Coordinator'] as const
type Role = (typeof ROLES)[number]

const ROLE_COLORS: Record<Role, string> = {
  'Massage Therapist': '#2C5F52',
  Esthetician: '#6B5B3E',
  'Front Desk': '#4A7B6A',
  'Event Coordinator': '#8B7355',
}

const LICENSE_TYPES = ['massage', 'esthetics', 'cosmetology', 'other'] as const

interface StaffMember {
  id: string
  client_id: string
  name: string
  roles: string[]
  role: string
  employment_type: string
  commission_rate: number | null
  preferred_language: string
  phone: string | null
  email: string | null
  status: string
}

interface StaffLicense {
  id: string
  staff_id: string
  license_type: string
  license_number: string | null
  issued_date: string | null
  expiry_date: string | null
  status: string
  notes: string | null
}

interface StaffForm {
  id?: string
  name: string
  roles: string[]
  employment_type: string
  commission_rate: string
  preferred_language: string
  phone: string
  email: string
  status: string
}

interface LicenseForm {
  id?: string
  license_type: string
  license_number: string
  issued_date: string
  expiry_date: string
  notes: string
}

const BLANK_FORM: StaffForm = {
  name: '',
  roles: [],
  employment_type: 'contractor',
  commission_rate: '',
  preferred_language: 'en',
  phone: '',
  email: '',
  status: 'Active',
}

const BLANK_LICENSE: LicenseForm = {
  license_type: 'massage',
  license_number: '',
  issued_date: '',
  expiry_date: '',
  notes: '',
}

export default function Staff() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [licenses, setLics] = useState<Record<string, StaffLicense[]>>({})
  const [ytdPaid, setYtdPaid] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modal, setModal] = useState(false)
  const [tab, setTab] = useState<'profile' | 'licenses'>('profile')
  const [form, setForm] = useState<StaffForm>({ ...BLANK_FORM })
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')

  const [licForm, setLicForm] = useState<LicenseForm>({ ...BLANK_LICENSE })
  const [licSaving, setLicSaving] = useState(false)
  const [editingLicId, setEditingLicId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase.from('staff').select('*').eq('client_id', CLIENT_ID).order('name')
      if (err) {
        setError(err.message)
        return
      }
      setStaff(data ?? [])

      if (data && data.length > 0) {
        const ids = data.map((m: StaffMember) => m.id)
        const { data: licData } = await supabase
          .from('staff_licenses')
          .select('*')
          .eq('client_id', CLIENT_ID)
          .in('staff_id', ids)
          .order('expiry_date', { ascending: true })
        const grouped: Record<string, StaffLicense[]> = {}
        for (const l of licData ?? []) {
          if (!grouped[l.staff_id]) grouped[l.staff_id] = []
          grouped[l.staff_id].push(l)
        }
        setLics(grouped)

        const yearStart = `${new Date().getFullYear()}-01-01`
        const names = data.map((m: StaffMember) => m.name)
        const { data: txnData } = await supabase
          .from('bank_transactions')
          .select('account, amount')
          .eq('client_id', CLIENT_ID)
          .gte('transaction_date', yearStart)
          .in('account', names)
        const ytd: Record<string, number> = {}
        for (const t of txnData ?? []) {
          ytd[t.account] = (ytd[t.account] ?? 0) + Math.abs(parseFloat(t.amount) || 0)
        }
        setYtdPaid(ytd)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openAdd() {
    setForm({ ...BLANK_FORM })
    setFormErr('')
    setTab('profile')
    setModal(true)
  }

  function openEdit(m: StaffMember) {
    const roles = m.roles?.length ? m.roles : m.role ? [m.role] : []
    setForm({
      id: m.id,
      name: m.name,
      roles,
      employment_type: m.employment_type || 'contractor',
      commission_rate: m.commission_rate != null ? String(m.commission_rate) : '',
      preferred_language: m.preferred_language || 'en',
      phone: m.phone || '',
      email: m.email || '',
      status: m.status || 'Active',
    })
    setFormErr('')
    setLicForm({ ...BLANK_LICENSE })
    setEditingLicId(null)
    setTab('profile')
    setModal(true)
  }

  function toggleRole(r: string) {
    setForm(f => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter(x => x !== r) : [...f.roles, r],
    }))
  }

  async function save() {
    if (!form.name.trim()) {
      setFormErr('Name is required.')
      return
    }
    setSaving(true)
    setFormErr('')
    try {
      const payload = {
        name: form.name.trim(),
        roles: form.roles,
        role: form.roles[0] ?? '',
        employment_type: form.employment_type,
        commission_rate: form.commission_rate ? parseFloat(form.commission_rate) : null,
        preferred_language: form.preferred_language,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        status: form.status,
      }

      if (form.id) {
        const { error: err } = await supabase.from('staff').update(payload).eq('id', form.id)
        if (err) {
          setFormErr(err.message)
          return
        }
        const existing = staff.find(m => m.id === form.id)
        if (existing && existing.name !== payload.name) {
          // The payroll category must follow the rename or P&L rollups diverge
          const { error: catErr } = await supabase
            .from('categories')
            .update({ name: payload.name })
            .eq('staff_id', form.id)
            .eq('client_id', CLIENT_ID)
          if (catErr) {
            setFormErr(`Saved, but the payroll category rename failed: ${catErr.message}`)
            return
          }
        }
      } else {
        const { data: created, error: err } = await supabase
          .from('staff')
          .insert({ client_id: CLIENT_ID, ...payload })
          .select('id')
          .single()
        if (err) {
          setFormErr(err.message)
          return
        }
        if (created?.id) {
          const { data: maxData } = await supabase
            .from('categories')
            .select('sort_order')
            .eq('client_id', CLIENT_ID)
            .order('sort_order', { ascending: false })
            .limit(1)
            .single()
          const { error: catErr } = await supabase.from('categories').insert({
            client_id: CLIENT_ID,
            name: payload.name,
            sort_order: (maxData?.sort_order ?? 0) + 10,
            pl_section: 'Operating Expenses',
            parent: 'Therapist Compensation',
            staff_id: created.id,
          })
          if (catErr) {
            setFormErr(`Staff member created, but their payroll category failed: ${catErr.message}`)
            return
          }
        }
      }

      setModal(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function saveLicense() {
    if (!form.id) return
    setLicSaving(true)
    try {
      const isExpired = licForm.expiry_date ? new Date(licForm.expiry_date) < new Date() : false
      const payload = {
        client_id: CLIENT_ID,
        staff_id: form.id,
        license_type: licForm.license_type,
        license_number: licForm.license_number.trim() || null,
        issued_date: licForm.issued_date || null,
        expiry_date: licForm.expiry_date || null,
        notes: licForm.notes.trim() || null,
        status: isExpired ? 'expired' : 'active',
      }
      const { error: licErr } = editingLicId
        ? await supabase.from('staff_licenses').update(payload).eq('id', editingLicId)
        : await supabase.from('staff_licenses').insert(payload)
      if (licErr) {
        alert(`License not saved: ${licErr.message}`)
        return
      }
      setLicForm({ ...BLANK_LICENSE })
      setEditingLicId(null)
      await load()
    } finally {
      setLicSaving(false)
    }
  }

  async function deleteLicense(licId: string) {
    const { error } = await supabase.from('staff_licenses').delete().eq('id', licId)
    if (error) {
      alert(`Delete failed: ${error.message}`)
      return
    }
    await load()
  }

  async function removeStaff(id: string) {
    setDeleting(id)
    try {
      const { error } = await supabase.from('staff').delete().eq('id', id)
      if (error) {
        // Likely FK-protected (has appointments) — don't drop them from the list
        alert(
          error.code === '23503'
            ? 'This staff member has appointment history and cannot be deleted. Set them to Inactive instead.'
            : `Delete failed: ${error.message}`,
        )
        return
      }
      setStaff(prev => prev.filter(m => m.id !== id))
    } finally {
      setDeleting(null)
    }
  }

  function licStatus(lic: StaffLicense): { label: string; color: string } {
    if (!lic.expiry_date) return { label: 'Active', color: D.green }
    const days = Math.floor((new Date(lic.expiry_date).getTime() - Date.now()) / 86400000)
    if (days < 0) return { label: 'Expired', color: D.red }
    if (days < 90) return { label: `${days}d`, color: '#B87400' }
    return { label: 'Active', color: D.green }
  }

  function licSummary(staffId: string): { label: string; color: string } | null {
    const lics = licenses[staffId] ?? []
    if (!lics.length) return null
    const expired = lics.filter(l => l.expiry_date && new Date(l.expiry_date) < new Date()).length
    const expiring = lics.filter(l => {
      if (!l.expiry_date) return false
      const d = Math.floor((new Date(l.expiry_date).getTime() - Date.now()) / 86400000)
      return d >= 0 && d < 90
    }).length
    if (expired) return { label: `${expired} expired`, color: D.red }
    if (expiring) return { label: `${expiring} expiring`, color: '#B87400' }
    return { label: `${lics.length} active`, color: D.green }
  }

  if (loading)
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: D.muted }}>
        Loading…
      </div>
    )
  if (error) return <div style={{ padding: 32, color: D.red }}>{error}</div>

  const active = staff.filter(m => m.status === 'Active').length
  const currentLics = form.id ? (licenses[form.id] ?? []) : []

  return (
    <div style={{ padding: '28px 32px', background: D.page, minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: D.charcoal }}>Staff</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: D.muted }}>
            {active} active · {staff.length} total
          </p>
        </div>
        <button
          onClick={openAdd}
          style={{
            background: D.sage,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Add Staff
        </button>
      </div>

      <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {staff.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>
            No staff yet. Click "+ Add Staff" to get started.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F0EBE0', borderBottom: `1px solid ${D.border}` }}>
                {['Name', 'Roles', 'Lang', 'Type', 'Phone', 'Licenses', 'YTD Paid', ''].map(h => (
                  <th
                    key={h}
                    style={{
                      padding: '10px 14px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: D.charcoal,
                      fontSize: 11.5,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((m, i) => {
                const displayRoles = m.roles?.length ? m.roles : m.role ? [m.role] : []
                const licBadge = licSummary(m.id)
                return (
                  <tr
                    key={m.id}
                    style={{
                      borderBottom: i < staff.length - 1 ? `1px solid ${D.border}` : 'none',
                      background: i % 2 === 0 ? D.card : '#F7F4EE',
                      opacity: m.status === 'Inactive' ? 0.5 : 1,
                    }}
                  >
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: D.charcoal }}>
                      {m.name}
                      {m.status === 'Inactive' && (
                        <span style={{ marginLeft: 6, fontSize: 10.5, color: D.muted, fontWeight: 400 }}>Inactive</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {displayRoles.length === 0 ? (
                          <span style={{ color: D.muted }}>—</span>
                        ) : (
                          displayRoles.map(r => {
                            const c = (ROLE_COLORS as Record<string, string>)[r] ?? '#888'
                            return (
                              <span
                                key={r}
                                style={{
                                  background: c + '18',
                                  color: c,
                                  border: `1px solid ${c}40`,
                                  borderRadius: 4,
                                  padding: '2px 7px',
                                  fontSize: 11,
                                  fontWeight: 500,
                                }}
                              >
                                {r}
                              </span>
                            )
                          })
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          background: m.preferred_language === 'es' ? D.gold + '28' : D.sage + '1A',
                          color: m.preferred_language === 'es' ? '#8B6914' : D.sage,
                          border: `1px solid ${m.preferred_language === 'es' ? D.gold + '70' : D.sage + '50'}`,
                          borderRadius: 4,
                          padding: '2px 7px',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {(m.preferred_language || 'en').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: D.muted, fontSize: 12 }}>
                      {m.employment_type === 'employee' ? 'Employee' : 'Contractor'}
                    </td>
                    <td style={{ padding: '10px 14px', color: m.phone ? D.charcoal : D.muted }}>{m.phone || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {licBadge ? (
                        <span
                          style={{
                            background: licBadge.color + '18',
                            color: licBadge.color,
                            border: `1px solid ${licBadge.color}40`,
                            borderRadius: 4,
                            padding: '2px 7px',
                            fontSize: 11,
                            fontWeight: 500,
                          }}
                        >
                          {licBadge.label}
                        </span>
                      ) : (
                        <span style={{ color: D.muted }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: ytdPaid[m.name] ? D.sage : D.muted }}>
                      {ytdPaid[m.name]
                        ? `$${ytdPaid[m.name].toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                        : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <button onClick={() => openEdit(m)} style={actionBtn}>
                        Edit
                      </button>
                      <button
                        onClick={() => removeStaff(m.id)}
                        disabled={deleting === m.id}
                        style={{
                          ...dangerBtn,
                          opacity: deleting === m.id ? 0.5 : 1,
                        }}
                      >
                        {deleting === m.id ? '…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={e => {
            if (e.target === e.currentTarget) setModal(false)
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              width: 520,
              maxWidth: '95vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
          >
            {/* Header */}
            <div style={{ padding: '20px 24px 0', borderBottom: `1px solid ${D.border}` }}>
              <h2 style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 700, color: D.charcoal }}>
                {form.id ? form.name || 'Edit Staff' : 'Add Staff Member'}
              </h2>
              {form.id && (
                <div style={{ display: 'flex' }}>
                  {(['profile', 'licenses'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      style={{
                        background: 'none',
                        border: 'none',
                        borderBottom: tab === t ? `2px solid ${D.sage}` : '2px solid transparent',
                        padding: '6px 14px',
                        fontSize: 13,
                        fontWeight: tab === t ? 600 : 400,
                        color: tab === t ? D.sage : D.muted,
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                      }}
                    >
                      {t === 'licenses' ? `Licenses${currentLics.length ? ` (${currentLics.length})` : ''}` : 'Profile'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Body */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {tab === 'profile' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={lbl}>Name *</label>
                    <input
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Full name"
                      style={inp}
                    />
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={lbl}>Roles</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      {ROLES.map(r => {
                        const on = form.roles.includes(r)
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => toggleRole(r)}
                            style={{
                              background: on ? D.sage : 'transparent',
                              color: on ? '#fff' : D.charcoal,
                              border: `1px solid ${on ? D.sage : D.border}`,
                              borderRadius: 6,
                              padding: '5px 12px',
                              fontSize: 12.5,
                              fontWeight: on ? 600 : 400,
                              cursor: 'pointer',
                            }}
                          >
                            {r}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <label style={lbl}>Employment Type</label>
                    <select
                      value={form.employment_type}
                      onChange={e => setForm(f => ({ ...f, employment_type: e.target.value }))}
                      style={inp}
                    >
                      <option value="contractor">Contractor</option>
                      <option value="employee">Employee</option>
                    </select>
                  </div>

                  <div>
                    <label style={lbl}>Commission %</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={form.commission_rate}
                      onChange={e => setForm(f => ({ ...f, commission_rate: e.target.value }))}
                      placeholder="e.g. 40"
                      style={inp}
                    />
                  </div>

                  <div>
                    <label style={lbl}>Language</label>
                    <select
                      value={form.preferred_language}
                      onChange={e => setForm(f => ({ ...f, preferred_language: e.target.value }))}
                      style={inp}
                    >
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                    </select>
                  </div>

                  <div>
                    <label style={lbl}>Status</label>
                    <select
                      value={form.status}
                      onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                      style={inp}
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>

                  <div>
                    <label style={lbl}>Phone</label>
                    <input
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="(617) 555-0000"
                      style={inp}
                    />
                  </div>

                  <div>
                    <label style={lbl}>Email</label>
                    <input
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="name@example.com"
                      style={inp}
                    />
                  </div>

                  {formErr && <div style={{ gridColumn: '1 / -1', color: D.red, fontSize: 12 }}>{formErr}</div>}
                </div>
              ) : (
                /* Licenses tab */
                <div>
                  {currentLics.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      {currentLics.map(lic => {
                        const st = licStatus(lic)
                        return (
                          <div
                            key={lic.id}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              padding: '10px 12px',
                              border: `1px solid ${D.border}`,
                              borderRadius: 6,
                              marginBottom: 8,
                              background: D.card,
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                <span
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: D.charcoal,
                                    textTransform: 'capitalize',
                                  }}
                                >
                                  {lic.license_type}
                                </span>
                                <span
                                  style={{
                                    background: st.color + '18',
                                    color: st.color,
                                    border: `1px solid ${st.color}40`,
                                    borderRadius: 4,
                                    padding: '1px 6px',
                                    fontSize: 10.5,
                                    fontWeight: 600,
                                  }}
                                >
                                  {st.label}
                                </span>
                              </div>
                              {lic.license_number && (
                                <div style={{ fontSize: 12, color: D.muted }}>#{lic.license_number}</div>
                              )}
                              {lic.expiry_date && (
                                <div style={{ fontSize: 11.5, color: D.muted }}>
                                  Expires{' '}
                                  {new Date(lic.expiry_date + 'T00:00:00').toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </div>
                              )}
                              {lic.notes && (
                                <div style={{ fontSize: 11.5, color: D.muted, fontStyle: 'italic', marginTop: 2 }}>
                                  {lic.notes}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                              <button
                                onClick={() => {
                                  setEditingLicId(lic.id)
                                  setLicForm({
                                    license_type: lic.license_type,
                                    license_number: lic.license_number || '',
                                    issued_date: lic.issued_date || '',
                                    expiry_date: lic.expiry_date || '',
                                    notes: lic.notes || '',
                                  })
                                }}
                                style={actionBtn}
                              >
                                Edit
                              </button>
                              <button onClick={() => deleteLicense(lic.id)} style={dangerBtn}>
                                Remove
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* License form */}
                  <div
                    style={{
                      border: `1px solid ${D.border}`,
                      borderRadius: 6,
                      padding: '14px 16px',
                      background: D.page,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: D.muted,
                        textTransform: 'uppercase',
                        letterSpacing: '0.8px',
                        marginBottom: 12,
                      }}
                    >
                      {editingLicId ? 'Edit License' : 'Add License'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px' }}>
                      <div>
                        <label style={lbl}>License Type</label>
                        <select
                          value={licForm.license_type}
                          onChange={e => setLicForm(f => ({ ...f, license_type: e.target.value }))}
                          style={inp}
                        >
                          {LICENSE_TYPES.map(t => (
                            <option key={t} value={t}>
                              {t.charAt(0).toUpperCase() + t.slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={lbl}>License #</label>
                        <input
                          value={licForm.license_number}
                          onChange={e => setLicForm(f => ({ ...f, license_number: e.target.value }))}
                          placeholder="e.g. MT-12345"
                          style={inp}
                        />
                      </div>
                      <div>
                        <label style={lbl}>Issued Date</label>
                        <input
                          type="date"
                          value={licForm.issued_date}
                          onChange={e => setLicForm(f => ({ ...f, issued_date: e.target.value }))}
                          style={inp}
                        />
                      </div>
                      <div>
                        <label style={lbl}>Expiry Date</label>
                        <input
                          type="date"
                          value={licForm.expiry_date}
                          onChange={e => setLicForm(f => ({ ...f, expiry_date: e.target.value }))}
                          style={inp}
                        />
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={lbl}>Notes</label>
                        <input
                          value={licForm.notes}
                          onChange={e => setLicForm(f => ({ ...f, notes: e.target.value }))}
                          placeholder="e.g. Renewal submitted"
                          style={inp}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      {editingLicId && (
                        <button
                          onClick={() => {
                            setEditingLicId(null)
                            setLicForm({ ...BLANK_LICENSE })
                          }}
                          style={{
                            background: 'transparent',
                            border: `1px solid ${D.border}`,
                            borderRadius: 5,
                            padding: '6px 14px',
                            fontSize: 12.5,
                            cursor: 'pointer',
                            color: D.charcoal,
                          }}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={saveLicense}
                        disabled={licSaving}
                        style={{
                          background: D.sage,
                          color: '#fff',
                          border: 'none',
                          borderRadius: 5,
                          padding: '6px 14px',
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: licSaving ? 'not-allowed' : 'pointer',
                          opacity: licSaving ? 0.7 : 1,
                        }}
                      >
                        {licSaving ? 'Saving…' : editingLicId ? 'Update' : 'Add License'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '14px 24px',
                borderTop: `1px solid ${D.border}`,
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <button
                onClick={() => setModal(false)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${D.border}`,
                  borderRadius: 6,
                  padding: '8px 18px',
                  fontSize: 13,
                  cursor: 'pointer',
                  color: D.charcoal,
                }}
              >
                {tab === 'licenses' ? 'Close' : 'Cancel'}
              </button>
              {tab === 'profile' && (
                <button
                  onClick={save}
                  disabled={saving}
                  style={{
                    background: D.sage,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '8px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving…' : form.id ? 'Save Changes' : 'Add Staff'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 600,
  color: 'rgba(74,74,63,0.7)',
  marginBottom: 4,
}

const inp: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 13,
  border: '1px solid #D9D4C8',
  borderRadius: 5,
  background: '#fff',
  color: '#4A4A3F',
  boxSizing: 'border-box',
}

const actionBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #D9D4C8',
  borderRadius: 4,
  padding: '3px 10px',
  fontSize: 11.5,
  cursor: 'pointer',
  color: '#4A4A3F',
  marginRight: 6,
}

const dangerBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(185,64,64,0.35)',
  borderRadius: 4,
  padding: '3px 10px',
  fontSize: 11.5,
  cursor: 'pointer',
  color: '#B94040',
}
