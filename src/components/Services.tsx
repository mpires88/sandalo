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
  red: '#B94040',
  green: '#2E7D52',
  muted: 'rgba(74,74,63,0.55)',
}

interface ServiceCategory {
  id: string
  name: string
  color: string
}

interface Service {
  id: string
  name: string
  description: string | null
  category: string
  category_id: string | null
  duration_minutes: number
  buffer_before_minutes: number
  buffer_after_minutes: number
  staff_count: number
  customer_count: number
  price: number
  deposit_amount: number | null
  resource_id: string | null
  required_license_type: string | null
  sort_order: number
  is_active: boolean
}

interface Resource {
  id: string
  name: string
}

interface ServiceForm {
  id?: string
  name: string
  description: string
  category_id: string
  duration_minutes: string
  buffer_before_minutes: string
  buffer_after_minutes: string
  staff_count: string
  customer_count: string
  price: string
  deposit_amount: string
  resource_id: string
  required_license_type: string
  sort_order: string
  is_active: boolean
}

const BLANK: ServiceForm = {
  name: '',
  description: '',
  category_id: '',
  duration_minutes: '60',
  buffer_before_minutes: '0',
  buffer_after_minutes: '0',
  staff_count: '1',
  customer_count: '1',
  price: '',
  deposit_amount: '',
  resource_id: '',
  required_license_type: '',
  sort_order: '',
  is_active: true,
}

