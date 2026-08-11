'use client'

const T = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  card: '#FAFAF8',
  border: '#D9D4C8',
  muted: 'rgba(74,74,63,0.55)',
}

interface FeatureCard {
  title: string
  description: string
}

interface StubPageProps {
  title: string
  subtitle: string
  features: FeatureCard[]
}

export default function StubPage({ title, subtitle, features }: StubPageProps) {
  return (
    <div style={{ background: T.page, minHeight: '100%' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          padding: '14px 28px',
          background: T.card,
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <div>
          <h1 style={{ fontSize: 14, fontWeight: 600, color: T.sage, margin: '0 0 2px' }}>{title}</h1>
          <p style={{ fontSize: 11, color: T.muted, margin: 0 }}>{subtitle}</p>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: T.gold,
            background: '#FDF6EC',
            border: `1px solid ${T.gold}`,
            borderRadius: 4,
            padding: '3px 8px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Coming Soon
        </span>
      </header>

      <div style={{ padding: '28px', maxWidth: 860 }}>
        <div
          style={{
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: '18px 22px',
            marginBottom: 24,
          }}
        >
          <p style={{ fontSize: 12, color: T.charcoal, margin: 0, lineHeight: 1.6 }}>
            This section is planned but not yet built. The features below outline what will be available here.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          {features.map(f => (
            <div
              key={f.title}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 7,
                padding: '14px 16px',
                opacity: 0.85,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: T.sage, marginBottom: 5 }}>{f.title}</div>
              <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>{f.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
