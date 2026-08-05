'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { Resource, PermAction } from '@/lib/permissions'

interface PermState {
  loading: boolean
  authed: boolean
  role: string | null
  name: string | null
  isAdmin: boolean                 // super_admin OR admin — full access
  isSuperAdmin: boolean
  can: (resource: Resource, action?: PermAction) => boolean
  refresh: () => void
}

const Ctx = createContext<PermState | null>(null)

type PermMap = Record<string, { read: boolean; write: boolean }>

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [authed,  setAuthed]  = useState(false)
  const [role,    setRole]    = useState<string | null>(null)
  const [name,    setName]    = useState<string | null>(null)
  const [map,     setMap]     = useState<PermMap>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setAuthed(false); setRole(null); setName(null); setMap({}); setLoading(false)
      return
    }
    setAuthed(true)

    const { data: profile } = await supabase
      .from('profiles').select('role, name').eq('id', user.id).single()
    setRole(profile?.role ?? null)
    setName(profile?.name ?? user.email ?? null)

    // Admins and super admins bypass group permissions entirely.
    if (profile?.role === 'super_admin' || profile?.role === 'admin') {
      setMap({}); setLoading(false)
      return
    }

    // Regular user — effective permissions are the UNION of their groups' permissions.
    const { data: members } = await supabase
      .from('user_group_members').select('group_id').eq('user_id', user.id)
    const groupIds = (members ?? []).map(m => m.group_id)

    const next: PermMap = {}
    if (groupIds.length) {
      const { data: perms } = await supabase
        .from('group_permissions')
        .select('resource, can_read, can_write')
        .in('group_id', groupIds)
      ;(perms ?? []).forEach((p: { resource: string; can_read: boolean; can_write: boolean }) => {
        const cur = next[p.resource] ?? { read: false, write: false }
        next[p.resource] = { read: cur.read || p.can_read, write: cur.write || p.can_write }
      })
    }
    setMap(next)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const { data: sub } = supabase.auth.onAuthStateChange(() => load())
    return () => sub.subscription.unsubscribe()
  }, [load])

  const isAdmin      = role === 'super_admin' || role === 'admin'
  const isSuperAdmin = role === 'super_admin'

  const can = useCallback((resource: Resource, action: PermAction = 'read') => {
    if (isAdmin) return true
    const p = map[resource]
    if (!p) return false
    return action === 'write' ? p.write : p.read
  }, [isAdmin, map])

  return (
    <Ctx.Provider value={{ loading, authed, role, name, isAdmin, isSuperAdmin, can, refresh: load }}>
      {children}
    </Ctx.Provider>
  )
}

export function usePermissions(): PermState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePermissions must be used within PermissionsProvider')
  return ctx
}
