'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useLanguage } from '@/lib/language'
import { supabase } from '@/lib/supabase'
import { usePermissions } from '@/lib/usePermissions'
import { routeResource } from '@/lib/permissions'

const NAV = [
  { href: '/',              label: 'Dashboard',    icon: IconGrid                          },
  { href: '/appointments',  label: 'Appointments', icon: IconCalendar, group: 'Operations' },
  { href: '/clients',       label: 'Clients',      icon: IconUsers,    group: 'Operations' },
  { href: '/services',      label: 'Services',     icon: IconStar,     group: 'Operations' },
  { href: '/staff',         label: 'Staff',        icon: IconPeople,   group: 'Operations' },
  { href: '/gift-cards',    label: 'Gift Cards',   icon: IconGift,     group: 'Products'   },
  { href: '/memberships',   label: 'Memberships',  icon: IconBadge,    group: 'Products'   },
  { href: '/inventory',     label: 'Inventory',    icon: IconBox,      group: 'Products'   },
  { href: '/accounts',      label: 'Accounts',     icon: IconBank,     group: 'Finance'    },
  { href: '/transactions',  label: 'Transactions', icon: IconCreditCard, group: 'Finance'  },
  { href: '/reports',       label: 'Reports',      icon: IconReport,   group: 'Finance'    },
  { href: '/loans',         label: 'Loans',        icon: IconLoan,     group: 'Finance'    },
  { href: '/admin/settings', label: 'Settings', icon: IconSettings, group: 'Admin' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { lang, setLang } = useLanguage()
  const { name: userName, can } = usePermissions()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // Don't render on the login page
  if (pathname === '/login') return null

  // Only show nav items the user is allowed to read (ungated items always show)
  const visibleNav = NAV.filter(item => {
    const r = routeResource(item.href)
    return r === null || can(r, 'read')
  })

  return (
    <aside style={{
      width: 200, flexShrink: 0,
      background: '#2C5F52',
      display: 'flex', flexDirection: 'column',
      position: 'sticky', top: 0, height: '100vh',
    }}>
      {/* Brand */}
      <div style={{ padding: '16px 14px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1.3 }}>Sandalo</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>Business Finance</div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
        {visibleNav.map((item, i) => {
          const prevGroup = i > 0 ? visibleNav[i - 1].group : undefined
          const active = item.href === '/'
            ? pathname === '/'
            : pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <div key={item.href}>
              {item.group && item.group !== prevGroup && (
                <div style={{
                  margin: '14px 0 4px 8px',
                  fontSize: 8.5, fontWeight: 700,
                  color: 'rgba(255,255,255,0.3)',
                  textTransform: 'uppercase', letterSpacing: '1.3px',
                }}>
                  {item.group}
                </div>
              )}
              <Link
                href={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '5px 8px', marginBottom: 1,
                  textDecoration: 'none',
                  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                  borderLeft: active ? '2px solid #C8A96E' : '2px solid transparent',
                  color: active ? '#fff' : 'rgba(255,255,255,0.6)',
                  fontSize: 11.5, fontWeight: active ? 500 : 400,
                  borderRadius: '0 4px 4px 0',
                  transition: 'background .15s, color .15s',
                }}
              >
                <item.icon />
                {item.label}
              </Link>
            </div>
          )
        })}
      </nav>

      {/* User + Logout */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        {userName && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userName}
          </div>
        )}
        <button
          onClick={signOut}
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.45)', fontSize: 11.5, fontWeight: 400, transition: 'color .15s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sign out
        </button>
      </div>

      {/* Language toggle */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 7 }}>
          Language
        </div>
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: 2, gap: 2 }}>
          {(['en', 'es'] as const).map(l => (
            <button
              key={l}
              onClick={() => setLang(l)}
              style={{
                flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', border: 'none', borderRadius: 4,
                background: lang === l ? '#fff' : 'transparent',
                color: lang === l ? '#2C5F52' : 'rgba(255,255,255,0.5)',
                transition: 'background .15s, color .15s',
                letterSpacing: '0.5px',
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}

function IconBank() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )
}

function IconReport() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/>
      <line x1="8" y1="17" x2="16" y2="17"/>
      <line x1="10" y1="9" x2="8" y2="9"/>
    </svg>
  )
}

function IconLoan() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
  )
}

function IconGrid() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  )
}

function IconCreditCard() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <path d="M2 10h20"/>
    </svg>
  )
}


function IconBook() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  )
}

function IconSquare() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="15" x2="13" y2="15"/>
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

function IconUsers() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}

function IconStar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  )
}

function IconPeople() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  )
}

function IconGift() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/>
      <line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
    </svg>
  )
}

function IconBadge() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>
    </svg>
  )
}

function IconBox() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  )
}

function IconResource() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <path d="M8 21h8"/><path d="M12 17v4"/>
    </svg>
  )
}

function IconTag() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
      <line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

function IconPayment() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <path d="M2 10h20"/><circle cx="7" cy="15" r="1" fill="currentColor" stroke="none"/><path d="M11 15h6"/>
    </svg>
  )
}