const LICENSE_TYPES = ['massage', 'esthetics', 'laser']
const DURATION_PRESETS = [15, 30, 45, 60, 75, 90, 120]
const BUFFER_PRESETS = [0, 5, 10, 15, 20, 30]

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDur(min: number) {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60),
    m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default function Services() {
  const [services, setServices] = useState<Service[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(false)

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<ServiceForm>({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')

  const [confirmDelete, setConfirmDelete] = useState<Service | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [sRes, rRes, cRes] = await Promise.all([
        supabase
          .from('services')
          .select(
            'id, name, description, category, category_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, staff_count, customer_count, price, deposit_amount, resource_id, required_license_type, sort_order, is_active',
          )
          .eq('client_id', CLIENT_ID)
          .order('sort_order')
          .order('name')
          .limit(500),
        supabase.from('resources').select('id, name').eq('client_id', CLIENT_ID).eq('is_active', true).order('name'),
        supabase
          .from('service_categories')
          .select('id, name, color')
          .eq('client_id', CLIENT_ID)
          .eq('is_active', true)
          .order('sort_order'),
      ])
      if (sRes.error) {
        setError(sRes.error.message)
        return
      }
      setServices(sRes.data ?? [])
      setResources(rRes.data ?? [])
      setCategories(cRes.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const visible = services.filter(
    s => (showInactive || s.is_active) && (categoryFilter === 'all' || s.category_id === categoryFilter),
  )

  function openAdd() {
    const nextOrder = services.length > 0 ? Math.max(...services.map(s => s.sort_order ?? 0)) + 1 : 1
    setForm({ ...BLANK, sort_order: String(nextOrder) })
    setFormErr('')
    setModal(true)
  }
  function openEdit(s: Service) {
    setForm({
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      category_id: s.category_id ?? '',
      duration_minutes: String(s.duration_minutes),
      buffer_before_minutes: String(s.buffer_before_minutes ?? 0),
      buffer_after_minutes: String(s.buffer_after_minutes ?? 0),
      staff_count: String(s.staff_count ?? 1),
      customer_count: String(s.customer_count ?? 1),
      price: String(s.price),
      deposit_amount: s.deposit_amount != null ? String(s.deposit_amount) : '',
      resource_id: s.resource_id ?? '',
      required_license_type: s.required_license_type ?? '',
      sort_order: String(s.sort_order ?? ''),
      is_active: s.is_active,
    })
    setFormErr('')
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) {
      setFormErr('Name is required.')
      return
    }
    if (!form.category_id) {
      setFormErr('Category is required.')
      return
    }
    if (!form.price) {
      setFormErr('Price is required.')
      return
    }
    setSaving(true)
    setFormErr('')
    try {
      const cat = categories.find(c => c.id === form.category_id)
      const payload = {
        client_id: CLIENT_ID,
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: cat?.name ?? '',
        category_id: form.category_id,
        duration_minutes: parseInt(form.duration_minutes, 10) || 60,
        buffer_before_minutes: parseInt(form.buffer_before_minutes, 10) || 0,
        buffer_after_minutes: parseInt(form.buffer_after_minutes, 10) || 0,
        staff_count: Math.max(1, parseInt(form.staff_count, 10) || 1),
        customer_count: Math.max(1, parseInt(form.customer_count, 10) || 1),
        price: parseFloat(form.price) || 0,
        deposit_amount: form.deposit_amount ? parseFloat(form.deposit_amount) : null,
        resource_id: form.resource_id || null,
        required_license_type: form.required_license_type.trim() || null,
        sort_order: parseInt(form.sort_order, 10) || 0,
        is_active: form.is_active,
      }
      const { error: err } = form.id
        ? await supabase.from('services').update(payload).eq('id', form.id)
        : await supabase.from('services').insert(payload)
      if (err) {
        setFormErr(err.message)
        return
      }
      setModal(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(s: Service) {
    await supabase.from('services').update({ is_active: !s.is_active }).eq('id', s.id)
    await load()
  }

  async function deleteService() {
    if (!confirmDelete) return
    setDeleting(true)
    setDeleteErr('')
    try {
      const { error: err } = await supabase.from('services').delete().eq('id', confirmDelete.id)
      if (err) {
        setDeleteErr(
          err.code === '23503'
            ? 'This service is referenced by existing appointments. Deactivate it instead.'
            : err.message,
        )
        return
      }
      setConfirmDelete(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  const active = services.filter(s => s.is_active)
  const catCount = new Set(services.filter(s => s.is_active).map(s => s.category)).size

  return (
    <div style={{ padding: '28px 32px', background: D.page, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: '0 0 3px', fontSize: 22, fontWeight: 700, color: D.charcoal }}>Services</h1>
          <p style={{ margin: 0, fontSize: 12.5, color: D.muted }}>Service menu, pricing, and duration management</p>
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
          + Add Service
        </button>
      </div>

      {/* Stats */}
      {!loading && !error && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Services', value: services.length },
            { label: 'Active', value: active.length },
            { label: 'Categories', value: catCount },
          ].map(c => (
            <div
              key={c.label}
              style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 7, padding: '9px 16px' }}
            >
              <div style={{ fontSize: 10.5, color: D.muted, marginBottom: 1 }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: D.charcoal }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[{ id: 'all', name: 'All', color: D.charcoal }, ...categories].map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              style={{
                background: categoryFilter === cat.id ? cat.color : 'transparent',
                color: categoryFilter === cat.id ? '#fff' : D.muted,
                border: `1px solid ${categoryFilter === cat.id ? cat.color : D.border}`,
                borderRadius: 5,
                padding: '4px 11px',
                fontSize: 12,
                fontWeight: categoryFilter === cat.id ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: D.muted, cursor: 'pointer' }}
        >
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {/* Table */}
      <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 32, color: D.red, fontSize: 13 }}>{error}</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>
            {categoryFilter !== 'all'
              ? `No services in ${categoryFilter}.`
              : 'No services yet — click "+ Add Service" to create one.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#F0EBE0', borderBottom: `1px solid ${D.border}` }}>
                {[
                  'Name',
                  'Category',
                  'Duration',
                  'Buffer',
                  'Staff / Clients',
                  'Price',
                  'Deposit',
                  'Resource',
                  'Status',
                  '',
                ].map(h => (
                  <th
                    key={h}
                    style={{
                      padding: '9px 14px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: D.charcoal,
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((s, i) => {
                const resource = resources.find(r => r.id === s.resource_id)
                const cat = categories.find(c => c.id === s.category_id)
                const hasBefore = (s.buffer_before_minutes ?? 0) > 0
                const hasAfter = (s.buffer_after_minutes ?? 0) > 0
                const multiStaff = (s.staff_count ?? 1) > 1 || (s.customer_count ?? 1) > 1
                return (
                  <tr
                    key={s.id}
                    style={{
                      borderBottom: i < visible.length - 1 ? `1px solid ${D.border}` : 'none',
                      background: i % 2 === 0 ? D.card : '#F7F4EE',
                      opacity: s.is_active ? 1 : 0.6,
                    }}
                  >
                    <td style={{ padding: '11px 14px', maxWidth: 280 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          color: D.charcoal,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.name}
                      </div>
                      {s.description && (
                        <div
                          style={{
                            fontSize: 11,
                            color: D.muted,
                            marginTop: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {s.description}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                      {cat ? (
                        <span
                          style={{
                            background: cat.color + '18',
                            border: `1px solid ${cat.color}40`,
                            borderRadius: 4,
                            padding: '2px 7px',
                            fontSize: 11,
                            fontWeight: 500,
                            color: cat.color,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <span
                            style={{ width: 6, height: 6, borderRadius: '50%', background: cat.color, flexShrink: 0 }}
                          />
                          {cat.name}
                        </span>
                      ) : (
                        <span style={{ color: D.muted, fontSize: 11.5 }}>{s.category || '—'}</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', color: D.charcoal, whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {fmtDur(s.duration_minutes)}
                    </td>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                      {!hasBefore && !hasAfter ? (
                        <span style={{ color: D.muted }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {hasBefore && (
                            <span style={{ fontSize: 11, color: '#1A6EAD' }}>↓ {s.buffer_before_minutes}m prep</span>
                          )}
                          {hasAfter && (
                            <span style={{ fontSize: 11, color: '#B87400' }}>↑ {s.buffer_after_minutes}m cleanup</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                      {multiStaff ? (
                        <span style={{ fontSize: 11.5, color: '#7B4A8A', fontWeight: 500 }}>
                          {s.staff_count} staff · {s.customer_count} clients
                        </span>
                      ) : (
                        <span style={{ color: D.muted }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', color: D.charcoal, whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {fmtMoney(s.price)}
                    </td>
                    <td
                      style={{
                        padding: '11px 14px',
                        color: s.deposit_amount ? D.charcoal : D.muted,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {fmtMoney(s.deposit_amount)}
                    </td>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                      {resource ? (
                        <span style={{ fontSize: 11.5, color: D.charcoal }}>{resource.name}</span>
                      ) : (
                        <span style={{ color: D.muted }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span
                        style={{
                          background: s.is_active ? '#2E7D5214' : '#88888814',
                          color: s.is_active ? '#2E7D52' : '#888888',
                          border: `1px solid ${s.is_active ? '#2E7D5240' : '#88888840'}`,
                          borderRadius: 4,
                          padding: '2px 8px',
                          fontSize: 11,
                          fontWeight: 500,
                        }}
                      >
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button onClick={() => openEdit(s)} style={actionBtn}>
                        Edit
                      </button>
                      <button onClick={() => toggleActive(s)} style={{ ...actionBtn, marginLeft: 6 }}>
                        {s.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => {
                          setConfirmDelete(s)
                          setDeleteErr('')
                        }}
                        style={{ ...dangerBtn, marginLeft: 6 }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit modal */}
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
              width: 560,
              maxWidth: '95vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
          >
            <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${D.border}` }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: D.charcoal }}>
                {form.id ? 'Edit Service' : 'New Service'}
              </h2>
            </div>
            <div style={{ padding: '18px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '13px 16px' }}>
                {/* Identity */}
                <div style={secHead}>Name & Category</div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>Service Name *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. 1 hr Relaxation Massage"
                    style={inp}
                    autoFocus
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>Description</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Brief description of what the service includes…"
                    rows={2}
                    style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
                <div>
                  <label style={lbl}>Category *</label>
                  <select
                    value={form.category_id}
                    onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                    style={inp}
                  >
                    <option value="">— Select category —</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Required License</label>
                  <input
                    value={form.required_license_type}
                    onChange={e => setForm(f => ({ ...f, required_license_type: e.target.value }))}
                    placeholder="e.g. massage"
                    list="license-list"
                    style={inp}
                  />
                  <datalist id="license-list">
                    {LICENSE_TYPES.map(l => (
                      <option key={l} value={l} />
                    ))}
                  </datalist>
                </div>

                {/* Timing */}
                <div style={{ ...secHead, marginTop: 2 }}>Timing</div>
                <div>
                  <label style={lbl}>Duration (min) *</label>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                    {DURATION_PRESETS.map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, duration_minutes: String(p) }))}
                        style={{
                          background: form.duration_minutes === String(p) ? D.charcoal : 'transparent',
                          color: form.duration_minutes === String(p) ? '#fff' : D.muted,
                          border: `1px solid ${form.duration_minutes === String(p) ? D.charcoal : D.border}`,
                          borderRadius: 4,
                          padding: '2px 8px',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min="5"
                    step="5"
                    value={form.duration_minutes}
                    onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))}
                    style={inp}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  <div>
                    <label style={lbl}>Buffer Before (prep)</label>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                      {BUFFER_PRESETS.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, buffer_before_minutes: String(p) }))}
                          style={{
                            background: form.buffer_before_minutes === String(p) ? '#1A6EAD' : 'transparent',
                            color: form.buffer_before_minutes === String(p) ? '#fff' : D.muted,
                            border: `1px solid ${form.buffer_before_minutes === String(p) ? '#1A6EAD' : D.border}`,
                            borderRadius: 4,
                            padding: '2px 7px',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="5"
                      value={form.buffer_before_minutes}
                      onChange={e => setForm(f => ({ ...f, buffer_before_minutes: e.target.value }))}
                      placeholder="0"
                      style={inp}
                    />
                    <div style={{ fontSize: 10.5, color: D.muted, marginTop: 3 }}>
                      Setup / room prep before service starts
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>Buffer After (cleanup)</label>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                      {BUFFER_PRESETS.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, buffer_after_minutes: String(p) }))}
                          style={{
                            background: form.buffer_after_minutes === String(p) ? '#B87400' : 'transparent',
                            color: form.buffer_after_minutes === String(p) ? '#fff' : D.muted,
                            border: `1px solid ${form.buffer_after_minutes === String(p) ? '#B87400' : D.border}`,
                            borderRadius: 4,
                            padding: '2px 7px',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="5"
                      value={form.buffer_after_minutes}
                      onChange={e => setForm(f => ({ ...f, buffer_after_minutes: e.target.value }))}
                      placeholder="0"
                      style={inp}
                    />
                    <div style={{ fontSize: 10.5, color: D.muted, marginTop: 3 }}>
                      Changeover / cleanup after service ends
                    </div>
                  </div>
                </div>
                {(parseInt(form.buffer_before_minutes, 10) > 0 || parseInt(form.buffer_after_minutes, 10) > 0) && (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      background: '#F0EBE0',
                      border: `1px solid ${D.border}`,
                      borderRadius: 5,
                      padding: '7px 12px',
                      fontSize: 12,
                      color: D.charcoal,
                    }}
                  >
                    Total slot time:{' '}
                    <strong>
                      {fmtDur(
                        (parseInt(form.buffer_before_minutes, 10) || 0) +
                          (parseInt(form.duration_minutes, 10) || 0) +
                          (parseInt(form.buffer_after_minutes, 10) || 0),
                      )}
                    </strong>
                    <span style={{ color: D.muted, marginLeft: 8 }}>
                      ({form.buffer_before_minutes || 0}m prep + {form.duration_minutes || 0}m service +{' '}
                      {form.buffer_after_minutes || 0}m cleanup)
                    </span>
                  </div>
                )}

                {/* Multi-party */}
                <div style={{ ...secHead, marginTop: 2 }}>Capacity</div>
                <div>
                  <label style={lbl}>Staff Required</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    value={form.staff_count}
                    onChange={e => setForm(f => ({ ...f, staff_count: e.target.value }))}
                    style={inp}
                  />
                  <div style={{ fontSize: 10.5, color: D.muted, marginTop: 3 }}>
                    Number of providers needed (1 for standard, 2 for couples)
                  </div>
                </div>
                <div>
                  <label style={lbl}>Clients Served</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    value={form.customer_count}
                    onChange={e => setForm(f => ({ ...f, customer_count: e.target.value }))}
                    style={inp}
                  />
                  <div style={{ fontSize: 10.5, color: D.muted, marginTop: 3 }}>
                    Number of clients in one booking (1 for individual, 2 for couples)
                  </div>
                </div>

                {/* Pricing */}
                <div style={{ ...secHead, marginTop: 2 }}>Pricing</div>
                <div>
                  <label style={lbl}>Price *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    placeholder="0.00"
                    style={inp}
                  />
                </div>
                <div>
                  <label style={lbl}>Deposit Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.deposit_amount}
                    onChange={e => setForm(f => ({ ...f, deposit_amount: e.target.value }))}
                    placeholder="Optional"
                    style={inp}
                  />
                </div>

                {/* Resource & settings */}
                <div style={{ ...secHead, marginTop: 2 }}>Resource & Settings</div>
                <div>
                  <label style={lbl}>Resource</label>
                  <select
                    value={form.resource_id}
                    onChange={e => setForm(f => ({ ...f, resource_id: e.target.value }))}
                    style={inp}
                  >
                    <option value="">— None —</option>
                    {resources.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Sort Order</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.sort_order}
                    onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                    placeholder="1"
                    style={inp}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                  <input
                    type="checkbox"
                    id="svc-active"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="svc-active" style={{ fontSize: 12.5, color: D.charcoal, cursor: 'pointer' }}>
                    Active
                  </label>
                </div>

                {formErr && <div style={{ gridColumn: '1 / -1', color: D.red, fontSize: 12 }}>{formErr}</div>}
              </div>
            </div>
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
                Cancel
              </button>
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
                {saving ? 'Saving…' : form.id ? 'Save Changes' : 'Add Service'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
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
            if (e.target === e.currentTarget) setConfirmDelete(null)
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              width: 380,
              maxWidth: '95vw',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              padding: '24px',
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: D.charcoal }}>Delete Service?</h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: D.charcoal }}>
              <strong>{confirmDelete.name}</strong> will be permanently removed.
            </p>
            {deleteErr && (
              <div
                style={{
                  marginBottom: 12,
                  color: D.red,
                  fontSize: 12.5,
                  background: '#B9404010',
                  border: `1px solid ${D.red}30`,
                  borderRadius: 5,
                  padding: '8px 12px',
                }}
              >
                {deleteErr}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${D.border}`,
                  borderRadius: 6,
                  padding: '8px 16px',
                  fontSize: 13,
                  cursor: 'pointer',
                  color: D.charcoal,
                }}
              >
                Cancel
              </button>
              <button
                onClick={deleteService}
                disabled={deleting}
                style={{
                  background: D.red,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.7 : 1,
                }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
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
  fontSize: 12.5,
  border: '1px solid #D9D4C8',
  borderRadius: 5,
  background: '#fff',
  color: '#4A4A3F',
  boxSizing: 'border-box',
}
const secHead: React.CSSProperties = {
  gridColumn: '1 / -1',
  fontSize: 10,
  fontWeight: 700,
  color: 'rgba(74,74,63,0.55)',
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  paddingBottom: 6,
  borderBottom: '1px solid #D9D4C8',
}
const actionBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #D9D4C8',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 11,
  cursor: 'pointer',
  color: '#4A4A3F',
}
const dangerBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(185,64,64,0.35)',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 11,
  cursor: 'pointer',
  color: '#B94040',
}
