'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { CLIENT_ID } from '@/constants'

interface Addon {
  id: string
  name: string
  name_es: string | null
  description: string | null
  price: number
  duration_minutes: number
  is_active: boolean
  sort_order: number
}

interface ServiceCategory {
  id: string
  name: string
  color: string | null
}

interface AddonForm {
  name: string
  name_es: string
  description: string
  price: string
  duration_minutes: string
  is_active: boolean
  categoryIds: Set<string> // empty = applies to all
}

const BLANK: AddonForm = {
  name: '',
  name_es: '',
  description: '',
  price: '',
  duration_minutes: '0',
  is_active: true,
  categoryIds: new Set(),
}

const T = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  card: '#FAFAF8',
  border: '#D9D4C8',
  red: '#B94040',
  muted: 'rgba(74,74,63,0.5)',
}

const inp: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: `1px solid ${T.border}`,
  borderRadius: 5,
  fontSize: 12.5,
  background: '#fff',
  color: T.charcoal,
  outline: 'none',
  boxSizing: 'border-box',
}

const lbl: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: T.charcoal,
  marginBottom: 4,
  display: 'block',
}

export default function ServiceAddons() {
  const [addons, setAddons] = useState<Addon[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  // map of addon_id → Set of category_ids
  const [addonCatMap, setAddonCatMap] = useState<Map<string, Set<string>>>(new Map())
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Addon | null>(null)
  const [form, setForm] = useState<AddonForm>({ ...BLANK, categoryIds: new Set() })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: addonsData }, { data: catsData }, { data: linkData }] = await Promise.all([
      supabase.from('service_addons').select('*').eq('client_id', CLIENT_ID).order('sort_order').order('name'),
      supabase
        .from('service_categories')
        .select('id,name,color')
        .eq('client_id', CLIENT_ID)
        .eq('is_active', true)
        .order('sort_order'),
      supabase.from('service_addon_categories').select('addon_id,category_id'),
    ])
    setAddons(addonsData ?? [])
    setCategories(catsData ?? [])
    const map = new Map<string, Set<string>>()
    ;(linkData ?? []).forEach((r: { addon_id: string; category_id: string }) => {
      if (!map.has(r.addon_id)) map.set(r.addon_id, new Set())
      map.get(r.addon_id)!.add(r.category_id)
    })
    setAddonCatMap(map)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setForm({ ...BLANK, categoryIds: new Set() })
    setEditing(null)
    setErr('')
    setModal(true)
  }

  function openEdit(a: Addon) {
    setForm({
      name: a.name,
      name_es: a.name_es ?? '',
      description: a.description ?? '',
      price: String(a.price),
      duration_minutes: String(a.duration_minutes),
      is_active: a.is_active,
      categoryIds: new Set(addonCatMap.get(a.id) ?? []),
    })
    setEditing(a)
    setErr('')
    setModal(true)
  }

  function toggleCategory(id: string) {
    setForm(f => {
      const next = new Set(f.categoryIds)
      next.has(id) ? next.delete(id) : next.add(id)
      return { ...f, categoryIds: next }
    })
  }

  async function save() {
    if (!form.name.trim()) {
      setErr('Name is required')
      return
    }
    const price = parseFloat(form.price)
    if (Number.isNaN(price) || price < 0) {
      setErr('Price must be ≥ 0')
      return
    }
    const dur = parseInt(form.duration_minutes, 10)
    if (Number.isNaN(dur) || dur < 0) {
      setErr('Duration must be ≥ 0')
      return
    }

    setSaving(true)
    setErr('')
    const row = {
      client_id: CLIENT_ID,
      name: form.name.trim(),
      name_es: form.name_es.trim() || null,
      description: form.description.trim() || null,
      price,
      duration_minutes: dur,
      is_active: form.is_active,
      sort_order: editing?.sort_order ?? addons.length * 10,
    }

    let addonId: string
    if (editing) {
      const { error } = await supabase.from('service_addons').update(row).eq('id', editing.id)
      if (error) {
        setErr(error.message)
        setSaving(false)
        return
      }
      addonId = editing.id
    } else {
      const { data, error } = await supabase.from('service_addons').insert(row).select('id').single()
      if (error || !data) {
        setErr(error?.message ?? 'Insert failed')
        setSaving(false)
        return
      }
      addonId = data.id
    }

    // Sync category links: delete all then re-insert selected
    await supabase.from('service_addon_categories').delete().eq('addon_id', addonId)
    if (form.categoryIds.size > 0) {
      const links = [...form.categoryIds].map(cid => ({ addon_id: addonId, category_id: cid }))
      await supabase.from('service_addon_categories').insert(links)
    }

    setSaving(false)
    setModal(false)
    load()
  }

  async function toggleActive(a: Addon) {
    await supabase.from('service_addons').update({ is_active: !a.is_active }).eq('id', a.id)
    setAddons(prev => prev.map(x => (x.id === a.id ? { ...x, is_active: !x.is_active } : x)))
  }

  async function del(a: Addon) {
    if (!confirm(`Delete "${a.name}"? This cannot be undone.`)) return
    setDeleting(a.id)
    const { error } = await supabase.from('service_addons').delete().eq('id', a.id)
    setDeleting(null)
    if (error) {
      alert('Could not delete — this add-on may be linked to existing appointments.')
      return
    }
    setAddons(prev => prev.filter(x => x.id !== a.id))
  }

  const catName = (id: string) => categories.find(c => c.id === id)?.name ?? id
  const addonCats = (addonId: string) => [...(addonCatMap.get(addonId) ?? [])]
  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div style={{ padding: '28px 32px', maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: T.sage, margin: '0 0 4px' }}>Add-ons</h1>
          <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>
            Extra services added to appointments. Leave service types blank to allow on any appointment.
          </p>
        </div>
        <button
          onClick={openCreate}
          style={{
            background: T.sage,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Add-on
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: T.muted }}>Loading…</div>
      ) : addons.length === 0 ? (
        <div
          style={{
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: '48px 32px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: T.charcoal, marginBottom: 6 }}>No add-ons yet</div>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 20 }}>
            Add extras like hot stones, aromatherapy, or paraffin treatments.
          </div>
          <button
            onClick={openCreate}
            style={{
              background: T.sage,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Create first add-on
          </button>
        </div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 180px 90px 90px 60px 36px',
              padding: '8px 16px',
              background: T.page,
              borderBottom: `2px solid ${T.border}`,
            }}
          >
            {['Add-on', 'Service Types', 'Price', 'Duration', 'Active', ''].map(h => (
              <div
                key={h}
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: T.gold,
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                }}
              >
                {h}
              </div>
            ))}
          </div>

          {addons.map((a, i) => {
            const cats = addonCats(a.id)
            return (
              <div
                key={a.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 180px 90px 90px 60px 36px',
                  padding: '11px 16px',
                  borderBottom: i < addons.length - 1 ? `1px solid ${T.border}` : 'none',
                  alignItems: 'center',
                  opacity: a.is_active ? 1 : 0.5,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: T.charcoal }}>{a.name}</div>
                  {a.name_es && <div style={{ fontSize: 11, color: T.muted }}>{a.name_es}</div>}
                  {a.description && (
                    <div
                      style={{
                        fontSize: 11,
                        color: T.muted,
                        marginTop: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {a.description}
                    </div>
                  )}
                </div>

                {/* Category pills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {cats.length === 0 ? (
                    <span style={{ fontSize: 10.5, color: T.muted, fontStyle: 'italic' }}>All services</span>
                  ) : (
                    cats.map(cid => (
                      <span
                        key={cid}
                        style={{
                          fontSize: 10.5,
                          background: `${T.sage}18`,
                          color: T.sage,
                          borderRadius: 3,
                          padding: '1px 6px',
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {catName(cid)}
                      </span>
                    ))
                  )}
                </div>

                <div style={{ fontSize: 13, color: T.charcoal, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(a.price)}
                </div>
                <div style={{ fontSize: 13, color: T.muted }}>
                  {a.duration_minutes > 0 ? `+${a.duration_minutes} min` : '—'}
                </div>
                <div>
                  <button
                    onClick={() => toggleActive(a)}
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 10,
                      border: 'none',
                      cursor: 'pointer',
                      background: a.is_active ? T.sage : T.border,
                      position: 'relative',
                      transition: 'background .2s',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 3,
                        left: a.is_active ? 18 : 3,
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: '#fff',
                        transition: 'left .2s',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                      }}
                    />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    onClick={() => openEdit(a)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: T.muted,
                      fontSize: 13,
                      padding: '2px 4px',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = T.charcoal)}
                    onMouseLeave={e => (e.currentTarget.style.color = T.muted)}
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => del(a)}
                    disabled={deleting === a.id}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: T.muted,
                      fontSize: 13,
                      padding: '2px 4px',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = T.red)}
                    onMouseLeave={e => (e.currentTarget.style.color = T.muted)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={e => {
            if (e.target === e.currentTarget) setModal(false)
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              width: 480,
              maxWidth: '95vw',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                padding: '18px 22px 14px',
                borderBottom: `1px solid ${T.border}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.sage }}>
                {editing ? 'Edit Add-on' : 'New Add-on'}
              </h2>
              <button
                onClick={() => setModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 16,
                  color: T.muted,
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '18px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>Name *</label>
                  <input
                    style={inp}
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Hot Stone Enhancement"
                    autoFocus
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>Name (Spanish)</label>
                  <input
                    style={inp}
                    value={form.name_es}
                    onChange={e => setForm(f => ({ ...f, name_es: e.target.value }))}
                    placeholder="e.g. Mejora con Piedras Calientes"
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>Description</label>
                  <input
                    style={inp}
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Short description shown to staff"
                  />
                </div>
                <div>
                  <label style={lbl}>Price</label>
                  <input
                    style={inp}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label style={lbl}>Added Duration (min)</label>
                  <input
                    style={inp}
                    type="number"
                    min="0"
                    step="5"
                    value={form.duration_minutes}
                    onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Service type restrictions */}
              <div>
                <label style={lbl}>Available for service types</label>
                <p style={{ fontSize: 11, color: T.muted, margin: '0 0 8px' }}>
                  Select which service types this add-on applies to. Leave all unchecked to allow on any appointment.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {categories.map(cat => {
                    const selected = form.categoryIds.has(cat.id)
                    return (
                      <button
                        key={cat.id}
                        onClick={() => toggleCategory(cat.id)}
                        style={{
                          padding: '5px 14px',
                          borderRadius: 20,
                          fontSize: 12.5,
                          fontWeight: 500,
                          cursor: 'pointer',
                          border: selected ? `2px solid ${T.sage}` : `2px solid ${T.border}`,
                          background: selected ? `${T.sage}12` : '#fff',
                          color: selected ? T.sage : T.charcoal,
                          transition: 'all .15s',
                        }}
                      >
                        {cat.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Active toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ ...lbl, margin: 0 }}>Active</label>
                <button
                  onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    border: 'none',
                    cursor: 'pointer',
                    background: form.is_active ? T.sage : T.border,
                    position: 'relative',
                    transition: 'background .2s',
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: form.is_active ? 18 : 3,
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left .2s',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                    }}
                  />
                </button>
              </div>

              {err && <div style={{ fontSize: 12, color: T.red }}>{err}</div>}
            </div>

            <div
              style={{
                padding: '14px 22px',
                borderTop: `1px solid ${T.border}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <div>
                {editing && (
                  <button
                    onClick={() => del(editing)}
                    style={{
                      background: 'none',
                      border: `1px solid rgba(185,64,64,0.3)`,
                      borderRadius: 5,
                      padding: '7px 14px',
                      fontSize: 12,
                      color: T.red,
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setModal(false)}
                  style={{
                    background: 'none',
                    border: `1px solid ${T.border}`,
                    borderRadius: 5,
                    padding: '7px 16px',
                    fontSize: 13,
                    color: T.charcoal,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  style={{
                    background: T.sage,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 5,
                    padding: '7px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
