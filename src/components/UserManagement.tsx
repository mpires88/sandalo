'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { CLIENT_ID } from '@/constants'

interface Profile {
  id: string; name: string; email: string
  role: 'super_admin' | 'admin' | 'user'
  is_active: boolean; created_at: string
  staff_id: string | null
}
interface Group  { id: string; name: string }
interface Member { user_id: string; group_id: string }
interface Staff  { id: string; name: string; role: string | null }

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin', admin: 'Admin', user: 'User',
}
const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  super_admin: { bg: '#FEF3C7', color: '#92400E' },
  admin:       { bg: '#DBEAFE', color: '#1E40AF' },
  user:        { bg: '#F3F4F6', color: '#374151' },
}

const T = {
  sage: '#2C5F52', gold: '#C8A96E', charcoal: '#4A4A3F',
  card: '#FAFAF8', border: '#D9D4C8', red: '#B94040',
  muted: 'rgba(74,74,63,0.5)',
}
const inp: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: `1px solid ${T.border}`,
  borderRadius: 5, fontSize: 12.5, background: '#fff', color: T.charcoal,
  outline: 'none', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: T.charcoal, marginBottom: 4, display: 'block' }

export default function UserManagement() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [groups,   setGroups]   = useState<Group[]>([])
  const [members,  setMembers]  = useState<Member[]>([])
  const [staff,    setStaff]    = useState<Staff[]>([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState<'invite' | 'edit' | null>(null)
  const [editing,  setEditing]  = useState<Profile | null>(null)
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')

  // Form state
  const [fName,     setFName]     = useState('')
  const [fEmail,    setFEmail]    = useState('')
  const [fPassword, setFPassword] = useState('')
  const [fRole,     setFRole]     = useState<Profile['role']>('user')
  const [fGroups,   setFGroups]   = useState<Set<string>>(new Set())
  const [fStaffId,  setFStaffId]  = useState<string>('')

  const load = useCallback(async () => {
    const [{ data: p }, { data: g }, { data: m }, { data: s }] = await Promise.all([
      supabase.from('profiles').select('*').eq('client_id', CLIENT_ID).order('created_at'),
      supabase.from('user_groups').select('id,name').eq('client_id', CLIENT_ID).order('name'),
      supabase.from('user_group_members').select('user_id,group_id').eq('client_id', CLIENT_ID),
      supabase.from('staff').select('id,name,role').eq('client_id', CLIENT_ID).eq('status', 'Active').order('name'),
    ])
    setProfiles(p ?? []); setGroups(g ?? []); setMembers(m ?? []); setStaff(s ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openInvite() {
    setFName(''); setFEmail(''); setFPassword(''); setFRole('user'); setFGroups(new Set()); setFStaffId('')
    setEditing(null); setErr(''); setModal('invite')
  }

  function openEdit(p: Profile) {
    setFName(p.name); setFEmail(p.email); setFPassword('')
    setFRole(p.role)
    setFGroups(new Set(members.filter(m => m.user_id === p.id).map(m => m.group_id)))
    setFStaffId(p.staff_id ?? '')
    setEditing(p); setErr(''); setModal('edit')
  }

  async function saveInvite() {
    if (!fName.trim() || !fEmail.trim() || !fPassword) { setErr('Name, email and password are required'); return }
    setSaving(true); setErr('')
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fName.trim(), email: fEmail.trim(), password: fPassword, role: fRole, staff_id: fStaffId || null }),
    })
    const json = await res.json()
    if (!res.ok) { setErr(json.error ?? 'Failed to create user'); setSaving(false); return }
    // Assign groups
    if (fGroups.size > 0) {
      await supabase.from('user_group_members').insert(
        [...fGroups].map(g => ({ client_id: CLIENT_ID, user_id: json.id, group_id: g }))
      )
    }
    setSaving(false); setModal(null); load()
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true); setErr('')
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // Only send role when it actually changed — avoids demoting a super_admin
      // (whose role isn't selectable here) and avoids a needless hierarchy rejection.
      body: JSON.stringify({
        id: editing.id, name: fName.trim(), staff_id: fStaffId || null,
        ...(fRole !== editing.role ? { role: fRole } : {}),
      }),
    })
    if (!res.ok) { const j = await res.json(); setErr(j.error ?? 'Failed'); setSaving(false); return }
    // Sync group memberships
    await supabase.from('user_group_members').delete().eq('user_id', editing.id).eq('client_id', CLIENT_ID)
    if (fGroups.size > 0) {
      await supabase.from('user_group_members').insert(
        [...fGroups].map(g => ({ client_id: CLIENT_ID, user_id: editing.id, group_id: g }))
      )
    }
    setSaving(false); setModal(null); load()
  }

  async function toggleActive(p: Profile) {
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, is_active: !p.is_active }),
    })
    load()
  }

  async function deleteUser(p: Profile) {
    if (!confirm(`Delete ${p.name}? This cannot be undone.`)) return
    await fetch(`/api/admin/users?id=${p.id}`, { method: 'DELETE' })
    load()
  }

  const userGroups = (userId: string) =>
    members.filter(m => m.user_id === userId).map(m => groups.find(g => g.id === m.group_id)?.name).filter(Boolean)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: T.sage, margin: '0 0 4px' }}>Users</h1>
          <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>Manage who has access to Sandalo</p>
        </div>
        <button onClick={openInvite} style={{ background: T.sage, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          + Invite User
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: T.muted }}>Loading…</div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 140px 130px 70px 60px', padding: '8px 18px', background: '#F5F0E8', borderBottom: `2px solid ${T.border}` }}>
            {['Name / Email', 'Role', 'Staff Member', 'Groups', 'Active', ''].map(h => (
              <div key={h} style={{ fontSize: 9.5, fontWeight: 700, color: T.gold, textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</div>
            ))}
          </div>
          {profiles.map((p, i) => {
            const rc = ROLE_COLORS[p.role] ?? ROLE_COLORS.user
            const grps = userGroups(p.id)
            const linkedStaff = staff.find(s => s.id === p.staff_id)
            return (
              <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 140px 130px 70px 60px', padding: '12px 18px', borderBottom: i < profiles.length - 1 ? `1px solid ${T.border}` : 'none', alignItems: 'center', opacity: p.is_active ? 1 : 0.55 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: T.charcoal }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>{p.email}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, background: rc.bg, color: rc.color, borderRadius: 4, padding: '2px 8px' }}>
                    {ROLE_LABELS[p.role]}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: linkedStaff ? T.charcoal : T.muted, fontStyle: linkedStaff ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {linkedStaff ? linkedStaff.name : '—'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {grps.length === 0
                    ? <span style={{ fontSize: 11, color: T.muted, fontStyle: 'italic' }}>None</span>
                    : grps.map(g => (
                      <span key={g} style={{ fontSize: 10.5, background: `${T.sage}14`, color: T.sage, borderRadius: 3, padding: '1px 6px', fontWeight: 500 }}>{g}</span>
                    ))}
                </div>
                <div>
                  <button onClick={() => toggleActive(p)} style={{ width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', background: p.is_active ? T.sage : T.border, position: 'relative', transition: 'background .2s' }}>
                    <div style={{ position: 'absolute', top: 3, left: p.is_active ? 18 : 3, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => openEdit(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, fontSize: 13, padding: '2px 4px' }}
                    onMouseEnter={e => (e.currentTarget.style.color = T.charcoal)}
                    onMouseLeave={e => (e.currentTarget.style.color = T.muted)}>✎</button>
                  <button onClick={() => deleteUser(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, fontSize: 13, padding: '2px 4px' }}
                    onMouseEnter={e => (e.currentTarget.style.color = T.red)}
                    onMouseLeave={e => (e.currentTarget.style.color = T.muted)}>✕</button>
                </div>
              </div>
            )
          })}
          {profiles.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center', fontSize: 13, color: T.muted }}>No users yet. Invite someone to get started.</div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null) }}>
          <div style={{ background: '#fff', borderRadius: 10, width: 460, maxWidth: '95vw', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.sage }}>{modal === 'invite' ? 'Invite User' : 'Edit User'}</h2>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', fontSize: 16, color: T.muted, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '18px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={lbl}>Name *</label><input style={inp} value={fName} onChange={e => setFName(e.target.value)} autoFocus /></div>
              <div><label style={lbl}>Email *</label><input style={inp} type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} disabled={modal === 'edit'} /></div>
              {modal === 'invite' && (
                <div><label style={lbl}>Password *</label><input style={inp} type="password" value={fPassword} onChange={e => setFPassword(e.target.value)} placeholder="Min. 8 characters" /></div>
              )}
              <div>
                <label style={lbl}>Role</label>
                <select style={inp} value={fRole} onChange={e => setFRole(e.target.value as Profile['role'])}
                  disabled={editing?.role === 'super_admin'}>
                  <option value="user">User — access determined by group</option>
                  <option value="admin">Admin — can manage users and settings</option>
                  {editing?.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                </select>
                {editing?.role === 'super_admin' && (
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>The Super Admin role can’t be changed here.</div>
                )}
              </div>
              <div>
                <label style={lbl}>Linked Staff Member</label>
                <select style={inp} value={fStaffId} onChange={e => setFStaffId(e.target.value)}>
                  <option value="">— Not a staff member —</option>
                  {staff.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.role ? ` (${s.role})` : ''}</option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
                  Links this login to their employee record. What they can see is controlled by their group permissions.
                </div>
              </div>
              {groups.length > 0 && (
                <div>
                  <label style={lbl}>Groups</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {groups.map(g => {
                      const sel = fGroups.has(g.id)
                      return (
                        <button key={g.id} onClick={() => setFGroups(prev => { const n = new Set(prev); sel ? n.delete(g.id) : n.add(g.id); return n })}
                          style={{ padding: '5px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', border: sel ? `2px solid ${T.sage}` : `2px solid ${T.border}`, background: sel ? `${T.sage}12` : '#fff', color: sel ? T.sage : T.charcoal, transition: 'all .15s' }}>
                          {g.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {err && <div style={{ fontSize: 12, color: T.red }}>{err}</div>}
            </div>
            <div style={{ padding: '14px 22px', borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 5, padding: '7px 16px', fontSize: 13, color: T.charcoal, cursor: 'pointer' }}>Cancel</button>
              <button onClick={modal === 'invite' ? saveInvite : saveEdit} disabled={saving}
                style={{ background: T.sage, color: '#fff', border: 'none', borderRadius: 5, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : modal === 'invite' ? 'Send Invite' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
