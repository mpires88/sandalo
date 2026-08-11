import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const CLIENT_ID = '00000000-0000-0000-0000-000000000001'
const SQUARE_VERSION = '2025-01-23'

const squareBase = (env: string) =>
  env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com'

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Caller must be a signed-in, active admin/super_admin
async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).single()
  return !!profile && profile.is_active && ['super_admin', 'admin'].includes(profile.role)
}

// Call a Square endpoint with the given token; returns { ok, status, json }
async function square(env: string, token: string, path: string) {
  const res = await fetch(`${squareBase(env)}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* no body */
  }
  return { ok: res.ok, status: res.status, json }
}

// Metadata returned to the client — never includes the access token itself
function publicShape(row: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  if (!row) return { connected: false }
  return {
    connected: true,
    environment: row.environment,
    merchant_name: row.merchant_name,
    location_id: row.location_id,
    location_name: row.location_name,
    token_last4: row.token_last4,
    connected_at: row.connected_at,
    ...extra,
  }
}

// GET — current connection status (revalidates the stored token against Square)
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = adminClient()
  const { data: row } = await db.from('square_connections').select('*').eq('client_id', CLIENT_ID).maybeSingle()
  if (!row) return NextResponse.json({ connected: false })

  // Live check that the stored token still works
  const check = await square(row.environment, row.access_token, '/v2/locations')
  return NextResponse.json(publicShape(row, { valid: check.ok }))
}

// POST — connect: validate a pasted token, then store it
export async function POST(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { environment, access_token, location_id } = await request.json()

  if (!['sandbox', 'production'].includes(environment))
    return NextResponse.json({ error: 'Invalid environment' }, { status: 400 })
  const token = (access_token ?? '').trim()
  if (!token) return NextResponse.json({ error: 'Access token is required' }, { status: 400 })

  // Validate the token by listing locations
  const locRes = await square(environment, token, '/v2/locations')
  if (!locRes.ok) {
    const msg = (locRes.json as { errors?: { detail?: string }[] })?.errors?.[0]?.detail
    return NextResponse.json(
      { error: msg ?? `Square rejected the token (HTTP ${locRes.status}). Check the token and environment.` },
      { status: 400 },
    )
  }
  const locations = (
    (locRes.json as { locations?: Array<{ id: string; name: string; merchant_id: string; status: string }> })
      ?.locations ?? []
  ).filter(l => l.status !== 'INACTIVE')
  if (locations.length === 0)
    return NextResponse.json({ error: 'Token is valid but the account has no active locations.' }, { status: 400 })

  const chosen = locations.find(l => l.id === location_id) ?? locations[0]

  // Friendly business name from the merchant record
  let merchantName: string | null = null
  if (chosen.merchant_id) {
    const m = await square(environment, token, `/v2/merchants/${chosen.merchant_id}`)
    merchantName = (m.json as { merchant?: { business_name?: string } })?.merchant?.business_name ?? null
  }

  const db = adminClient()
  const { data: row, error } = await db
    .from('square_connections')
    .upsert(
      {
        client_id: CLIENT_ID,
        environment,
        access_token: token,
        merchant_id: chosen.merchant_id ?? null,
        merchant_name: merchantName ?? chosen.name,
        location_id: chosen.id,
        location_name: chosen.name,
        token_last4: token.slice(-4),
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'client_id' },
    )
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json(
    publicShape(row, {
      locations: locations.map(l => ({ id: l.id, name: l.name })),
    }),
  )
}

// PATCH — change the selected location without re-entering the token
export async function PATCH(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { location_id } = await request.json()
  const db = adminClient()
  const { data: row } = await db.from('square_connections').select('*').eq('client_id', CLIENT_ID).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not connected' }, { status: 400 })

  const locRes = await square(row.environment, row.access_token, '/v2/locations')
  const locations = (locRes.json as { locations?: Array<{ id: string; name: string }> })?.locations ?? []
  const chosen = locations.find(l => l.id === location_id)
  if (!chosen) return NextResponse.json({ error: 'Location not found' }, { status: 400 })

  const { data: updated } = await db
    .from('square_connections')
    .update({ location_id: chosen.id, location_name: chosen.name })
    .eq('client_id', CLIENT_ID)
    .select('*')
    .single()
  return NextResponse.json(publicShape(updated, { locations: locations.map(l => ({ id: l.id, name: l.name })) }))
}

// DELETE — disconnect
export async function DELETE() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = adminClient()
  await db.from('square_connections').delete().eq('client_id', CLIENT_ID)
  return NextResponse.json({ connected: false })
}
