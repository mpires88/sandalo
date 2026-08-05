'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { usePermissions } from '@/lib/usePermissions'

const NAV = [
  {
    group: 'General',
    items: [
      { href: '/admin/settings',                  label: 'Hours of Operation' },
      { href: '/admin/settings/business-profile', label: 'Business Profile' },
      { href: '/admin/settings/taxes',            label: 'Taxes' },
    ],
  },
  {
    group: 'Appointments',
    items: [
      { href: '/admin/settings/booking',    label: 'Booking Rules' },
      { href: '/admin/settings/resources',  label: 'Resources' },
    ],
  },
  {
    group: 'Services',
    items: [
      { href: '/admin/settings/service-categories', label: 'Service Categories' },
      { href: '/admin/settings/addons',             label: 'Add-ons' },
      { href: '/admin/settings/payment-methods',    label: 'Payment Methods' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { href: '/admin/settings/chart-of-accounts', label: 'Chart of Accounts' },
      { href: '/admin/settings/square-reports',    label: 'Square Reports' },
      { href: '/admin/settings/payroll',           label: 'Payroll' },
    ],
  },
  {
    group: 'Communication',
    items: [
      { href: '/admin/settings/notifications', label: 'Notifications' },
    ],
  },
  {
    group: 'Integrations',
    items: [
      { href: '/admin/settings/integrations', label: 'Integrations' },
    ],
  },
  {
    group: 'Access Control',
    adminOnly: true,
    items: [
      { href: '/admin/settings/users',  label: 'Users' },
      { href: '/admin/settings/groups', label: 'Groups & Permissions' },
    ],
  },
]

function SettingsNav() {
  const pathname = usePathname()
  const { isAdmin } = usePermissions()
  const sections = NAV.filter(s => !s.adminOnly || isAdmin)
  return (
    <aside style={{
      width: 210, flexShrink: 0,
      background: '#F5F0E8',
      borderRight: '1px solid #D9D4C8',
      overflowY: 'auto',
      padding: '20px 0 24px',
    }}>
      <div style={{ padding: '0 16px 16px', borderBottom: '1px solid #D9D4C8', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#2C5F52' }}>Settings</div>
      </div>
      {sections.map(section => (
        <div key={section.group} style={{ marginBottom: 4 }}>
          <div style={{ padding: '10px 16px 4px', fontSize: 8.5, fontWeight: 700, color: 'rgba(74,74,63,0.4)', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
            {section.group}
          </div>
          {section.items.map(item => {
            const active = item.href === '/admin/settings'
              ? pathname === '/admin/settings'
              : pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '6px 16px 6px 20px',
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 400,
                  color: active ? '#2C5F52' : 'rgba(74,74,63,0.7)',
                  textDecoration: 'none',
                  background: active ? 'rgba(44,95,82,0.08)' : 'transparent',
                  borderLeft: active ? '2px solid #2C5F52' : '2px solid transparent',
                  transition: 'background .15s, color .15s',
                }}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}
    </aside>
  )
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <SettingsNav />
      <main style={{ flex: 1, overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  )
}
