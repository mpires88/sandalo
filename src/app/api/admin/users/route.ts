import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CLIENT_ID } from '@/constants'

type Role = 'super_admin' | 'admin' | 'user'
const ROLE_RANK: Record<Role, number> = { user: 1, admin: 2, super_admin: 3 }
const ASSIGNABLE_ROLES: Role[] = ['super_admin', 'admin', 'user']

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Returns the caller (id + role) only if they are a signed-in, ACTIVE admin.
// A banned/deactivated admin whose JWT is still valid is rejected here.
async function requireAdmin(): Promise<{ id: string; role: Role } | null> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).single()
  if (!profile?.is_active) return null
  if (!['super_admin', 'admin'].includes(profile.role)) return null
  return { id: user.id, role: profile.role as Role }
}

// POST /api/admin/users — invite a new user
export async function POST(request: Request) {
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const { email, name, role, password, staff_id } = body
  if (!email || !name || !password)
    return NextResponse.json({ error: 'email, name, and password are required' }, { status: 400 })
  if (!ASSIGNABLE_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  if (typeof password !== 'string' || password.length < 8)
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })

  // A caller can only create a user whose role ranks strictly below their own
  // (an admin cannot mint another admin or a super_admin).
  if (ROLE_RANK[role as Role] >= ROLE_RANK[caller.role]) {
    return NextResponse.json({ error: 'You cannot assign a role at or above your own.' }, { status: 403 })
  }

  const admin = adminClient()

  // Create auth user
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })

  // Insert profile
  const { error: profileErr } = await admin.from('profiles').insert({
    id: authData.user.id,
    client_id: CLIENT_ID,
    name,
    email,
    role,
    staff_id: staff_id ?? null,
  })
  if (profileErr) {
    await admin.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: profileErr.message }, { status: 400 })
  }

  return NextResponse.json({ id: authData.user.id })
}

// PATCH /api/admin/users — update a user's role or active status
export async function PATCH(request: Request) {
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const { id, role, is_active, name, staff_id } = body
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (typeof id !== 'string' || !UUID_RE.test(id))
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  if (name !== undefined && typeof name !== 'string')
    return NextResponse.json({ error: 'name must be a string' }, { status: 400 })
  if (staff_id !== undefined && staff_id !== null && !(typeof staff_id === 'string' && UUID_RE.test(staff_id)))
    return NextResponse.json({ error: 'staff_id must be a UUID or null' }, { status: 400 })

  const admin = adminClient()

  // Load the target so we can enforce the role hierarchy against its CURRENT role.
  const { data: target } = await admin.from('profiles').select('role').eq('id', id).single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const targetRole = target.role as Role

  const editingSelf = id === caller.id

  // You may only act on a user who ranks strictly below you — except you may edit
  // your own non-privileged fields (name/staff link) below.
  if (!editingSelf && ROLE_RANK[targetRole] >= ROLE_RANK[caller.role]) {
    return NextResponse.json({ error: 'You cannot modify a user at or above your own role.' }, { status: 403 })
  }

  const updates: Record<string, unknown> = {}

  if (role !== undefined && role !== targetRole) {
    if (!ASSIGNABLE_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    if (editingSelf) return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 403 })
    // Cannot promote anyone to a role at or above your own.
    if (ROLE_RANK[role as Role] >= ROLE_RANK[caller.role]) {
      return NextResponse.json({ error: 'You cannot assign a role at or above your own.' }, { status: 403 })
    }
    updates.role = role
  }

  if (is_active !== undefined) {
    if (editingSelf && is_active === false)
      return NextResponse.json({ error: 'You cannot deactivate your own account.' }, { status: 403 })
    updates.is_active = is_active
  }
  if (name !== undefined) updates.name = name
  if (staff_id !== undefined) updates.staff_id = staff_id ?? null

  if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true })

  const { error } = await admin.from('profiles').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Keep the auth-level ban in sync with is_active. If it fails, roll the profile
  // flag back so the UI never shows "inactive" for someone who can still sign in.
  if (updates.is_active === false) {
    const { error: banErr } = await admin.auth.admin.updateUserById(id, { ban_duration: '876600h' })
    if (banErr) {
      await admin.from('profiles').update({ is_active: true }).eq('id', id)
      return NextResponse.json({ error: `Could not deactivate sign-in: ${banErr.message}` }, { status: 400 })
    }
  } else if (updates.is_active === true) {
    const { error: unbanErr } = await admin.auth.admin.updateUserById(id, { ban_duration: 'none' })
    if (unbanErr) {
      await admin.from('profiles').update({ is_active: false }).eq('id', id)
      return NextResponse.json({ error: `Could not reactivate sign-in: ${unbanErr.message}` }, { status: 400 })
    }
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/users?id=... — delete a user
export async function DELETE(request: Request) {
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  if (id === caller.id) return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })

  const admin = adminClient()

  const { data: target } = await admin.from('profiles').select('role').eq('id', id).single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (ROLE_RANK[target.role as Role] >= ROLE_RANK[caller.role]) {
    return NextResponse.json({ error: 'You cannot delete a user at or above your own role.' }, { status: 403 })
  }

  // Delete the auth user first; only remove the profile once that succeeds, so a
  // failure can't leave a sign-in-capable auth user with no profile row.
  const { error: authErr } = await admin.auth.admin.deleteUser(id)
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })

  const { error: profErr } = await admin.from('profiles').delete().eq('id', id)
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
