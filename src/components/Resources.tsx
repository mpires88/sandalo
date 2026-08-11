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

interface Resource {
  id: string
  name: string
  quantity: number
  sort_order: number
  is_active: boolean
  created_at: string
}

interface ResourceForm {
  id?: string
  name: string
  quantity: string
  sort_order: string
  is_active: boolean
}

const BLANK: ResourceForm = { name: '', quantity: '1', sort_order: '', is_active: true }

export default function Resources() {
  const [resources, setResources] = useState<Resource[]>([])
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({})
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<ResourceForm>({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')

  const [confirmDelete, setConfirmDelete] = useState<Resource | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('resources')
        .select('*')
        .eq('client_id', CLIENT_ID)
        .order('sort_order', { ascending: true })
        .order('name')
        .limit(200)
      if (err) {
        setError(err.message)
        return
      }
      setResources(data ?? [])

      // Count upcoming/active appointments per resource
      const { data: counts } = await supabase
        .from('appointments')
        .select('resource_id')
        .eq('client_id', CLIENT_ID)
        .in('status', ['scheduled', 'completed'])
        .not('resource_id', 'is', null)
        .limit(10000)
      const c: Record<string, number> = {}
      for (const row of counts ?? []) {
        if (row.resource_id) c[row.resource_id] = (c[row.resource_id] ?? 0) + 1
      }
      setUsageCounts(c)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openAdd() {
    const nextOrder = resources.length > 0 ? Math.max(...resources.map(r => r.sort_order ?? 0)) + 1 : 1
    setForm({ ...BLANK, sort_order: String(nextOrder) })
    setFormErr('')
    setModal(true)
  }
  function openEdit(r: Resource) {
    setForm({
      id: r.id,
      name: r.name,
      quantity: String(r.quantity),
      sort_order: String(r.sort_order ?? ''),
      is_active: r.is_active,
    })
    setFormErr('')
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) {
      setFormErr('Name is required.')
      return
    }
    const qty = parseInt(form.quantity, 10)
    if (!qty || qty < 1) {
      setFormErr('Quantity must be at least 1.')
      return
    }
    setSaving(true)
    setFormErr('')
    try {
      const payload = {
        client_id: CLIENT_ID,
        name: form.name.trim(),
        quantity: qty,
        sort_order: parseInt(form.sort_order, 10) || 0,
        is_active: form.is_active,
      }
      const { error: err } = form.id
        ? await supabase.from('resources').update(payload).eq('id', form.id)
        : await supabase.from('resources').insert(payload)
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

  async function toggleActive(r: Resource) {
    const { error } = await supabase.from('resources').update({ is_active: !r.is_active }).eq('id', r.id)
    if (error) alert(`Update failed: ${error.message}`)
    await load()
  }

  async function deleteResource() {
    if (!confirmDelete) return
    setDeleting(true)
    setDeleteErr('')
    try {
      const { error: err } = await supabase.from('resources').delete().eq('id', confirmDelete.id)
      if (err) {
        setDeleteErr(
          err.code === '23503'
            ? 'This resource is referenced by existing appointments and cannot be deleted. Deactivate it instead.'
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

  const visible = resources.filter(r => showInactive || r.is_active)

  return (
    <div style={{ padding: '28px 32px', background: D.page, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: '0 0 3px', fontSize: 22, fontWeight: 700, color: D.charcoal }}>Resources</h1>
          <p style={{ margin: 0, fontSize: 12.5, color: D.muted }}>
            Treatment rooms, tables, and equipment shared across appointments
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: D.muted, cursor: 'pointer' }}
          >
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
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
            + Add Resource
          </button>
        </div>
      </div>

      {/* Stats */}
      {!loading && !error && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Resources', value: resources.length },
            { label: 'Active', value: resources.filter(r => r.is_active).length },
            {
              label: 'Total Capacity',
              value: resources.filter(r => r.is_active).reduce((s, r) => s + r.quantity, 0) + ' units',
            },
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

      {/* Table */}
      <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 32, color: D.red, fontSize: 13 }}>{error}</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>
            No resources yet. Click "+ Add Resource" to create one.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#F0EBE0', borderBottom: `1px solid ${D.border}` }}>
                {['Name', 'Capacity', 'Order', 'Appt History', 'Status', ''].map(h => (
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
              {visible.map((r, i) => (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: i < visible.length - 1 ? `1px solid ${D.border}` : 'none',
                    background: i % 2 === 0 ? D.card : '#F7F4EE',
                    opacity: r.is_active ? 1 : 0.6,
                  }}
                >
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: D.charcoal }}>{r.name}</td>
                  <td style={{ padding: '11px 14px', color: D.charcoal }}>
                    <span
                      style={{
                        background: D.sage + '18',
                        color: D.sage,
                        border: `1px solid ${D.sage}30`,
                        borderRadius: 4,
                        padding: '2px 9px',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {r.quantity} {r.quantity === 1 ? 'unit' : 'units'}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', color: D.muted }}>{r.sort_order ?? '—'}</td>
                  <td style={{ padding: '11px 14px', color: D.muted }}>
                    {usageCounts[r.id] != null
                      ? `${usageCounts[r.id]} appointment${usageCounts[r.id] !== 1 ? 's' : ''}`
                      : '—'}
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <span
                      style={{
                        background: r.is_active ? '#2E7D5214' : '#88888814',
                        color: r.is_active ? D.green : '#888888',
                        border: `1px solid ${r.is_active ? '#2E7D5240' : '#88888840'}`,
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      {r.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button onClick={() => openEdit(r)} style={actionBtn}>
                      Edit
                    </button>
                    <button onClick={() => toggleActive(r)} style={{ ...actionBtn, marginLeft: 6 }}>
                      {r.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDelete(r)
                        setDeleteErr('')
                      }}
                      style={{ ...dangerBtn, marginLeft: 6 }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
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
              width: 420,
              maxWidth: '95vw',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
          >
            <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${D.border}` }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: D.charcoal }}>
                {form.id ? 'Edit Resource' : 'New Resource'}
              </h2>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '13px 16px' }}>
                <div style={secHead}>Details</div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>Name *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Massage Table"
                    style={inp}
                    autoFocus
                  />
                </div>
                <div>
                  <label style={lbl}>Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.quantity}
                    onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                    placeholder="1"
                    style={inp}
                  />
                  <div style={{ fontSize: 10.5, color: D.muted, marginTop: 4 }}>Max concurrent appointments</div>
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
                  <div style={{ fontSize: 10.5, color: D.muted, marginTop: 4 }}>Lower numbers appear first</div>
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    id="res-active"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="res-active" style={{ fontSize: 12.5, color: D.charcoal, cursor: 'pointer' }}>
                    Active (available for booking)
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
                {saving ? 'Saving…' : form.id ? 'Save Changes' : 'Add Resource'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
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
            <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: D.charcoal }}>Delete Resource?</h2>
            <p style={{ margin: '0 0 6px', fontSize: 13, color: D.charcoal }}>
              <strong>{confirmDelete.name}</strong> will be permanently removed.
            </p>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: D.muted }}>
              If this resource is linked to existing appointments the delete will be blocked — use Deactivate instead.
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
                onClick={deleteResource}
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
