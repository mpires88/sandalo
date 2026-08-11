import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Renamed from middleware.ts → proxy.ts per Next.js 16 (the `middleware` convention
// is deprecated). Gates page access: unauthenticated users go to /login, and users
// whose profile has been deactivated are signed out. API routes are exempt here and
// enforce their own auth (see requireAdmin in the route handlers).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  // Allow public assets and API routes through (API routes self-enforce auth).
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/') || pathname === '/favicon.ico') {
    return response
  }

  // Redirect unauthenticated users to login
  if (!user && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Deactivated users: sign out and bounce to login even if their JWT is still valid.
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('is_active').eq('id', user.id).single()
    if (profile && !profile.is_active) {
      await supabase.auth.signOut()
      const redirect = NextResponse.redirect(new URL('/login?inactive=1', request.url))
      // Carry the session-clearing cookies from signOut onto the redirect response.
      response.cookies.getAll().forEach(c => redirect.cookies.set(c))
      return redirect
    }
  }

  // Redirect authenticated users away from login
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
