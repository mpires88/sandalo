import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const CLIENT_ID = '00000000-0000-0000-0000-000000000001'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'admin'].includes(profile.role)) return null
  return user
}

// POST /api/admin/users — invite a new user
export async function POST(request: Request) {
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { email, name, role, password, staff_id } = await request.json()
  if (!email || !name || !password) return NextResponse.json({ error: 'email, name, and password are required' }, { status: 400 })
  if (!['admin', 'user'].includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  const admin = adminClient()

  // Create auth user
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })

  // Insert profile
  const { error: profileErr } = await admin.from('profiles').insert({
    id: authData.user.id, client_id: CLIENT_ID, name, email, role,
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
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, role, is_active, name, staff_id } = await request.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const admin = adminClient()
  const updates: Record<string, unknown> = {}
  if (role      !== undefined) updates.role      = role
  if (is_active !== undefined) updates.is_active = is_active
  if (name      !== undefined) updates.name      = name
  if (staff_id  !== undefined) updates.staff_id  = staff_id ?? null

  const { error } = await admin.from('profiles').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (is_active === false) {
    await admin.auth.admin.updateUserById(id, { ban_duration: '876600h' })
  } else if (is_active === true) {
    await admin.auth.admin.updateUserById(id, { ban_duration: 'none' })
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/users?id=... — delete a user
export async function DELETE(request: Request) {
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  if (id === caller.id) return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })

  const admin = adminClient()
  await admin.from('profiles').delete().eq('id', id)
  await admin.auth.admin.deleteUser(id)

  return NextResponse.json({ ok: true })
}
