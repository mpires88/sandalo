'use client'

import { usePathname } from 'next/navigation'
import { usePermissions } from '@/lib/usePermissions'
import { routeResource } from '@/lib/permissions'

const D = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  border: '#D9D4C8',
  muted: 'rgba(74,74,63,0.5)',
}

function CenterScreen({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: D.page,
        gap: 14,
      }}
    >
      {children}
    </div>
  )
}

export default function AccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { loading, authed, can } = usePermissions()

  // Login page is never gated
  if (pathname === '/login') return <>{children}</>

  // Resolving permissions (only on first load — cached afterward)
  if (loading) {
    return (
      <CenterScreen>
        <div
          style={{
            width: 26,
            height: 26,
            border: `2px solid ${D.border}`,
            borderTopColor: D.sage,
            borderRadius: '50%',
            animation: 'spin .7s linear infinite',
          }}
        />
      </CenterScreen>
    )
  }

  // Not signed in — middleware will redirect to /login; render nothing meanwhile
  if (!authed) return null

  const resource = routeResource(pathname)
  if (resource && !can(resource, 'read')) {
    return (
      <CenterScreen>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'rgba(185,64,64,0.1)',
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#B94040"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: D.charcoal }}>No access to this section</div>
        <div style={{ fontSize: 13, color: D.muted, maxWidth: 340, textAlign: 'center' }}>
          You don&apos;t have permission to view this page. Contact your administrator if you think this is a mistake.
        </div>
      </CenterScreen>
    )
  }

  return <>{children}</>
}
