'use client'

import { useState, useEffect, useCallback } from 'react'

interface Status {
  connected: boolean
  environment?: string
  merchant_name?: string
  location_id?: string
  location_name?: string
  token_last4?: string
  connected_at?: string
  valid?: boolean
  locations?: { id: string; name: string }[]
}

const T = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  card: '#FAFAF8',
  border: '#D9D4C8',
  red: '#B94040',
  green: '#2E7D52',
  muted: 'rgba(74,74,63,0.5)',
}
const inp: React.CSSProperties = {
  width: '100%',
  padding: '8px 11px',
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
  color: T.charcoal,
  outline: 'none',
  boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: T.charcoal,
  marginBottom: 5,
  display: 'block',
}

const SquareLogo = () => (
  <div
    style={{
      width: 34,
      height: 34,
      borderRadius: 8,
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}
  >
    <div style={{ width: 16, height: 16, border: '2.5px solid #fff', borderRadius: 4 }} />
  </div>
)

const COMING_SOON = [
  { name: 'Google Calendar', desc: 'Sync appointments to staff calendars' },
  { name: 'Twilio / SMS', desc: 'Send appointment reminders by text' },
  { name: 'SendGrid / Email', desc: 'Booking confirmations and receipts' },
  { name: 'QuickBooks', desc: 'Export transactions and payroll' },
]

export default function SquareIntegration() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [env, setEnv] = useState<'sandbox' | 'production'>('sandbox')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/integrations/square')
      const json = await res.json()
      setStatus(json)
      if (json?.environment) setEnv(json.environment)
    } catch {
      setStatus({ connected: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function connect() {
    if (!token.trim()) {
      setError('Paste your Square access token first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/integrations/square', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: env, access_token: token.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Could not connect')
        return
      }
      setToken('')
      setStatus(json)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function changeLocation(location_id: string) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/integrations/square', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id }),
      })
      const json = await res.json()
      if (res.ok) setStatus(s => ({ ...s, ...json }))
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect this Square account? The stored token will be deleted.')) return
    setBusy(true)
    try {
      await fetch('/api/integrations/square', { method: 'DELETE' })
      setStatus({ connected: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 640 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: T.sage, margin: '0 0 4px' }}>Integrations</h1>
        <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>Connect Sandalo to the tools you already use</p>
      </div>

      {/* ── Square card ── */}
      <div
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          overflow: 'hidden',
          marginBottom: 22,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            padding: '16px 18px',
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <SquareLogo />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: T.charcoal }}>Square</div>
            <div style={{ fontSize: 11.5, color: T.muted }}>Process checkout payments and import sales</div>
          </div>
          {loading ? (
            <span style={{ fontSize: 11.5, color: T.muted }}>…</span>
          ) : status?.connected ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                background: '#E6F0E9',
                color: T.green,
                border: '1px solid #B8D4BE',
                borderRadius: 20,
                padding: '3px 11px',
              }}
            >
              ● Connected
            </span>
          ) : (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                background: T.page,
                color: T.muted,
                border: `1px solid ${T.border}`,
                borderRadius: 20,
                padding: '3px 11px',
              }}
            >
              Not connected
            </span>
          )}
        </div>

        <div style={{ padding: '18px' }}>
          {loading ? (
            <div style={{ color: T.muted, fontSize: 13 }}>Loading…</div>
          ) : status?.connected ? (
            /* ── Connected view ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: 13 }}>
                <span style={{ color: T.muted }}>Business</span>
                <span style={{ color: T.charcoal, fontWeight: 500 }}>{status.merchant_name ?? '—'}</span>
                <span style={{ color: T.muted }}>Environment</span>
                <span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '.04em',
                      background: status.environment === 'production' ? '#FDECEC' : '#FEF6E6',
                      color: status.environment === 'production' ? T.red : '#9A6B00',
                      borderRadius: 4,
                      padding: '2px 7px',
                    }}
                  >
                    {status.environment}
                  </span>
                </span>
                <span style={{ color: T.muted }}>Location</span>
                <span style={{ color: T.charcoal }}>
                  {status.locations && status.locations.length > 1 ? (
                    <select
                      value={status.location_id}
                      disabled={busy}
                      onChange={e => changeLocation(e.target.value)}
                      style={{ ...inp, width: 'auto', padding: '4px 8px', fontSize: 12.5 }}
                    >
                      {status.locations.map(l => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (status.location_name ?? '—')
                  )}
                </span>
                <span style={{ color: T.muted }}>Token</span>
                <span style={{ color: T.charcoal, fontFamily: 'monospace', fontSize: 12.5 }}>
                  •••• •••• {status.token_last4}
                </span>
                <span style={{ color: T.muted }}>Token status</span>
                <span style={{ fontSize: 12.5, color: status.valid ? T.green : T.red, fontWeight: 600 }}>
                  {status.valid ? '✓ Valid — Square accepted it' : '✕ Token no longer valid — reconnect'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  onClick={load}
                  disabled={busy}
                  style={{
                    background: 'none',
                    border: `1px solid ${T.border}`,
                    borderRadius: 6,
                    padding: '7px 14px',
                    fontSize: 12.5,
                    color: T.charcoal,
                    cursor: 'pointer',
                  }}
                >
                  Test connection
                </button>
                <button
                  onClick={disconnect}
                  disabled={busy}
                  style={{
                    background: 'none',
                    border: '1px solid rgba(185,64,64,0.3)',
                    borderRadius: 6,
                    padding: '7px 14px',
                    fontSize: 12.5,
                    color: T.red,
                    cursor: 'pointer',
                  }}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            /* ── Connect form ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Environment</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['sandbox', 'production'] as const).map(e => (
                    <button
                      key={e}
                      onClick={() => setEnv(e)}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: 6,
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: env === e ? `2px solid ${T.sage}` : `2px solid ${T.border}`,
                        background: env === e ? `${T.sage}10` : '#fff',
                        color: env === e ? T.sage : T.charcoal,
                        textTransform: 'capitalize',
                      }}
                    >
                      {e}
                      {e === 'sandbox' ? ' (test)' : ' (live)'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={lbl}>Access Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="EAAA… (paste your Square access token)"
                  style={inp}
                  autoComplete="off"
                />
              </div>
              {error && (
                <div
                  style={{
                    background: '#FDE8E8',
                    border: '1px solid #F5C2C2',
                    borderRadius: 6,
                    padding: '8px 11px',
                    fontSize: 12,
                    color: '#991B1B',
                  }}
                >
                  {error}
                </div>
              )}
              <div>
                <button
                  onClick={connect}
                  disabled={busy}
                  style={{
                    background: T.sage,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '9px 20px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {busy ? 'Connecting…' : 'Connect Square'}
                </button>
              </div>

              {/* How-to */}
              <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                <button
                  onClick={() => setShowHelp(v => !v)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: T.sage,
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  {showHelp ? '▼' : '▶'} Where do I get a Sandbox access token?
                </button>
                {showHelp && (
                  <ol
                    style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: 12.5, color: T.charcoal, lineHeight: 1.7 }}
                  >
                    <li>
                      Go to{' '}
                      <a
                        href="https://developer.squareup.com/apps"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: T.sage }}
                      >
                        developer.squareup.com/apps
                      </a>{' '}
                      and sign in with your Square account.
                    </li>
                    <li>
                      Click <strong>+ Create app</strong>, give it a name (e.g. &ldquo;Sandalo&rdquo;), and accept the
                      terms.
                    </li>
                    <li>
                      Open the app. In the top-left, switch the toggle from <strong>Production</strong> to{' '}
                      <strong>Sandbox</strong>.
                    </li>
                    <li>
                      Go to <strong>Credentials</strong> and copy the <strong>Sandbox Access Token</strong> (starts with{' '}
                      <code>EAAA</code>).
                    </li>
                    <li>
                      Paste it above, keep Environment on <strong>Sandbox</strong>, and click{' '}
                      <strong>Connect Square</strong>.
                    </li>
                  </ol>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Other integrations (coming soon) ── */}
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: T.gold,
          textTransform: 'uppercase',
          letterSpacing: '.07em',
          margin: '0 0 10px',
        }}
      >
        More
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {COMING_SOON.map(c => (
          <div
            key={c.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: '12px 16px',
              opacity: 0.7,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: T.charcoal }}>{c.name}</div>
              <div style={{ fontSize: 11.5, color: T.muted }}>{c.desc}</div>
            </div>
            <span style={{ fontSize: 11, color: T.muted, fontStyle: 'italic' }}>Coming soon</span>
          </div>
        ))}
      </div>
    </div>
  )
}
