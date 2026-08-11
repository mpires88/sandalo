'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  Cell,
  PieChart,
  Pie,
} from 'recharts'
import { supabase } from '@/lib/supabase'

// ─── Design tokens ────────────────────────────────────────────────────────────

const D = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  card: '#FAFAF8',
  border: '#D9D4C8',
  steel: '#4A7B6A',
  success: '#059669',
  danger: '#DC2626',
  amber: '#D97706',
}
const PIE_COLORS = [
  '#2C5F52',
  '#C8A96E',
  '#4A7B6A',
  '#059669',
  '#D97706',
  '#DC2626',
  '#3D7D7A',
  '#6B6560',
  '#2d6a9f',
  '#c49a28',
]
const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const fmt = (n: number | null | undefined) => {
  if (n == null) return '—'
  return (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString()
}
const fmtK = (n: number | null | undefined) => {
  if (n == null) return '—'
  const abs = Math.abs(n)
  return (n < 0 ? '-' : '') + (abs >= 1000 ? '$' + (abs / 1000).toFixed(0) + 'K' : '$' + Math.round(abs))
}
const fmtPct = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1) + '%')

// ─── Shared small components ──────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  color = D.sage,
  warn = false,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  warn?: boolean
}) {
  return (
    <div
      style={{
        flex: '1 1 170px',
        minWidth: 150,
        background: D.card,
        border: `1px solid ${D.border}`,
        borderTop: `3px solid ${warn ? D.danger : color}`,
        borderRadius: 7,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          color: D.gold,
          textTransform: 'uppercase',
          letterSpacing: '.07em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: warn ? D.danger : D.sage }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'rgba(74,74,63,0.6)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        color: D.gold,
        textTransform: 'uppercase',
        letterSpacing: '.07em',
        margin: '28px 0 12px',
        borderBottom: `1px solid ${D.border}`,
        paddingBottom: 7,
      }}
    >
      {children}
    </h3>
  )
}

const ttStyle = {
  background: D.sage,
  border: 'none',
  borderRadius: 5,
  color: '#fff',
  fontSize: 11,
  padding: '8px 12px',
}

function CustomTip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={ttStyle}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'rgba(255,255,255,0.7)', fontSize: 10 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: '#fff' }}>
          {p.name}: {p.value != null ? fmt(p.value) : '—'}
        </div>
      ))}
    </div>
  )
}

// ─── LEAF Tranche 2 constants (from Feb 2026 commitment letter) ───────────────

const LEAF_CLOSE_DATE = '2026-04-07' // actual closing date
const LEAF_T2_DATE = '2026-10-07' // 6 months after closing
const LEAF_T2_MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']
const LOCAL26_MIN = 11000 // ≥ $11,000/month avg from Local 26
const GPM_MIN = 35 // ≥ 35% gross profit margin

// ─── Dashboard ────────────────────────────────────────────────────────────────

type Txn = { transaction_date: string; amount: string | number; account: string }
interface SquareReport {
  period: string
  gross_sales: number
  net_sales: number
  tax_collected: number
  fees: number
  net_total: number
  categories: Array<{ name: string; count: number; amount: number }>
}

