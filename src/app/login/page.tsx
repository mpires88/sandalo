'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setLoading(true)
    setError('')

    const { error: authErr } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (authErr) {
      setError(authErr.message === 'Invalid login credentials' ? 'Incorrect email or password.' : authErr.message)
      setLoading(false)
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F5F0E8',
        padding: '0 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 52,
              height: 52,
              borderRadius: 14,
              background: '#2C5F52',
              marginBottom: 14,
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#C8A96E"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#2C5F52', letterSpacing: '-0.3px' }}>Sandalo</div>
          <div style={{ fontSize: 12, color: 'rgba(74,74,63,0.5)', marginTop: 3 }}>Business Management</div>
        </div>

        {/* Card */}
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: '28px 30px',
            boxShadow: '0 2px 16px rgba(44,95,82,0.10), 0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <h1 style={{ fontSize: 16, fontWeight: 700, color: '#4A4A3F', margin: '0 0 22px', textAlign: 'center' }}>
            Sign in to your account
          </h1>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: '#4A4A3F', display: 'block', marginBottom: 5 }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                placeholder="you@example.com"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  border: '1px solid #D9D4C8',
                  borderRadius: 7,
                  fontSize: 13.5,
                  color: '#4A4A3F',
                  background: '#fff',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color .15s',
                }}
                onFocus={e => (e.target.style.borderColor = '#2C5F52')}
                onBlur={e => (e.target.style.borderColor = '#D9D4C8')}
              />
            </div>

            <div>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: '#4A4A3F', display: 'block', marginBottom: 5 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  border: '1px solid #D9D4C8',
                  borderRadius: 7,
                  fontSize: 13.5,
                  color: '#4A4A3F',
                  background: '#fff',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color .15s',
                }}
                onFocus={e => (e.target.style.borderColor = '#2C5F52')}
                onBlur={e => (e.target.style.borderColor = '#D9D4C8')}
              />
            </div>

            {error && (
              <div
                style={{
                  background: '#FDE8E8',
                  border: '1px solid #F5C2C2',
                  borderRadius: 6,
                  padding: '9px 12px',
                  fontSize: 12.5,
                  color: '#991B1B',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              style={{
                width: '100%',
                padding: '10px',
                marginTop: 4,
                background: loading || !email || !password ? '#D9D4C8' : '#2C5F52',
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                fontSize: 14,
                fontWeight: 600,
                cursor: loading || !email || !password ? 'not-allowed' : 'pointer',
                transition: 'background .2s',
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11.5, color: 'rgba(74,74,63,0.45)', marginTop: 20 }}>
          Contact your administrator to request access.
        </p>
      </div>
    </div>
  )
}
