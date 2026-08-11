'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { CLIENT_ID } from '@/constants'

interface Group {
  id: string
  name: string
  description: string | null
}
interface Permission {
  group_id: string
  resource: string
  can_read: boolean
  can_write: boolean
}

const RESOURCES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'clients', label: 'Clients' },
  { key: 'services', label: 'Services & Staff' },
  { key: 'finance', label: 'Finance' },
  { key: 'settings', label: 'Settings' },
]

const T = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
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
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: T.charcoal, marginBottom: 4, display: 'block' }

type PermMap = Record<string, { can_read: boolean; can_write: boolean }>

function defaultPerms(): PermMap {
  return Object.fromEntries(RESOURCES.map(r => [r.key, { can_read: true, can_write: false }]))
}

export default function GroupManagement() {
  const [groups, setGroups] = useState<Group[]>([])
  const [perms, setPerms] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Group | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [fName, setFName] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [fPerms, setFPerms] = useState<PermMap>(defaultPerms())

  const load = useCallback(async () => {
    const [{ data: g }, { data: p }] = await Promise.all([
      supabase.from('user_groups').select('*').eq('client_id', CLIENT_ID).order('name'),
      supabase.from('group_permissions').select('*').eq('client_id', CLIENT_ID),
    ])
    setGroups(g ?? [])
    setPerms(p ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setFName('')
    setFDesc('')
    setFPerms(defaultPerms())
    setEditing(null)
    setErr('')
    setModal(true)
  }

  function openEdit(g: Group) {
    const gPerms: PermMap = {}
    RESOURCES.forEach(r => {
      const p = perms.find(p => p.group_id === g.id && p.resource === r.key)
      gPerms[r.key] = p ? { can_read: p.can_read, can_write: p.can_write } : { can_read: true, can_write: false }
    })
    setFName(g.name)
    setFDesc(g.description ?? '')
    setFPerms(gPerms)
    setEditing(g)
    setErr('')
    setModal(true)
  }

  function togglePerm(resource: string, field: 'can_read' | 'can_write') {
    setFPerms(prev => ({
      ...prev,
      [resource]: {
        ...prev[resource],
        [field]: !prev[resource][field],
        // Enabling write also enables read
        ...(field === 'can_write' && !prev[resource].can_write ? { can_read: true } : {}),
        // Disabling read also disables write
        ...(field === 'can_read' && prev[resource].can_read ? { can_write: false } : {}),
      },
    }))
  }

  async function save() {
    if (!fName.trim()) {
      setErr('Name is required')
      return
    }
    setSaving(true)
    setErr('')
    let groupId: string

    if (editing) {
      const { error } = await supabase
        .from('user_groups')
        .update({ name: fName.trim(), description: fDesc.trim() || null })
        .eq('id', editing.id)
      if (error) {
        setErr(error.message)
        setSaving(false)
        return
      }
      groupId = editing.id
    } else {
      const { data, error } = await supabase
        .from('user_groups')
        .insert({ client_id: CLIENT_ID, name: fName.trim(), description: fDesc.trim() || null })
        .select('id')
        .single()
      if (error || !data) {
        setErr(error?.message ?? 'Insert failed')
        setSaving(false)
        return
      }
      groupId = data.id
    }

    // Sync permissions — these rows ARE the group's access; a failure here must
    // never be silent or every member's permissions quietly change
    const { error: permDelErr } = await supabase.from('group_permissions').delete().eq('group_id', groupId)
    if (permDelErr) {
      setErr(`Permissions not saved: ${permDelErr.message}`)
      setSaving(false)
      return
    }
    const permRows = RESOURCES.map(r => ({
      client_id: CLIENT_ID,
      group_id: groupId,
      resource: r.key,
      can_read: fPerms[r.key]?.can_read ?? true,
      can_write: fPerms[r.key]?.can_write ?? false,
    }))
    const { error: permInsErr } = await supabase.from('group_permissions').insert(permRows)
    if (permInsErr) {
      setErr(`Permissions were cleared but not re-saved — save again: ${permInsErr.message}`)
      setSaving(false)
      load()
      return
    }

    setSaving(false)
    setModal(false)
    load()
  }

  async function del(g: Group) {
    if (!confirm(`Delete "${g.name}"?`)) return
    const { error } = await supabase.from('user_groups').delete().eq('id', g.id)
    if (error) {
      alert(`Delete failed: ${error.message}`)
      return
    }
    load()
  }

  const groupPerms = (groupId: string) =>
    RESOURCES.filter(r => {
      const p = perms.find(p => p.group_id === groupId && p.resource === r.key)
      return p?.can_read || p?.can_write
    }).map(r => {
      const p = perms.find(p => p.group_id === groupId && p.resource === r.key)!
      return `${r.label}${p.can_write ? '' : ' (read)'}`
    })

  return (
    <div style={{ padding: '28px 32px', maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: T.sage, margin: '0 0 4px' }}>Groups</h1>
          <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>
            Define access permissions and assign users to groups
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
          + New Group
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: T.muted }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div
          style={{
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: '48px 32px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: T.charcoal, marginBottom: 6 }}>No groups yet</div>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 20 }}>
            Create groups like "Front Desk", "Therapists", or "Managers" and define what each can access.
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
            Create first group
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map(g => {
            const gp = groupPerms(g.id)
            return (
              <div
                key={g.id}
                style={{
                  background: T.card,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 16,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.charcoal, marginBottom: 3 }}>{g.name}</div>
                  {g.description && (
                    <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>{g.description}</div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {gp.length === 0 ? (
                      <span style={{ fontSize: 11, color: T.muted, fontStyle: 'italic' }}>No permissions set</span>
                    ) : (
                      gp.map(p => (
                        <span
                          key={p}
                          style={{
                            fontSize: 11,
                            background: `${T.sage}14`,
                            color: T.sage,
                            borderRadius: 3,
                            padding: '2px 7px',
                            fontWeight: 500,
                          }}
                        >
                          {p}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => openEdit(g)}
                    style={{
                      background: 'none',
                      border: `1px solid ${T.border}`,
                      borderRadius: 5,
                      padding: '5px 12px',
                      fontSize: 12,
                      color: T.charcoal,
                      cursor: 'pointer',
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => del(g)}
                    style={{
                      background: 'none',
                      border: `1px solid rgba(185,64,64,0.3)`,
                      borderRadius: 5,
                      padding: '5px 12px',
                      fontSize: 12,
                      color: T.red,
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

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
              width: 520,
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
                {editing ? 'Edit Group' : 'New Group'}
              </h2>
              <button
                onClick={() => setModal(false)}
                style={{ background: 'none', border: 'none', fontSize: 16, color: T.muted, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '18px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={lbl}>Group Name *</label>
                <input
                  style={inp}
                  value={fName}
                  onChange={e => setFName(e.target.value)}
                  placeholder="e.g. Front Desk, Therapists, Managers"
                  autoFocus
                />
              </div>
              <div>
                <label style={lbl}>Description</label>
                <input
                  style={inp}
                  value={fDesc}
                  onChange={e => setFDesc(e.target.value)}
                  placeholder="Optional description"
                />
              </div>

              <div>
                <label style={lbl}>Permissions</label>
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 80px 80px',
                      padding: '8px 14px',
                      background: '#F5F0E8',
                      borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        color: T.gold,
                        textTransform: 'uppercase',
                        letterSpacing: '.06em',
                      }}
                    >
                      Section
                    </div>
                    <div
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        color: T.gold,
                        textTransform: 'uppercase',
                        letterSpacing: '.06em',
                        textAlign: 'center',
                      }}
                    >
                      Read
                    </div>
                    <div
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        color: T.gold,
                        textTransform: 'uppercase',
                        letterSpacing: '.06em',
                        textAlign: 'center',
                      }}
                    >
                      Write
                    </div>
                  </div>
                  {RESOURCES.map((r, i) => (
                    <div
                      key={r.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 80px 80px',
                        padding: '10px 14px',
                        borderBottom: i < RESOURCES.length - 1 ? `1px solid ${T.border}` : 'none',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ fontSize: 13, color: T.charcoal }}>{r.label}</div>
                      {(['can_read', 'can_write'] as const).map(field => (
                        <div key={field} style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={fPerms[r.key]?.[field] ?? false}
                            onChange={() => togglePerm(r.key, field)}
                            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: T.sage }}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 11, color: T.muted, margin: '6px 0 0' }}>
                  Write access automatically includes read. Removing read also removes write.
                </p>
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
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Group'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
