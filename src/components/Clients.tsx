'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
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

const inp: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: `1px solid ${D.border}`,
  borderRadius: 5,
  fontSize: 12.5,
  background: '#fff',
  color: D.charcoal,
  outline: 'none',
  boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: D.charcoal,
  marginBottom: 3,
  display: 'block',
}
const sectionHead: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: D.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  gridColumn: '1 / -1',
  marginTop: 6,
  paddingBottom: 6,
  borderBottom: `1px solid ${D.border}`,
}

export interface Customer {
  id: string
  client_id: string
  first_name: string
  middle_name: string | null
  last_name: string
  birthday: string | null
  email: string | null
  phone: string | null
  phone_whatsapp: boolean
  phone_alt: string | null
  preferred_contact: string | null
  preferred_language: string
  address_street: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  allergies: string | null
  preferences: string | null
  custom_fields: Record<string, unknown>
  is_active: boolean
  created_at: string
}

interface FieldDef {
  id: string
  label: string
  field_key: string
  field_type: 'text' | 'number' | 'date' | 'boolean' | 'select'
  options: string[] | null
  is_required: boolean
  sort_order: number
  is_active: boolean
}

interface CustomerForm {
  first_name: string
  middle_name: string
  last_name: string
  birthday: string
  email: string
  phone: string
  phone_whatsapp: boolean
  phone_alt: string
  preferred_contact: string
  preferred_language: string
  address_street: string
  address_city: string
  address_state: string
  address_zip: string
  allergies: string
  preferences: string
  is_active: boolean
  custom_fields: Record<string, string>
}

const BLANK: CustomerForm = {
  first_name: '',
  middle_name: '',
  last_name: '',
  birthday: '',
  email: '',
  phone: '',
  phone_whatsapp: true,
  phone_alt: '',
  preferred_contact: 'whatsapp',
  preferred_language: 'en',
  address_street: '',
  address_city: '',
  address_state: '',
  address_zip: '',
  allergies: '',
  preferences: '',
  is_active: true,
  custom_fields: {},
}

interface FieldForm {
  label: string
  field_key: string
  field_type: FieldDef['field_type']
  options: string
  is_required: boolean
}
const BLANK_FIELD: FieldForm = {
  label: '',
  field_key: '',
  field_type: 'text',
  options: '',
  is_required: false,
}

const PAGE_SIZE = 20

const CONTACT_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
]

function fmtPhone(p: string | null) {
  if (!p) return null
  const d = p.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return p
}

function LangBadge({ lang }: { lang: string }) {
  const es = lang === 'es'
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 3,
        background: es ? '#FDF6EC' : '#EEF4F1',
        color: es ? D.gold : D.sage,
        border: `1px solid ${es ? D.gold + '60' : D.sage + '40'}`,
      }}
    >
      {es ? 'ES' : 'EN'}
    </span>
  )
}

