// Permission resources — must match the resources configured in Group Management
// and the CHECK constraint on group_permissions.resource.
export const RESOURCES = ['dashboard', 'appointments', 'clients', 'services', 'finance', 'settings'] as const

export type Resource = (typeof RESOURCES)[number]
export type PermAction = 'read' | 'write'

// Maps a pathname to the resource that gates it.
// Returns null for routes that are NOT permission-gated (visible to any signed-in user).
export function routeResource(pathname: string): Resource | null {
  if (pathname === '/') return 'dashboard'
  if (pathname.startsWith('/appointments')) return 'appointments'
  if (pathname.startsWith('/clients')) return 'clients'
  if (pathname.startsWith('/services') || pathname.startsWith('/staff')) return 'services'
  if (
    pathname.startsWith('/accounts') ||
    pathname.startsWith('/transactions') ||
    pathname.startsWith('/reports') ||
    pathname.startsWith('/loans')
  )
    return 'finance'
  if (pathname.startsWith('/admin')) return 'settings'
  return null
}
