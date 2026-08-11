'use client'

import { usePermissions } from '@/lib/usePermissions'

const D = { charcoal: '#4A4A3F', muted: 'rgba(74,74,63,0.5)' }

// Wraps admin-only content. Renders nothing while loading, an access notice for non-admins.
export default function AdminOnly({ children }: { children: React.ReactNode }) {
  const { loading, isAdmin } = usePermissions()
  if (loading) return null
  if (!isAdmin) {
    return (
      <div style={{ padding: '60px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: D.charcoal, marginBottom: 6 }}>Admins only</div>
        <div style={{ fontSize: 13, color: D.muted }}>Only administrators can manage users and permissions.</div>
      </div>
    )
  }
  return <>{children}</>
}