export default function Clients() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [page, setPage] = useState(0)
  const [modal, setModal] = useState<'customer' | 'fields' | null>(null)
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null)
  const [form, setForm] = useState<CustomerForm>({ ...BLANK })
  const [formErr, setFormErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldModal, setFieldModal] = useState(false)
  const [editField, setEditField] = useState<FieldDef | null>(null)
  const [fieldForm, setFieldForm] = useState<FieldForm>({ ...BLANK_FIELD })
  const [fieldErr, setFieldErr] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<Customer | null>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadSeqRef = useRef(0)

  const loadFieldDefs = useCallback(async () => {
    const { data } = await supabase
      .from('customer_field_defs')
      .select('*')
      .eq('client_id', CLIENT_ID)
      .eq('is_active', true)
      .order('sort_order')
    setFieldDefs((data ?? []) as FieldDef[])
  }, [])

  const load = useCallback(async (q: string, activeFilt: boolean, pg: number) => {
    // A slower, older response must not clobber the results of a newer search
    const seq = ++loadSeqRef.current
    setLoading(true)
    let query = supabase
      .from('customers')
      .select('*', { count: 'exact' })
      .eq('client_id', CLIENT_ID)
      .order('last_name')
      .order('first_name')
      .range(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE - 1)

    if (activeFilt) query = query.eq('is_active', true)
    if (q.trim()) {
      const s = `%${q.trim()}%`
      query = query.or(
        `first_name.ilike.${s},middle_name.ilike.${s},last_name.ilike.${s},email.ilike.${s},phone.ilike.${s},phone_alt.ilike.${s}`,
      )
    }
    const { data, count } = await query
    if (seq !== loadSeqRef.current) return
    setCustomers((data ?? []) as Customer[])
    setTotal(count ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadFieldDefs()
  }, [loadFieldDefs])

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => load(search, activeOnly, page), 250)
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current)
    }
  }, [search, activeOnly, page, load])

  function openAdd() {
    const defaults: Record<string, string> = {}
    fieldDefs.forEach(f => {
      defaults[f.field_key] = ''
    })
    setForm({ ...BLANK, custom_fields: defaults })
    setEditCustomer(null)
    setFormErr('')
    setModal('customer')
  }

  function openEdit(c: Customer) {
    const cfVals: Record<string, string> = {}
    fieldDefs.forEach(f => {
      cfVals[f.field_key] = String(c.custom_fields?.[f.field_key] ?? '')
    })
    setForm({
      first_name: c.first_name,
      middle_name: c.middle_name ?? '',
      last_name: c.last_name,
      birthday: c.birthday ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      phone_whatsapp: c.phone_whatsapp,
      phone_alt: c.phone_alt ?? '',
      preferred_contact: c.preferred_contact ?? 'whatsapp',
      preferred_language: c.preferred_language ?? 'en',
      address_street: c.address_street ?? '',
      address_city: c.address_city ?? '',
      address_state: c.address_state ?? '',
      address_zip: c.address_zip ?? '',
      allergies: c.allergies ?? '',
      preferences: c.preferences ?? '',
      is_active: c.is_active,
      custom_fields: cfVals,
    })
    setEditCustomer(c)
    setFormErr('')
    setModal('customer')
  }

  async function save() {
    if (!form.first_name.trim()) {
      setFormErr('First name is required.')
      return
    }
    if (!form.last_name.trim()) {
      setFormErr('Last name is required.')
      return
    }
    setSaving(true)
    setFormErr('')

    const cfPayload: Record<string, unknown> = {}
    fieldDefs.forEach(f => {
      const v = form.custom_fields[f.field_key] ?? ''
      if (v !== '') cfPayload[f.field_key] = v
    })

    const payload = {
      client_id: CLIENT_ID,
      first_name: form.first_name.trim(),
      middle_name: form.middle_name.trim() || null,
      last_name: form.last_name.trim(),
      birthday: form.birthday || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      phone_whatsapp: form.phone_whatsapp,
      phone_alt: form.phone_alt.trim() || null,
      preferred_contact: form.preferred_contact || null,
      preferred_language: form.preferred_language,
      address_street: form.address_street.trim() || null,
      address_city: form.address_city.trim() || null,
      address_state: form.address_state.trim() || null,
      address_zip: form.address_zip.trim() || null,
      allergies: form.allergies.trim() || null,
      preferences: form.preferences.trim() || null,
      is_active: form.is_active,
      custom_fields: cfPayload,
    }

    const { error } = editCustomer
      ? await supabase.from('customers').update(payload).eq('id', editCustomer.id)
      : await supabase.from('customers').insert(payload)

    setSaving(false)
    if (error) {
      setFormErr(error.message)
      return
    }
    setModal(null)
    load(search, activeOnly, page)
  }

  async function deleteCustomer(c: Customer) {
    const { error } = await supabase.from('customers').delete().eq('id', c.id)
    if (error) {
      alert(
        error.code === '23503'
          ? `${c.first_name} ${c.last_name} has appointment history and cannot be deleted. Mark them Inactive instead.`
          : `Delete failed: ${error.message}`,
      )
      return
    }
    setDeleteConfirm(null)
    load(search, activeOnly, page)
  }

  function openAddField() {
    setFieldForm({ ...BLANK_FIELD })
    setEditField(null)
    setFieldErr('')
    setFieldModal(true)
  }
  function openEditField(f: FieldDef) {
    setFieldForm({
      label: f.label,
      field_key: f.field_key,
      field_type: f.field_type,
      options: (f.options ?? []).join(', '),
      is_required: f.is_required,
    })
    setEditField(f)
    setFieldErr('')
    setFieldModal(true)
  }

  async function saveField() {
    if (!fieldForm.label.trim()) {
      setFieldErr('Label is required.')
      return
    }
    const key =
      fieldForm.field_key.trim() ||
      fieldForm.label
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
    if (!key) {
      setFieldErr('Could not derive a field key.')
      return
    }
    const opts =
      fieldForm.field_type === 'select'
        ? fieldForm.options
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : null
    const payload = {
      client_id: CLIENT_ID,
      label: fieldForm.label.trim(),
      field_key: key,
      field_type: fieldForm.field_type,
      options: opts,
      is_required: fieldForm.is_required,
      sort_order: editField?.sort_order ?? fieldDefs.length,
    }
    const { error } = editField
      ? await supabase.from('customer_field_defs').update(payload).eq('id', editField.id)
      : await supabase.from('customer_field_defs').insert(payload)
    if (error) {
      setFieldErr(error.message)
      return
    }
    setFieldModal(false)
    loadFieldDefs()
  }

  async function removeField(f: FieldDef) {
    const { error } = await supabase.from('customer_field_defs').update({ is_active: false }).eq('id', f.id)
    if (error) {
      alert(`Could not remove field: ${error.message}`)
      return
    }
    loadFieldDefs()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div style={{ background: D.page, minHeight: '100%' }}>
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 28px',
          background: D.card,
          borderBottom: `1px solid ${D.border}`,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 14, fontWeight: 600, color: D.sage, margin: '0 0 2px' }}>Clients</h1>
          <p style={{ fontSize: 11, color: D.muted, margin: 0 }}>
            {total.toLocaleString()} {activeOnly ? 'active' : 'total'} client{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <svg
              style={{
                position: 'absolute',
                left: 9,
                top: '50%',
                transform: 'translateY(-50%)',
                color: D.muted,
                pointerEvents: 'none',
              }}
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setPage(0)
              }}
              placeholder="Search name, phone, email…"
              style={{ ...inp, width: 230, paddingLeft: 30, paddingRight: search ? 28 : 10 }}
            />
            {search && (
              <button
                onClick={() => {
                  setSearch('')
                  setPage(0)
                }}
                style={{
                  position: 'absolute',
                  right: 7,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: D.muted,
                  fontSize: 14,
                }}
              >
                ×
              </button>
            )}
          </div>
          <button
            onClick={() => {
              setActiveOnly(v => !v)
              setPage(0)
            }}
            style={{
              background: activeOnly ? D.sage : D.card,
              color: activeOnly ? '#fff' : D.charcoal,
              border: `1px solid ${activeOnly ? D.sage : D.border}`,
              borderRadius: 5,
              padding: '6px 12px',
              fontSize: 11.5,
              cursor: 'pointer',
            }}
          >
            {activeOnly ? 'Active' : 'All'}
          </button>
          <button
            onClick={() => setModal('fields')}
            style={{
              background: D.card,
              border: `1px solid ${D.border}`,
              color: D.charcoal,
              borderRadius: 5,
              padding: '6px 12px',
              fontSize: 11.5,
              cursor: 'pointer',
            }}
          >
            ⚙ Fields
          </button>
          <button
            onClick={openAdd}
            style={{
              background: D.sage,
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add Client
          </button>
        </div>
      </header>

      <div style={{ padding: '24px 28px' }}>
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: D.page }}>
                {['Name', 'Phone', 'Email', 'Language', ''].map(h => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 14px',
                      textAlign: 'left',
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: D.muted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: `1px solid ${D.border}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: D.muted, fontSize: 12 }}>
                    Loading…
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: D.muted, fontSize: 12 }}>
                    {search ? 'No clients match your search.' : 'No clients yet — add your first one.'}
                  </td>
                </tr>
              ) : (
                customers.map((c, i) => (
                  <tr
                    key={c.id}
                    style={{
                      borderBottom: i < customers.length - 1 ? `1px solid ${D.border}` : 'none',
                      background: !c.is_active ? 'rgba(0,0,0,0.02)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <Link
                        href={`/clients/${c.id}`}
                        style={{ fontWeight: 600, color: c.is_active ? D.sage : D.muted, textDecoration: 'none' }}
                      >
                        {c.last_name}, {c.first_name}
                        {c.middle_name ? ` ${c.middle_name[0]}.` : ''}
                      </Link>
                      {!c.is_active && <span style={{ fontSize: 10, color: D.muted, marginLeft: 6 }}>inactive</span>}
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ color: D.charcoal }}>
                          {fmtPhone(c.phone) ?? <span style={{ color: D.muted }}>—</span>}
                        </span>
                        {c.phone_whatsapp && c.phone && (
                          <span style={{ fontSize: 11, color: '#25D366' }} title="WhatsApp">
                            💬
                          </span>
                        )}
                      </div>
                      {c.phone_alt && <div style={{ fontSize: 11, color: D.muted }}>{fmtPhone(c.phone_alt)}</div>}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        color: D.charcoal,
                        maxWidth: 180,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.email ?? <span style={{ color: D.muted }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <LangBadge lang={c.preferred_language} />
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => openEdit(c)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: D.steel,
                          fontSize: 11.5,
                          cursor: 'pointer',
                          marginRight: 8,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(c)}
                        style={{ background: 'none', border: 'none', color: D.red, fontSize: 11.5, cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 8,
                padding: '8px 14px',
                borderTop: `1px solid ${D.border}`,
                fontSize: 11.5,
                color: D.muted,
              }}
            >
              <span>
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <button
                onClick={() => setPage(p => p - 1)}
                disabled={page === 0}
                style={{
                  background: 'none',
                  border: `1px solid ${D.border}`,
                  borderRadius: 3,
                  padding: '2px 8px',
                  cursor: page === 0 ? 'default' : 'pointer',
                  opacity: page === 0 ? 0.4 : 1,
                }}
              >
                ◀
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= totalPages - 1}
                style={{
                  background: 'none',
                  border: `1px solid ${D.border}`,
                  borderRadius: 3,
                  padding: '2px 8px',
                  cursor: page >= totalPages - 1 ? 'default' : 'pointer',
                  opacity: page >= totalPages - 1 ? 0.4 : 1,
                }}
              >
                ▶
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Customer Modal */}
      {modal === 'customer' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={e => {
            if (e.target === e.currentTarget) setModal(null)
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: '26px 26px 20px',
              width: 560,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 700, color: D.charcoal, margin: '0 0 20px' }}>
              {editCustomer ? 'Edit Client' : 'Add Client'}
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
              {/* Name */}
              <div style={sectionHead}>Name</div>
              <div>
                <label style={lbl}>
                  First Name <span style={{ color: D.red }}>*</span>
                </label>
                <input
                  style={inp}
                  value={form.first_name}
                  onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                />
              </div>
              <div>
                <label style={lbl}>Middle Name</label>
                <input
                  style={inp}
                  value={form.middle_name}
                  onChange={e => setForm(f => ({ ...f, middle_name: e.target.value }))}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>
                  Last Name <span style={{ color: D.red }}>*</span>
                </label>
                <input
                  style={inp}
                  value={form.last_name}
                  onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                />
              </div>

              {/* Contact */}
              <div style={sectionHead}>Contact</div>
              <div>
                <label style={lbl}>Phone</label>
                <input
                  style={inp}
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="617-555-0100"
                />
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 6,
                    fontSize: 12,
                    color: D.charcoal,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.phone_whatsapp}
                    onChange={e => setForm(f => ({ ...f, phone_whatsapp: e.target.checked }))}
                  />
                  On WhatsApp
                </label>
              </div>
              <div>
                <label style={lbl}>Phone (Alt)</label>
                <input
                  style={inp}
                  value={form.phone_alt}
                  onChange={e => setForm(f => ({ ...f, phone_alt: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Email</label>
                <input
                  style={inp}
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="client@email.com"
                />
              </div>
              <div>
                <label style={lbl}>Preferred Contact</label>
                <select
                  style={inp}
                  value={form.preferred_contact}
                  onChange={e => setForm(f => ({ ...f, preferred_contact: e.target.value }))}
                >
                  {CONTACT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={lbl}>Preferred Language</label>
                <select
                  style={inp}
                  value={form.preferred_language}
                  onChange={e => setForm(f => ({ ...f, preferred_language: e.target.value }))}
                >
                  <option value="en">English</option>
                  <option value="es">Español</option>
                </select>
              </div>

              {/* Address */}
              <div style={sectionHead}>
                Address{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  (optional — for mailings)
                </span>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Street</label>
                <input
                  style={inp}
                  value={form.address_street}
                  onChange={e => setForm(f => ({ ...f, address_street: e.target.value }))}
                  placeholder="123 Main St"
                />
              </div>
              <div>
                <label style={lbl}>City</label>
                <input
                  style={inp}
                  value={form.address_city}
                  onChange={e => setForm(f => ({ ...f, address_city: e.target.value }))}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={lbl}>State</label>
                  <input
                    style={inp}
                    value={form.address_state}
                    onChange={e => setForm(f => ({ ...f, address_state: e.target.value }))}
                    placeholder="MA"
                    maxLength={2}
                  />
                </div>
                <div>
                  <label style={lbl}>ZIP</label>
                  <input
                    style={inp}
                    value={form.address_zip}
                    onChange={e => setForm(f => ({ ...f, address_zip: e.target.value }))}
                    placeholder="02101"
                  />
                </div>
              </div>

              {/* Health & Preferences */}
              <div style={sectionHead}>Health &amp; Preferences</div>
              <div>
                <label style={lbl}>Birthday</label>
                <input
                  style={inp}
                  type="date"
                  value={form.birthday}
                  onChange={e => setForm(f => ({ ...f, birthday: e.target.value }))}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...lbl, color: D.red }}>Allergies / Sensitivities</label>
                <input
                  style={{ ...inp, borderColor: form.allergies ? D.red + '80' : D.border }}
                  value={form.allergies}
                  onChange={e => setForm(f => ({ ...f, allergies: e.target.value }))}
                  placeholder="e.g. lavender oil, nut oils, latex"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Standing Preferences</label>
                <textarea
                  style={{ ...inp, height: 64, resize: 'vertical' }}
                  value={form.preferences}
                  onChange={e => setForm(f => ({ ...f, preferences: e.target.value }))}
                  placeholder="e.g. firm pressure, no music, always books with Maria"
                />
              </div>

              {/* Custom fields */}
              {fieldDefs.length > 0 && <div style={sectionHead}>Additional Info</div>}
              {fieldDefs.map(fd => (
                <div key={fd.field_key}>
                  <label style={lbl}>
                    {fd.label}
                    {fd.is_required && <span style={{ color: D.red }}> *</span>}
                  </label>
                  {fd.field_type === 'boolean' ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                      <input
                        type="checkbox"
                        checked={form.custom_fields[fd.field_key] === 'true'}
                        onChange={e =>
                          setForm(f => ({
                            ...f,
                            custom_fields: { ...f.custom_fields, [fd.field_key]: String(e.target.checked) },
                          }))
                        }
                      />
                      Yes
                    </label>
                  ) : fd.field_type === 'select' ? (
                    <select
                      style={inp}
                      value={form.custom_fields[fd.field_key] ?? ''}
                      onChange={e =>
                        setForm(f => ({ ...f, custom_fields: { ...f.custom_fields, [fd.field_key]: e.target.value } }))
                      }
                    >
                      <option value="">— select —</option>
                      {(fd.options ?? []).map(o => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      style={inp}
                      type={fd.field_type === 'number' ? 'number' : fd.field_type === 'date' ? 'date' : 'text'}
                      value={form.custom_fields[fd.field_key] ?? ''}
                      onChange={e =>
                        setForm(f => ({ ...f, custom_fields: { ...f.custom_fields, [fd.field_key]: e.target.value } }))
                      }
                    />
                  )}
                </div>
              ))}

              {editCustomer && (
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                  />
                  <label htmlFor="is_active" style={{ fontSize: 12.5, color: D.charcoal }}>
                    Active
                  </label>
                </div>
              )}
            </div>

            {formErr && (
              <div
                style={{
                  fontSize: 11.5,
                  color: D.red,
                  marginTop: 12,
                  padding: '6px 10px',
                  background: '#FEF2F2',
                  borderRadius: 4,
                }}
              >
                {formErr}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button
                onClick={() => setModal(null)}
                style={{
                  background: 'none',
                  border: `1px solid ${D.border}`,
                  borderRadius: 5,
                  padding: '7px 16px',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  color: D.charcoal,
                }}
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{
                  background: D.sage,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  padding: '7px 18px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Saving…' : editCustomer ? 'Save Changes' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Field Definitions Modal */}
      {modal === 'fields' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={e => {
            if (e.target === e.currentTarget) setModal(null)
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: '26px 26px 20px',
              width: 480,
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: D.charcoal, margin: 0 }}>Custom Fields</h2>
              <button
                onClick={openAddField}
                style={{
                  background: D.sage,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  padding: '5px 12px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Add Field
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: D.muted, margin: '0 0 16px', lineHeight: 1.5 }}>
              Custom fields appear in the client form. Removing a field hides it but preserves existing values.
            </p>
            {fieldDefs.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: D.muted, fontSize: 12 }}>
                No custom fields yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {fieldDefs.map(f => (
                  <div
                    key={f.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 12px',
                      background: D.page,
                      borderRadius: 6,
                      border: `1px solid ${D.border}`,
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 12.5, color: D.charcoal }}>{f.label}</span>
                      <span style={{ fontSize: 10.5, color: D.muted, marginLeft: 8 }}>
                        {f.field_type}
                        {f.is_required ? ' · required' : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => openEditField(f)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: D.steel,
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => removeField(f)}
                        style={{ background: 'none', border: 'none', color: D.red, fontSize: 11.5, cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => setModal(null)}
                style={{
                  background: 'none',
                  border: `1px solid ${D.border}`,
                  borderRadius: 5,
                  padding: '7px 16px',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  color: D.charcoal,
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Field Modal */}
      {fieldModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
          }}
          onClick={e => {
            if (e.target === e.currentTarget) setFieldModal(false)
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: '24px 24px 18px',
              width: 380,
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            <h3 style={{ fontSize: 13, fontWeight: 700, color: D.charcoal, margin: '0 0 18px' }}>
              {editField ? 'Edit Field' : 'Add Custom Field'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={lbl}>
                  Label <span style={{ color: D.red }}>*</span>
                </label>
                <input
                  style={inp}
                  value={fieldForm.label}
                  onChange={e => setFieldForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Referral Source"
                />
              </div>
              <div>
                <label style={lbl}>Field Type</label>
                <select
                  style={inp}
                  value={fieldForm.field_type}
                  onChange={e => setFieldForm(f => ({ ...f, field_type: e.target.value as FieldDef['field_type'] }))}
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="boolean">Yes / No</option>
                  <option value="select">Dropdown</option>
                </select>
              </div>
              {fieldForm.field_type === 'select' && (
                <div>
                  <label style={lbl}>Options (comma-separated)</label>
                  <input
                    style={inp}
                    value={fieldForm.options}
                    onChange={e => setFieldForm(f => ({ ...f, options: e.target.value }))}
                    placeholder="Option A, Option B"
                  />
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: D.charcoal }}>
                <input
                  type="checkbox"
                  checked={fieldForm.is_required}
                  onChange={e => setFieldForm(f => ({ ...f, is_required: e.target.checked }))}
                />
                Required field
              </label>
            </div>
            {fieldErr && (
              <div
                style={{
                  fontSize: 11.5,
                  color: D.red,
                  marginTop: 10,
                  padding: '6px 10px',
                  background: '#FEF2F2',
                  borderRadius: 4,
                }}
              >
                {fieldErr}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button
                onClick={() => setFieldModal(false)}
                style={{
                  background: 'none',
                  border: `1px solid ${D.border}`,
                  borderRadius: 5,
                  padding: '6px 14px',
                  fontSize: 12,
                  cursor: 'pointer',
                  color: D.charcoal,
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveField}
                style={{
                  background: D.sage,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  padding: '6px 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {editField ? 'Save' : 'Add Field'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: '24px 26px 20px',
              width: 360,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ fontSize: 13, fontWeight: 700, color: D.charcoal, margin: '0 0 10px' }}>Delete Client?</h3>
            <p style={{ fontSize: 12.5, color: D.muted, margin: '0 0 18px', lineHeight: 1.5 }}>
              This will permanently delete{' '}
              <strong style={{ color: D.charcoal }}>
                {deleteConfirm.first_name} {deleteConfirm.last_name}
              </strong>
              . This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  background: 'none',
                  border: `1px solid ${D.border}`,
                  borderRadius: 5,
                  padding: '7px 16px',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  color: D.charcoal,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteCustomer(deleteConfirm)}
                style={{
                  background: D.red,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  padding: '7px 16px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
