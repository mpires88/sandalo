'use client'

interface Props {
  title: string
  description: string
  fields?: Array<{ label: string; description: string; type?: 'toggle' | 'text' | 'select' | 'number' }>
}

const T = {
  sage: '#2C5F52', gold: '#C8A96E', charcoal: '#4A4A3F',
  page: '#F5F0E8', card: '#FAFAF8', border: '#D9D4C8',
  muted: 'rgba(74,74,63,0.45)',
}

export default function SettingsStub({ title, description, fields = [] }: Props) {
  return (
    <div style={{ padding: '28px 32px', maxWidth: 660 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: T.sage, margin: '0 0 4px' }}>{title}</h1>
        <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>{description}</p>
      </div>

      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {fields.length === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 10 }}>🚧</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.charcoal, marginBottom: 6 }}>Coming soon</div>
            <div style={{ fontSize: 12, color: T.muted }}>This section is not yet configured.</div>
          </div>
        ) : fields.map((f, i) => (
          <div key={f.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '14px 20px', borderBottom: i < fields.length - 1 ? `1px solid ${T.border}` : 'none' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: T.charcoal, marginBottom: 2 }}>{f.label}</div>
              <div style={{ fontSize: 11.5, color: T.muted }}>{f.description}</div>
            </div>
            <div style={{ flexShrink: 0 }}>
              {f.type === 'toggle' ? (
                <div style={{ width: 36, height: 20, borderRadius: 10, background: T.border, opacity: 0.5, cursor: 'not-allowed' }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', margin: '3px 3px', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
                </div>
              ) : (
                <div style={{ width: 140, height: 30, borderRadius: 5, background: '#F0ECE4', border: `1px solid ${T.border}`, opacity: 0.6 }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
