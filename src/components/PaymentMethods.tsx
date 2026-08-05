'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { CLIENT_ID } from '@/constants'

const D = {
  sage: '#2C5F52', gold: '#C8A96E', charcoal: '#4A4A3F',
  page: '#F5F0E8', card: '#FAFAF8', border: '#D9D4C8',
  red: '#B94040', green: '#2E7D52',
  muted: 'rgba(74,74,63,0.55)',
}

interface PaymentMethod {
  id: string
  name: string
  code: string
  is_active: boolean
  sort_order: number
  created_at: string
}

interface MethodForm {
  id?: string
  name: string
  code: string
  sort_order: string
  is_active: boolean
}

const BLANK: MethodForm = { name: '', code: '', sort_order: '', is_active: true }

function toCode(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export default function PaymentMethods() {
  const [methods,      setMethods]      = useState<PaymentMethod[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')

  const [modal,   setModal]   = useState(false)
  const [form,    setForm]    = useState<MethodForm>({ ...BLANK })
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')

  const [confirmDelete, setConfirmDelete] = useState<PaymentMethod | null>(null)
  const [deleting,      setDeleting]      = useState(false)
  const [deleteErr,     setDeleteErr]     = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data, error: err } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('client_id', CLIENT_ID)
        .order('sort_order')
        .order('name')
        .limit(200)
      if (err) { setError(err.message); return }
      setMethods(data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd() {
    const nextOrder = methods.length > 0
      ? Math.max(...methods.map(m => m.sort_order ?? 0)) + 1
      : 1
    setForm({ ...BLANK, sort_order: String(nextOrder) })
    setFormErr(''); setModal(true)
  }
  function openEdit(m: PaymentMethod) {
    setForm({ id: m.id, name: m.name, code: m.code, sort_order: String(m.sort_order ?? ''), is_active: m.is_active })
    setFormErr(''); setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { setFormErr('Name is required.'); return }
    if (!form.code.trim()) { setFormErr('Code is required.'); return }
    if (!/^[a-z0-9_]+$/.test(form.code)) { setFormErr('Code must be lowercase letters, numbers, and underscores only.'); return }
    setSaving(true); setFormErr('')
    try {
      const payload = {
        client_id: CLIENT_ID,
        name: form.name.trim(),
        code: form.code.trim(),
        sort_order: parseInt(form.sort_order) || 0,
        is_active: form.is_active,
      }
      const { error: err } = form.id
        ? await supabase.from('payment_methods').update(payload).eq('id', form.id)
        : await supabase.from('payment_methods').insert(payload)
      if (err) {
        setFormErr(err.code === '23505' ? 'A method with that code already exists.' : err.message)
        return
      }
      setModal(false)
      await load()
    } finally { setSaving(false) }
  }

  async function toggleActive(m: PaymentMethod) {
    await supabase.from('payment_methods').update({ is_active: !m.is_active }).eq('id', m.id)
    await load()
  }

  async function deleteMethod() {
    if (!confirmDelete) return
    setDeleting(true); setDeleteErr('')
    try {
      const { error: err } = await supabase.from('payment_methods').delete().eq('id', confirmDelete.id)
      if (err) {
        setDeleteErr(err.message)
        return
      }
      setConfirmDelete(null)
      await load()
    } finally { setDeleting(false) }
  }

  const visible = methods.filter(m => showInactive || m.is_active)

  return (
    <div style={{ padding: '28px 32px', background: D.page, minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: '0 0 3px', fontSize: 22, fontWeight: 700, color: D.charcoal }}>Payment Methods</h1>
          <p style={{ margin: 0, fontSize: 12.5, color: D.muted }}>Allowed payment options across appointments and check-ins</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: D.muted, cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          <button onClick={openAdd} style={{ background: D.sage, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + Add Method
          </button>
        </div>
      </div>

      <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 32, color: D.red, fontSize: 13 }}>{error}</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: D.muted, fontSize: 13 }}>No payment methods. Click "+ Add Method" to create one.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#F0EBE0', borderBottom: `1px solid ${D.border}` }}>
                {['Name', 'Code', 'Order', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontWeight: 600, color: D.charcoal, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((m, i) => (
                <tr key={m.id} style={{ borderBottom: i < visible.length - 1 ? `1px solid ${D.border}` : 'none', background: i % 2 === 0 ? D.card : '#F7F4EE', opacity: m.is_active ? 1 : 0.6 }}>
                  <td style={{ padding: '11px 14px', fontWeight: 600, color: D.charcoal }}>{m.name}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <code style={{ background: '#F0EBE0', border: `1px solid ${D.border}`, borderRadius: 3, padding: '2px 6px', fontSize: 11.5, color: D.charcoal }}>{m.code}</code>
                  </td>
                  <td style={{ padding: '11px 14px', color: D.muted }}>{m.sort_order}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{
                      background: m.is_active ? '#2E7D5214' : '#88888814',
                      color:      m.is_active ? D.green     : '#888888',
                      border: `1px solid ${m.is_active ? '#2E7D5240' : '#88888840'}`,
                      borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500,
                    }}>
                      {m.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button onClick={() => openEdit(m)} style={actionBtn}>Edit</button>
                    <button onClick={() => toggleActive(m)} style={{ ...actionBtn, marginLeft: 6 }}>
                      {m.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => { setConfirmDelete(m); setDeleteErr('') }} style={{ ...dangerBtn, marginLeft: 6 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setModal(false) }}>
          <div style={{ background: '#fff', borderRadius: 10, width: 400, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${D.border}` }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: D.charcoal }}>{form.id ? 'Edit Payment Method' : 'New Payment Method'}</h2>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '13px 16px' }}>
                <div style={secHead}>Details</div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>Name *</label>
                  <input
                    value={form.name}
                    onChange={e => {
                      const name = e.target.value
                      setForm(f => ({ ...f, name, code: f.id ? f.code : toCode(name) }))
                    }}
                    placeholder="e.g. Square"
                    style={inp}
                    autoFocus
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>Code *</label>
                  <input
                    value={form.code}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                    placeholder="e.g. square"
                    style={inp}
                  />
                  <div style={{ fontSize: 10.5, color: D.muted, marginTop: 4 }}>
                    Lowercase slug used internally. Cannot change after appointments use it.
                  </div>
                </div>
                <div>
                  <label style={lbl}>Sort Order</label>
                  <input
                    type="number" min="0" step="1"
                    value={form.sort_order}
                    onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                    placeholder="1"
                    style={inp}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                  <input
                    type="checkbox" id="pm-active"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="pm-active" style={{ fontSize: 12.5, color: D.charcoal, cursor: 'pointer' }}>Active</label>
                </div>
                {formErr && <div style={{ gridColumn: '1 / -1', color: D.red, fontSize: 12 }}>{formErr}</div>}
              </div>
            </div>
            <div style={{ padding: '14px 24px', borderTop: `1px solid ${D.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setModal(false)} style={{ background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 6, padding: '8px 18px', fontSize: 13, cursor: 'pointer', color: D.charcoal }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ background: D.sage, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : (form.id ? 'Save Changes' : 'Add Method')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(null) }}>
          <div style={{ background: '#fff', borderRadius: 10, width: 360, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', padding: '24px' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: D.charcoal }}>Delete Payment Method?</h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: D.charcoal }}>
              <strong>{confirmDelete.name}</strong> (<code style={{ fontSize: 12 }}>{confirmDelete.code}</code>) will be permanently removed.
            </p>
            {deleteErr && <div style={{ marginBottom: 12, color: D.red, fontSize: 12.5, background: '#B9404010', border: `1px solid ${D.red}30`, borderRadius: 5, padding: '8px 12px' }}>{deleteErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: D.charcoal }}>Cancel</button>
              <button onClick={deleteMethod} disabled={deleting} style={{ background: D.red, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1 }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const lbl: React.CSSProperties     = { display: 'block', fontSize: 11.5, fontWeight: 600, color: 'rgba(74,74,63,0.7)', marginBottom: 4 }
const inp: React.CSSProperties     = { width: '100%', padding: '7px 10px', fontSize: 12.5, border: '1px solid #D9D4C8', borderRadius: 5, background: '#fff', color: '#4A4A3F', boxSizing: 'border-box' }
const secHead: React.CSSProperties = { gridColumn: '1 / -1', fontSize: 10, fontWeight: 700, color: 'rgba(74,74,63,0.55)', textTransform: 'uppercase', letterSpacing: '0.8px', paddingBottom: 6, borderBottom: '1px solid #D9D4C8' }
const actionBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #D9D4C8', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#4A4A3F' }
const dangerBtn: React.CSSProperties = { background: 'transparent', border: '1px solid rgba(185,64,64,0.35)', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#B94040' }
