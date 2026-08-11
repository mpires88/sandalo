'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { CLIENT_ID } from '@/constants'

const D = {
  sage: '#2C5F52',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  card: '#FAFAF8',
  border: '#D9D4C8',
  red: '#B94040',
  green: '#2E7D52',
  muted: 'rgba(74,74,63,0.55)',
}

const COLOR_PRESETS = ['#2C5F52', '#4A7B6A', '#C8A96E', '#1A6EAD', '#B87400', '#7B4A8A', '#B94040', '#4A4A3F']

interface Category {
  id: string
  name: string
  color: string
  sort_order: number
  is_active: boolean
  service_count?: number
}

interface CatForm {
  id?: string
  name: string
  color: string
  sort_order: string
  is_active: boolean
}

const BLANK: CatForm = { name: '', color: '#2C5F52', sort_order: '', is_active: true }

export default function ServiceCategories() {
  const [cats, setCats] = useState<Category[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<CatForm>({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')

  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [catRes, svcRes] = await Promise.all([
        supabase
          .from('service_categories')
          .select('*')
          .eq('client_id', CLIENT_ID)
          .order('sort_order')
          .order('name')
          .limit(200),
        supabase.from('services').select('category_id').eq('client_id', CLIENT_ID).eq('is_active', true).limit(500),
      ])
      if (catRes.error) {
        setError(catRes.error.message)
        return
      }
      const countMap: Record<string, number> = {}
      for (const s of svcRes.data ?? []) {
        if (s.category_id) countMap[s.category_id] = (countMap[s.category_id] ?? 0) + 1
      }
      setCats((catRes.data ?? []).map(c => ({ ...c, service_count: countMap[c.id] ?? 0 })))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openAdd() {
    const nextOrder = cats.length > 0 ? Math.max(...cats.map(c => c.sort_order ?? 0)) + 1 : 1
    setForm({ ...BLANK, sort_order: String(nextOrder) })
    setFormErr('')
    setModal(true)
  }
  function openEdit(c: Category) {
    setForm({ id: c.id, name: c.name, color: c.color, sort_order: String(c.sort_order ?? ''), is_active: c.is_active })
    setFormErr('')
    setModal(true)
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
        client_id: CLIENT_ID,
        name: form.name.trim(),
        color: form.color,
        sort_order: parseInt(form.sort_order, 10) || 0,
        is_active: form.is_active,
      }
      const { error: err } = form.id
        ? await supabase.from('service_categories').update(payload).eq('id', form.id)
        : await supabase.from('service_categories').insert(payload)
      if (err) {
        setFormErr(err.code === '23505' ? 'A category with that name already exists.' : err.message)
        return
      }
      setModal(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(c: Category) {
    const { error } = await supabase.from('service_categories').update({ is_active: !c.is_active }).eq('id', c.id)
    if (error) alert(`Update failed: ${error.message}`)
    await load()
  }

  async function deleteCategory() {
    if (!confirmDelete) return
    setDeleting(true)
    setDeleteErr('')
    try {
      const { error: err } = await supabase.from('service_categories').delete().eq('id', confirmDelete.id)
      if (err) {
        setDeleteErr(
          err.code === '23503' ? 'This category is used by existing services. Deactivate it instead.' : err.message,
        )
        return
      }
      setConfirmDelete(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  const visible = cats.filter(c => showInactive || c.is_active)

  return (
    <div style={{ padding: '28px 32px', background: D.page, minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: '0 0 3px', fontSize: 22, fontWeight: 700, color: D.charcoal }}>Service Categories</h1>
          <p style={{ margin: 0, fontSize: 12.5, color: D.muted }}>Organize your service menu into groups</p>
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
            + Add Category
          </button>
        </div>
      </div>

      <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 32, color: D.red, fontSize: 13 }}>{error}</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>No categories yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#F0EBE0', borderBottom: `1px solid ${D.border}` }}>
                {['Category', 'Services', 'Order', 'Status', ''].map(h => (
                  <th
                    key={h}
                    style={{ padding: '9px 14px', textAlign: 'left', fontWeight: 600, color: D.charcoal, fontSize: 11 }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => (
                <tr
                  key={c.id}
                  style={{
                    borderBottom: i < visible.length - 1 ? `1px solid ${D.border}` : 'none',
                    background: i % 2 === 0 ? D.card : '#F7F4EE',
                    opacity: c.is_active ? 1 : 0.6,
                  }}
                >
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: D.charcoal }}>{c.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px', color: D.muted }}>{c.service_count ?? 0}</td>
                  <td style={{ padding: '11px 14px', color: D.muted }}>{c.sort_order}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <span
                      style={{
                        background: c.is_active ? '#2E7D5214' : '#88888814',
                        color: c.is_active ? D.green : '#888888',
                        border: `1px solid ${c.is_active ? '#2E7D5240' : '#88888840'}`,
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openEdit(c)} style={actionBtn}>
                      Edit
                    </button>
                    <button onClick={() => toggleActive(c)} style={{ ...actionBtn, marginLeft: 6 }}>
                      {c.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDelete(c)
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
              width: 400,
              maxWidth: '95vw',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
          >
            <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${D.border}` }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: D.charcoal }}>
                {form.id ? 'Edit Category' : 'New Category'}
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
                    placeholder="e.g. Massage"
                    style={inp}
                    autoFocus
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>Color</label>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    {COLOR_PRESETS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, color }))}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          background: color,
                          border: form.color === color ? '2px solid #4A4A3F' : '2px solid transparent',
                          cursor: 'pointer',
                          outline: 'none',
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                  <input
                    type="color"
                    value={form.color}
                    onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    style={{
                      width: 40,
                      height: 32,
                      border: `1px solid ${D.border}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                      padding: 2,
                    }}
                  />
                  <span style={{ marginLeft: 8, fontSize: 12, color: D.muted }}>{form.color}</span>
                </div>
                <div>
                  <label style={lbl}>Sort Order</label>
                  <input
                    type="number"
                    min="0"
                    value={form.sort_order}
                    onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                    placeholder="1"
                    style={inp}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                  <input
                    type="checkbox"
                    id="cat-active"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="cat-active" style={{ fontSize: 12.5, color: D.charcoal, cursor: 'pointer' }}>
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
                {saving ? 'Saving…' : form.id ? 'Save Changes' : 'Add Category'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              width: 360,
              maxWidth: '95vw',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              padding: '24px',
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: D.charcoal }}>Delete Category?</h2>
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
                onClick={deleteCategory}
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