export default function Dashboard({ clientId }: { clientId: string }) {
  const [txns, setTxns] = useState<Txn[]>([])
  const [squareReports, setSquareReports] = useState<SquareReport[]>([])
  const [sectionMap, setSectionMap] = useState<Record<string, string>>({})
  const [parentMap, setParentMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      // Paginate bank_transactions to avoid the 1000-row Supabase cap.
      // .order() makes the pages stable — unordered ranges can skip/duplicate rows.
      type TxnRow = {
        transaction_date: string
        amount: string | number
        account: string | null
        splits: Array<{ account: string; amount: number }> | null
      }
      let allRows: TxnRow[] = []
      let offset = 0
      while (true) {
        const res = await supabase
          .from('bank_transactions')
          .select('transaction_date, amount, account, splits')
          .eq('client_id', clientId)
          .or('account.not.is.null,splits.not.is.null')
          .order('id')
          .range(offset, offset + 999)
        const batch = (res.data ?? []) as TxnRow[]
        allRows = [...allRows, ...batch]
        if (batch.length < 1000) break
        offset += 1000
      }
      // Expand split transactions into their legs — the parent row's account is null,
      // so without this every split disappears from the P&L entirely
      const allTxns: Txn[] = []
      for (const t of allRows) {
        if (t.splits?.length) {
          for (const leg of t.splits)
            if (leg.account)
              allTxns.push({ transaction_date: t.transaction_date, amount: leg.amount, account: leg.account })
        } else if (t.account) {
          allTxns.push({ transaction_date: t.transaction_date, amount: t.amount, account: t.account })
        }
      }

      const [sqRes, catRes] = await Promise.all([
        supabase
          .from('square_reports')
          .select('period, gross_sales, net_sales, tax_collected, fees, net_total, categories')
          .eq('client_id', clientId)
          .order('period'),
        supabase.from('categories').select('name, pl_section, parent').eq('client_id', clientId),
      ])
      if (!cancelled) {
        setTxns(allTxns)
        setSquareReports(sqRes.data ?? [])
        const map: Record<string, string> = {}
        const pmap: Record<string, string> = {}
        for (const row of catRes.data ?? []) {
          if (row.name && row.pl_section) map[row.name] = row.pl_section
          if (row.name && row.parent) pmap[row.name] = row.parent
        }
        setSectionMap(map)
        setParentMap(pmap)
        if (sqRes.error) setError(sqRes.error.message)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const monthlyPL = useMemo(() => {
    const byMonth: Record<string, Record<string, number>> = {}
    txns.forEach(t => {
      const ym = (t.transaction_date || '').slice(0, 7)
      if (!ym || !t.account) return
      const section = sectionMap[t.account] ?? 'Operating Expenses'
      if (!byMonth[ym]) byMonth[ym] = {}
      byMonth[ym][section] = (byMonth[ym][section] ?? 0) + (Number(t.amount) || 0)
    })
    return Object.keys(byMonth)
      .sort()
      .map(ym => {
        const d = byMonth[ym]
        const [y, m] = ym.split('-')
        const revSum = d.Revenue ?? 0
        const dedSum = d['Deductions to Income'] ?? 0
        const cogsSum = d['Cost of Goods Sold'] ?? 0
        const opexSum = d['Operating Expenses'] ?? 0
        const nonOpInc = d['Non-Operating Income'] ?? 0
        const nonOpExp = d['Non-Operating Expenses'] ?? 0
        const netRev = revSum + dedSum
        const grossProfit = netRev + cogsSum
        const netProfit = grossProfit + opexSum + nonOpInc + nonOpExp
        return {
          period: ym,
          year: +y,
          month: +m,
          revenue: netRev,
          cogs: -cogsSum,
          grossProfit,
          grossMarginPct: netRev > 0 ? (grossProfit / netRev) * 100 : null,
          totalOpex: -opexSum,
          netProfit,
        }
      })
  }, [txns, sectionMap])

  const expenseByCategory = useMemo(() => {
    const byCat: Record<string, number> = {}
    // Latest year only — the UI labels this section "{curYear} Expense Breakdown"
    // and divides by current-year month count, so mixing years overstates everything
    const curYr = txns.reduce((max, t) => {
      const y = (t.transaction_date || '').slice(0, 4)
      return y > max ? y : max
    }, '')
    const topParent = (name: string): string => {
      const seen = new Set<string>()
      let cur = name
      while (parentMap[cur] && !seen.has(cur)) {
        seen.add(cur)
        cur = parentMap[cur]
      }
      return cur
    }
    txns.forEach(t => {
      if (!t.account) return
      if ((t.transaction_date || '').slice(0, 4) !== curYr) return
      const section = sectionMap[t.account] ?? 'Operating Expenses'
      if (section !== 'Operating Expenses') return
      const key = topParent(t.account)
      byCat[key] = (byCat[key] ?? 0) + (Number(t.amount) || 0)
    })
    return Object.entries(byCat)
      .map(([name, sum]) => ({ name, value: Math.round(-sum) }))
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [txns, sectionMap, parentMap])

  // LEAF Tranche 2: gross profit margin avg over measurement window
  const leafGPM = useMemo(() => {
    const rows = monthlyPL.filter(r => LEAF_T2_MONTHS.includes(r.period) && r.grossMarginPct != null)
    if (!rows.length) return null
    return rows.reduce((s, r) => s + r.grossMarginPct!, 0) / rows.length
  }, [monthlyPL])

  // LEAF Tranche 2: average monthly revenue from Local 26 over measurement window
  const leafLocal26 = useMemo(() => {
    const byMonth: Record<string, number> = {}
    for (const t of txns) {
      const ym = (t.transaction_date || '').slice(0, 7)
      if (!LEAF_T2_MONTHS.includes(ym)) continue
      if (!(t.account ?? '').toLowerCase().includes('local 26')) continue
      byMonth[ym] = (byMonth[ym] ?? 0) + (Number(t.amount) || 0)
    }
    const vals = Object.values(byMonth)
    return {
      byMonth,
      avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null,
      monthsTracked: vals.length,
    }
  }, [txns])

  if (loading)
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, background: D.page }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            border: `2px solid ${D.border}`,
            borderTopColor: D.sage,
            borderRadius: '50%',
            animation: 'spin .7s linear infinite',
          }}
        />
      </div>
    )

  if (error)
    return (
      <div style={{ padding: 28 }}>
        <div
          style={{
            background: '#FDE8E8',
            border: '1px solid #F5C2C2',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 12,
            color: '#991B1B',
          }}
        >
          Failed to load: {error}
        </div>
      </div>
    )

  if (!txns.length && !squareReports.length)
    return (
      <div style={{ background: D.page, minHeight: '100%' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            padding: '14px 28px',
            background: D.card,
            borderBottom: `1px solid ${D.border}`,
          }}
        >
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: D.sage, margin: '0 0 2px' }}>Business Dashboard</h2>
            <p style={{ fontSize: 11, color: 'rgba(74,74,63,0.65)', margin: 0 }}>Sandalo</p>
          </div>
        </header>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 400,
            padding: 40,
            textAlign: 'center',
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke={D.border}
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginBottom: 16 }}
          >
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
            <line x1="2" y1="20" x2="22" y2="20" />
          </svg>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: D.sage, margin: '0 0 8px' }}>No data yet</h3>
          <p style={{ fontSize: 12, color: D.charcoal, opacity: 0.7, maxWidth: 380, lineHeight: 1.7, margin: 0 }}>
            Import your bank transactions or upload a Square Sales Report email to get started.
          </p>
        </div>
      </div>
    )

  const hasTxnData = monthlyPL.length > 0
  const years = hasTxnData ? [...new Set(monthlyPL.map(r => r.year))].sort() : []
  const curYear = years[years.length - 1] ?? null
  const prevYear = years.length >= 2 ? years[years.length - 2] : null

  const byYear = (yr: number) => monthlyPL.filter(r => r.year === yr)
  const sumF = (rows: typeof monthlyPL, f: keyof (typeof monthlyPL)[0]) =>
    rows.reduce((s, r) => s + ((r[f] as number) ?? 0), 0)

  const curRows = curYear ? byYear(curYear) : []
  const prevRows = prevYear ? byYear(prevYear) : []

  const curRevenue = sumF(curRows, 'revenue')
  const prevRevenue = sumF(prevRows, 'revenue')
  const curGrossProfit = sumF(curRows, 'grossProfit')
  const curNetProfit = sumF(curRows, 'netProfit')
  const totalOpexCur = sumF(curRows, 'totalOpex')

  const yoyGrowth = prevRevenue ? (((curRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1) : null

  const curMonthNums = curRows.map(r => r.month)
  const ytdPrev = sumF(
    prevRows.filter(r => curMonthNums.includes(r.month)),
    'revenue',
  )
  const ytdGrowth = ytdPrev ? (((curRevenue - ytdPrev) / ytdPrev) * 100).toFixed(1) : null

  const bestMonth = hasTxnData ? [...monthlyPL].sort((a, b) => b.revenue - a.revenue)[0] : null

  const avgGrossMargin = curRows.length
    ? curRows.filter(r => r.grossMarginPct != null).reduce((s, r, _, a) => s + r.grossMarginPct! / a.length, 0)
    : 0

  const monthlyComparison = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    const row: Record<string, string | number | null> = { month: MON[m] }
    years.forEach(yr => {
      const r = monthlyPL.find(d => d.year === yr && d.month === m)
      row[String(yr)] = r?.revenue ?? null
    })
    return row
  })

  const plChart = curRows.map(r => ({
    label: MON[r.month],
    'Gross Profit': r.grossProfit,
    'Operating Expenses': r.totalOpex,
    'Net Profit': r.netProfit,
  }))

  const revTrend = monthlyPL.map(r => ({
    label: `${MON[r.month]} '${String(r.year).slice(2)}`,
    revenue: r.revenue,
  }))

  const takeaways = [
    yoyGrowth && {
      title: `Revenue ${+yoyGrowth >= 0 ? 'grew' : 'declined'} ${Math.abs(+yoyGrowth)}% year over year`,
      body: `${curYear} revenue is ${fmt(curRevenue)} vs ${fmt(prevRevenue)} in ${prevYear}.`,
    },
    avgGrossMargin > 0 && {
      title: `Gross margin averaging ${fmtPct(avgGrossMargin)}`,
      body:
        avgGrossMargin < 30
          ? `For every $1 in service revenue, ~${(100 - avgGrossMargin).toFixed(0)} cents goes back into service costs. Reducing supply costs or raising prices will improve this.`
          : `Healthy gross margin. Keep monitoring your cost of services to maintain this level.`,
    },
    expenseByCategory.length > 0 &&
      totalOpexCur > 0 && {
        title: `${expenseByCategory[0].name} is your largest expense`,
        body: `${fmt(expenseByCategory[0].value)} in ${curYear} — ${fmtPct((expenseByCategory[0].value / totalOpexCur) * 100)} of total operating expenses.`,
      },
    bestMonth && {
      title: `${MON[bestMonth.month]} ${bestMonth.year} was your best month`,
      body: `${fmt(bestMonth.revenue)} in revenue${bestMonth.grossMarginPct != null ? ` at ${fmtPct(bestMonth.grossMarginPct)} gross margin` : ''}.`,
    },
    {
      title: curNetProfit >= 0 ? `Profitable in ${curYear}` : `Near breakeven on net profit`,
      body: `${curYear} net P&L: ${fmt(curNetProfit)} after all expenses.${curNetProfit < 0 ? ' Continued revenue growth should tip into consistent profitability.' : ''}`,
    },
  ].filter(Boolean) as Array<{ title: string; body: string }>

  return (
    <div style={{ background: D.page, minHeight: '100%' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '14px 28px',
          background: D.card,
          borderBottom: `1px solid ${D.border}`,
        }}
      >
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: D.sage, margin: '0 0 2px' }}>Business Dashboard</h2>
          <p style={{ fontSize: 11, color: 'rgba(74,74,63,0.65)', margin: 0 }}>
            Sandalo · {monthlyPL.length} months of data
          </p>
        </div>
      </header>

      <div style={{ padding: '20px 28px', maxWidth: 1160 }}>
        {hasTxnData && (
          <>
            <SectionTitle>Key Metrics · {curYear}</SectionTitle>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              <KpiCard
                label={`${curYear} Revenue`}
                value={fmt(curRevenue)}
                sub={
                  yoyGrowth
                    ? `${+yoyGrowth >= 0 ? '↑' : '↓'} ${Math.abs(+yoyGrowth)}% vs ${prevYear}`
                    : `${curRows.length} months`
                }
                color={D.steel}
              />
              {prevYear && (
                <KpiCard
                  label={`${prevYear} Revenue`}
                  value={fmt(prevRevenue)}
                  sub={`${prevRows.length} months`}
                  color={D.charcoal}
                />
              )}
              <KpiCard
                label={`${curYear} Gross Profit`}
                value={fmt(curGrossProfit)}
                sub={avgGrossMargin > 0 ? `${fmtPct(avgGrossMargin)} avg margin` : undefined}
                color={D.gold}
              />
              {ytdGrowth && (
                <KpiCard
                  label="YTD Growth"
                  value={`${+ytdGrowth >= 0 ? '+' : ''}${ytdGrowth}%`}
                  sub={`vs same period ${prevYear}`}
                  color={+ytdGrowth >= 0 ? D.success : D.danger}
                />
              )}
              <KpiCard
                label="Best Month"
                value={fmt(bestMonth?.revenue)}
                sub={bestMonth ? `${MON[bestMonth.month]} ${bestMonth.year}` : undefined}
                color={D.success}
              />
              <KpiCard
                label={`${curYear} Net P&L`}
                value={fmt(curNetProfit)}
                sub="After all expenses"
                warn={curNetProfit < 0}
              />
            </div>

            {/* ── LEAF Tranche 2 Tracker ─────────────────────────────────────── */}
            {(() => {
              const today = new Date()
              const curYM = today.toISOString().slice(0, 7)
              const daysLeft = Math.ceil((new Date(LEAF_T2_DATE + 'T12:00:00').getTime() - today.getTime()) / 86400000)
              const elapsed = LEAF_T2_MONTHS.filter(m => m <= curYM).length
              const gpmMet = leafGPM != null && leafGPM >= GPM_MIN
              const gpmColor = leafGPM == null ? D.charcoal : gpmMet ? D.success : D.danger
              const l26Met = leafLocal26.avg != null && leafLocal26.avg >= LOCAL26_MIN
              const l26Color = leafLocal26.avg == null ? D.charcoal : l26Met ? D.success : D.danger

              const condCard = (
                label: string,
                target: string,
                value: string | null,
                met: boolean | null,
                color: string,
                progress: number,
              ) => (
                <div
                  style={{
                    flex: '1 1 220px',
                    background: D.page,
                    border: `1px solid ${D.border}`,
                    borderRadius: 7,
                    padding: '12px 14px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      color: D.gold,
                      textTransform: 'uppercase',
                      letterSpacing: '.07em',
                      marginBottom: 6,
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(74,74,63,0.6)', marginBottom: 6 }}>Target: {target}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color, marginBottom: 8 }}>{value ?? '—'}</div>
                  <div
                    style={{ height: 5, background: D.border, borderRadius: 3, marginBottom: 6, overflow: 'hidden' }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(0, progress))}%`,
                        background: color,
                        borderRadius: 3,
                        transition: 'width .4s',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color }}>
                    {met == null ? 'No data yet' : met ? '✓ Condition met' : '✗ Below threshold'}
                  </div>
                </div>
              )

              return (
                <div style={{ marginBottom: 24 }}>
                  <SectionTitle>LEAF Loan — Tranche 2 Tracker</SectionTitle>
                  <div
                    style={{
                      background: D.card,
                      border: `1px solid ${D.border}`,
                      borderRadius: 8,
                      padding: '16px 20px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        marginBottom: 14,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: D.sage }}>Tranche 2 · $30,000</div>
                        <div style={{ fontSize: 11, color: 'rgba(74,74,63,0.65)', marginTop: 3 }}>
                          Measurement window: {LEAF_CLOSE_DATE} – {LEAF_T2_DATE} · {elapsed}/6 months with data
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: daysLeft > 0 ? D.sage : D.danger }}>
                          {daysLeft > 0 ? `${daysLeft} days away` : 'Past target date'}
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(74,74,63,0.55)', marginTop: 2 }}>
                          Target: {LEAF_T2_DATE}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                      {condCard(
                        'Local 26 Revenue',
                        `≥ ${fmt(LOCAL26_MIN)}/month avg`,
                        leafLocal26.avg != null ? `${fmt(leafLocal26.avg)}/mo` : null,
                        leafLocal26.avg != null ? l26Met : null,
                        l26Color,
                        leafLocal26.avg != null ? (leafLocal26.avg / LOCAL26_MIN) * 100 : 0,
                      )}
                      {condCard(
                        'Gross Profit Margin',
                        `≥ ${GPM_MIN}%`,
                        leafGPM != null ? fmtPct(leafGPM) : null,
                        leafGPM != null ? gpmMet : null,
                        gpmColor,
                        leafGPM != null ? (leafGPM / GPM_MIN) * 100 : 0,
                      )}
                    </div>

                    <div
                      style={{
                        borderTop: `1px solid ${D.border}`,
                        paddingTop: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: D.gold,
                          textTransform: 'uppercase',
                          letterSpacing: '.07em',
                          marginBottom: 2,
                        }}
                      >
                        Qualitative Conditions
                      </div>
                      {[
                        'No event of default has occurred and is continuing',
                        'All representations and warranties remain true and correct in all material respects',
                      ].map((c, i) => (
                        <div
                          key={i}
                          style={{ fontSize: 11, color: D.charcoal, display: 'flex', gap: 7, alignItems: 'flex-start' }}
                        >
                          <span style={{ color: D.gold, fontWeight: 700, flexShrink: 0 }}>◦</span>
                          {c}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })()}

            {years.length >= 2 && (
              <>
                <SectionTitle>Monthly Revenue — Year over Year</SectionTitle>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={monthlyComparison} barCategoryGap="25%" barGap={3}>
                    <CartesianGrid strokeDasharray="3 3" stroke={D.border} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: D.charcoal }} />
                    <YAxis tickFormatter={v => fmtK(v)} tick={{ fontSize: 10, fill: D.charcoal }} width={52} />
                    <Tooltip content={<CustomTip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {years.map((yr, i) => (
                      <Bar
                        key={yr}
                        dataKey={String(yr)}
                        fill={[D.border, D.steel, D.sage][i] ?? D.gold}
                        radius={[3, 3, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}

            {plChart.length > 0 && (
              <>
                <SectionTitle>{curYear} Monthly Profit & Loss</SectionTitle>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={plChart} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke={D.border} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: D.charcoal }} />
                    <YAxis tickFormatter={v => fmtK(v)} tick={{ fontSize: 10, fill: D.charcoal }} width={56} />
                    <Tooltip content={<CustomTip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke={D.charcoal} strokeWidth={1} />
                    <Bar dataKey="Gross Profit" fill={D.gold} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Operating Expenses" fill="#C4B8A0" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Net Profit" fill={D.success} radius={[3, 3, 0, 0]}>
                      {plChart.map((entry, i) => (
                        <Cell key={i} fill={entry['Net Profit'] >= 0 ? D.success : D.danger} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </>
        )}

        {squareReports.length > 0 &&
          (() => {
            const allCats = [...new Set(squareReports.flatMap(r => (r.categories || []).map(c => c.name)))]
            const catColors = ['#2C5F52', '#C8A96E', '#4A7B6A', '#059669', '#D97706', '#DC2626', '#3D7D7A', '#6B6560']
            const chartData = squareReports.map(r => {
              const [y, m] = r.period.split('-')
              const row: Record<string, string | number> = { label: `${MON[+m]} '${String(y).slice(2)}` }
              ;(r.categories || []).forEach(c => {
                row[c.name] = c.amount
              })
              return row
            })
            return (
              <>
                <SectionTitle>Revenue by Service Category (Square)</SectionTitle>
                <p style={{ fontSize: 11, color: 'rgba(74,74,63,0.65)', margin: '-8px 0 14px' }}>
                  Breakdown from your monthly Square sales reports.
                </p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} barCategoryGap="25%" barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke={D.border} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: D.charcoal }} />
                    <YAxis tickFormatter={v => fmtK(v)} tick={{ fontSize: 10, fill: D.charcoal }} width={52} />
                    <Tooltip
                      formatter={(v, name) => ['$' + Math.round(Number(v)).toLocaleString(), name as string]}
                      contentStyle={{
                        background: D.sage,
                        border: 'none',
                        borderRadius: 5,
                        color: '#fff',
                        fontSize: 11,
                        padding: '8px 12px',
                      }}
                      labelStyle={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600, marginBottom: 4, fontSize: 10 }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {allCats.map((cat, i) => (
                      <Bar
                        key={cat}
                        dataKey={cat}
                        fill={catColors[i % catColors.length]}
                        radius={[3, 3, 0, 0]}
                        stackId="a"
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </>
            )
          })()}

        {hasTxnData && (
          <>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 4 }}>
              {expenseByCategory.length > 0 && (
                <div style={{ flex: '1 1 380px' }}>
                  <SectionTitle>{curYear} Expense Breakdown</SectionTitle>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={expenseByCategory}
                        cx="45%"
                        cy="50%"
                        outerRadius={95}
                        dataKey="value"
                        label={({ name, percent }: { name?: string; percent?: number }) =>
                          `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                        fontSize={10}
                        activeShape={false}
                      >
                        {expenseByCategory.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                    <thead>
                      <tr>
                        {['Category', `${curYear} Total`, 'Monthly Avg'].map((h, i) => (
                          <th
                            key={h}
                            style={{
                              textAlign: i === 0 ? 'left' : 'right',
                              padding: '5px 8px',
                              background: D.page,
                              fontSize: 9.5,
                              fontWeight: 700,
                              color: D.gold,
                              textTransform: 'uppercase',
                              letterSpacing: '.06em',
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {expenseByCategory.map((e, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${D.border}` }}>
                          <td
                            style={{
                              padding: '5px 8px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 11,
                              color: D.charcoal,
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: PIE_COLORS[i % PIE_COLORS.length],
                                flexShrink: 0,
                                display: 'inline-block',
                              }}
                            />
                            {e.name}
                          </td>
                          <td
                            style={{
                              padding: '5px 8px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: 11,
                              color: D.charcoal,
                            }}
                          >
                            {fmt(e.value)}
                          </td>
                          <td
                            style={{
                              padding: '5px 8px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: 11,
                              color: 'rgba(74,74,63,0.55)',
                            }}
                          >
                            {fmt(e.value / curRows.length)}
                          </td>
                        </tr>
                      ))}
                      <tr style={{ background: D.page, fontWeight: 600 }}>
                        <td style={{ padding: '6px 8px', fontSize: 11, color: D.sage }}>Total</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: 11, color: D.sage }}>
                          {fmt(totalOpexCur)}
                        </td>
                        <td
                          style={{ padding: '6px 8px', textAlign: 'right', fontSize: 11, color: 'rgba(74,74,63,0.55)' }}
                        >
                          {fmt(totalOpexCur / curRows.length)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {revTrend.length > 1 && (
                <div style={{ flex: '1 1 380px' }}>
                  <SectionTitle>Revenue Trend — All Months</SectionTitle>
                  <ResponsiveContainer width="100%" height={expenseByCategory.length > 0 ? 240 : 200}>
                    <LineChart data={revTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke={D.border} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: D.charcoal }}
                        interval={Math.max(0, Math.floor(revTrend.length / 8))}
                      />
                      <YAxis tickFormatter={v => fmtK(v)} tick={{ fontSize: 10, fill: D.charcoal }} width={52} />
                      <Tooltip content={<CustomTip />} />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke={D.steel}
                        strokeWidth={2}
                        dot={{ r: 2.5, fill: D.steel }}
                        name="Revenue"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {takeaways.length > 0 && (
              <>
                <SectionTitle>Key Takeaways</SectionTitle>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))',
                    gap: 10,
                    marginBottom: 24,
                  }}
                >
                  {takeaways.map((c, i) => (
                    <div
                      key={i}
                      style={{
                        background: D.card,
                        border: `1px solid ${D.border}`,
                        borderLeft: `3px solid ${PIE_COLORS[i % PIE_COLORS.length]}`,
                        borderRadius: 7,
                        padding: '12px 14px',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 5, color: D.sage }}>{c.title}</div>
                      <div style={{ fontSize: 11, color: D.charcoal, lineHeight: 1.6, opacity: 0.85 }}>{c.body}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
