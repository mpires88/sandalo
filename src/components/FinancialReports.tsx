'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { PL_SECTIONS, BS_SECTIONS, mergeAccounts, type MergedAccount } from '@/lib/chartOfAccounts'
import { CLIENT_ID } from '@/constants'
import { type FinancialAccount, accountSection } from '@/components/FinancialAccounts'

const D = {
  sage: '#2C5F52', gold: '#C8A96E', charcoal: '#4A4A3F',
  page: '#F5F0E8', card: '#FAFAF8', border: '#D9D4C8',
  muted: 'rgba(74,74,63,0.55)', red: '#B94040', green: '#16a34a',
}

type ReportMode = 'pl' | 'bs'
type PeriodMode = 'latest' | 'monthly' | 'yearly'

// Revenue/income sections show amounts as-is (positive = good).
// Expense/cost sections have negative raw amounts (debits); multiply by -1 to display as positive costs.
// Liability/equity categories follow the cash convention (draw/contribution = +, repayment = −),
// so their cumulative balances are already positive while owed — display as-is.
const DISPLAY_SIGN: Record<string, number> = {
  'Revenue':                1,
  'Deductions to Income':  -1,
  'Cost of Goods Sold':    -1,
  'Operating Expenses':    -1,
  'Non-Operating Income':   1,
  'Non-Operating Expenses':-1,
  'Current Assets':         1,
  'Non-Current Assets':     1,
  'Current Liabilities':    1,
  'Non-Current Liabilities':1,
  'Equity':                 1,
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtAmt(n: number): string {
  if (!n) return '—'
  const s = '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
  return n < 0 ? `(${s})` : s
}

export default function FinancialReports() {
  // rawTotals[accountName][YYYY-MM] = sum of transaction amounts in that month
  const [rawTotals, setRawTotals] = useState<Record<string, Record<string, number>>>({})
  const [accounts,  setAccounts]  = useState<MergedAccount[]>([])
  const [allMonths, setAllMonths] = useState<string[]>([])  // sorted unique YYYY-MM keys
  const [loading,   setLoading]   = useState(true)
  const [finAccounts,  setFinAccounts]  = useState<FinancialAccount[]>([])
  const [acctMonthly,  setAcctMonthly]  = useState<Record<string, Record<string, number>>>({})

  const [mode,       setMode]       = useState<ReportMode>('pl')
  const [periodMode, setPeriodMode] = useState<PeriodMode>('monthly')
  const [monthFrom,  setMonthFrom]  = useState('')   // YYYY-MM, empty = no limit
  const [monthTo,    setMonthTo]    = useState('')   // YYYY-MM, empty = no limit
  const [collapsed,  setCollapsed]  = useState<Set<string>>(new Set())

  const toggleCollapsed = (name: string) =>
    setCollapsed(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const catRes = await supabase
        .from('categories')
        .select('name, sort_order, pl_section, parent')
        .eq('client_id', CLIENT_ID)
        .order('sort_order')

      setAccounts(mergeAccounts(catRes.data ?? []))

      const { data: faData } = await supabase
        .from('financial_accounts')
        .select('*')
        .eq('client_id', CLIENT_ID)
        .order('created_at')
      setFinAccounts(faData ?? [])

      // Paginate transactions in batches of 1000 (Supabase default cap).
      // .order() makes the pages stable — unordered ranges can skip/duplicate rows.
      type TxnRow = { transaction_date: string; amount: string | number; account: string | null; source_account_id?: string | null; splits?: Array<{ account: string; amount: number }> | null }
      let allRows: TxnRow[] = []
      let offset = 0
      while (true) {
        const res = await supabase
          .from('bank_transactions')
          .select('transaction_date, amount, account, source_account_id, splits')
          .eq('client_id', CLIENT_ID)
          .order('id')
          .range(offset, offset + 999)
        const batch = (res.data ?? []) as TxnRow[]
        allRows = [...allRows, ...batch]
        if (batch.length < 1000) break
        offset += 1000
      }

      // Aggregate by month for finest granularity; roll up to year/all-time on demand
      const monthly: Record<string, Record<string, number>> = {}
      const acctMo: Record<string, Record<string, number>> = {}
      const monthSet = new Set<string>()
      for (const t of allRows) {
        if (!t.transaction_date) continue
        const mk = (t.transaction_date as string).slice(0, 7)
        const amt = parseFloat(String(t.amount)) || 0
        // Split transactions post each leg to its own account (the parent's account is null)
        const legs = t.splits?.length
          ? t.splits.filter(l => l.account).map(l => ({ account: l.account, amount: Number(l.amount) || 0 }))
          : (t.account ? [{ account: t.account, amount: amt }] : [])
        for (const leg of legs) {
          monthSet.add(mk)
          if (!monthly[leg.account]) monthly[leg.account] = {}
          monthly[leg.account][mk] = (monthly[leg.account][mk] ?? 0) + leg.amount
        }
        if (t.source_account_id) {
          monthSet.add(mk)
          if (!acctMo[t.source_account_id]) acctMo[t.source_account_id] = {}
          acctMo[t.source_account_id][mk] = (acctMo[t.source_account_id][mk] ?? 0) + amt
        }
      }
      setRawTotals(monthly)
      setAcctMonthly(acctMo)
      setAllMonths(Array.from(monthSet).sort())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const availableYears = useMemo(
    () => Array.from(new Set(allMonths.map(m => m.slice(0, 4)))).sort(),
    [allMonths],
  )

  // All months with data, optionally filtered by the custom range
  const activeMonths = useMemo(
    () => allMonths.filter(m => (!monthFrom || m >= monthFrom) && (!monthTo || m <= monthTo)),
    [allMonths, monthFrom, monthTo],
  )

  // Period keys used as column identifiers
  const basePeriods = useMemo((): string[] => {
    if (periodMode === 'latest')  return ['latest']
    if (periodMode === 'monthly') return activeMonths
    if (periodMode === 'yearly')  return availableYears
    return []
  }, [periodMode, activeMonths, availableYears])

  // P&L monthly adds a Total column when there are multiple periods; BS omits it (snapshots)
  const displayPeriods = useMemo(
    () => (periodMode === 'monthly' && mode === 'pl' && basePeriods.length > 1)
      ? [...basePeriods, 'total']
      : basePeriods,
    [basePeriods, periodMode, mode],
  )

  // Accounts grouped by pl_section, sorted by sort_order (already sorted from DB)
  const bySection = useMemo(() => {
    const map: Record<string, MergedAccount[]> = {}
    for (const a of accounts) {
      if (!map[a.pl_section]) map[a.pl_section] = []
      map[a.pl_section].push(a)
    }
    return map
  }, [accounts])

  // ─── Amount helpers ─────────────────────────────────────────────────────────

  // Raw sum of transactions for an account in the given period key (P&L activity)
  function getRaw(account: string, key: string): number {
    const m = rawTotals[account] ?? {}
    if (key === 'latest') return Object.values(m).reduce((s, v) => s + v, 0)
    if (key === 'total')  return activeMonths.reduce((s, mk) => s + (m[mk] ?? 0), 0)
    if (key.length === 4) return Object.entries(m).filter(([k]) => k.startsWith(key + '-')).reduce((s, [, v]) => s + v, 0)
    return m[key] ?? 0
  }

  // Cumulative raw sum through end of period (for Balance Sheet)
  function getCumul(account: string, key: string): number {
    const m = rawTotals[account] ?? {}
    return Object.entries(m).filter(([k]) => {
      if (key === 'latest' || key === 'total') return true
      if (key.length === 4) return k.slice(0, 4) <= key
      return k <= key
    }).reduce((s, [, v]) => s + v, 0)
  }

  function dispAmt(account: string, section: string, key: string): number {
    const raw = mode === 'bs' ? getCumul(account, key) : getRaw(account, key)
    return raw * (DISPLAY_SIGN[section] ?? 1)
  }

  // Recursive sum for an account: own amount plus all descendants — transactions can
  // be posted directly to a parent account, so its own activity always counts.
  // Also adds any financial accounts parented to this category.
  function accountTotal(name: string, section: string, key: string): number {
    const kids = (bySection[section] ?? []).filter(a => a.parent === name)
    const faKids = faChildrenOf(name)
    const faContrib = faKids.reduce((s, a) => s + acctDispAmt(a, key), 0)
    return dispAmt(name, section, key)
      + kids.reduce((s, c) => s + accountTotal(c.name, section, key), 0)
      + faContrib
  }

  // Sum of all top-level accounts in a section (parents display as sum of all descendants)
  function sectionTotal(section: string, key: string): number {
    return (bySection[section] ?? [])
      .filter(a => !a.parent)
      .reduce((s, a) => s + accountTotal(a.name, section, key), 0)
  }

  // ─── Financial account balance helpers ──────────────────────────────────────

  function getAcctCumul(acctId: string, key: string): number {
    const m = acctMonthly[acctId] ?? {}
    return Object.entries(m).filter(([k]) => {
      if (key === 'latest' || key === 'total') return true
      if (key.length === 4) return k.slice(0, 4) <= key
      return k <= key
    }).reduce((s, [, v]) => s + v, 0)
  }

  function acctDispAmt(acct: FinancialAccount, key: string): number {
    const raw = getAcctCumul(acct.id, key)
    return raw * (accountSection(acct.account_type) === 'asset' ? 1 : -1)
  }

  function acctGroupTotal(accts: FinancialAccount[], key: string): number {
    return accts.reduce((s, a) => s + acctDispAmt(a, key), 0)
  }

  function faChildrenOf(categoryName: string): FinancialAccount[] {
    return finAccounts.filter(a => a.parent_category === categoryName)
  }

  function financialAccountRow(a: FinancialAccount, depth: number): React.ReactNode {
    return (
      <tr key={`fa-${a.id}`} style={{ borderBottom: `1px solid ${D.border}` }}>
        <td style={{ ...stickyFirst(BG.card), padding: `6px ${hPad}px 6px ${hPad + depth * 18}px`, fontSize: 12.5, color: D.muted }}>
          {a.name}{a.last_four ? ` ••••${a.last_four}` : ''}
        </td>
        {displayPeriods.map(k => amtCell(acctDispAmt(a, k), false, false, k === 'total'))}
      </tr>
    )
  }

  // Only unassigned financial accounts go into the default standalone sections
  function financialAccountsSection(label: string, accts: FinancialAccount[]): React.ReactNode[] {
    const unassigned = accts.filter(a => !a.parent_category)
    if (unassigned.length === 0) return []
    const rows: React.ReactNode[] = [sectionHeaderRow(label)]
    for (const a of unassigned) rows.push(financialAccountRow(a, 0))
    rows.push(
      <tr key={`fat-${label}`} style={{ background: BG.sectionTotal, borderBottom: `2px solid ${D.border}` }}>
        <td style={{ ...stickyFirst(BG.sectionTotal), padding: `6px ${hPad}px`, fontWeight: 700, fontSize: 12.5, color: D.charcoal }}>
          Total {label}
        </td>
        {displayPeriods.map(k => amtCell(acctGroupTotal(unassigned, k), true, false, k === 'total'))}
      </tr>
    )
    return rows
  }

  // ─── P&L summary values ──────────────────────────────────────────────────────

  function plSummary(key: string) {
    const rev    = sectionTotal('Revenue', key)
    const ded    = sectionTotal('Deductions to Income', key)
    const net    = rev - ded
    const cogs   = sectionTotal('Cost of Goods Sold', key)
    const gross  = net - cogs
    const opex   = sectionTotal('Operating Expenses', key)
    const opInc  = gross - opex
    const noInc  = sectionTotal('Non-Operating Income', key)
    const noExp  = sectionTotal('Non-Operating Expenses', key)
    const netInc = opInc + noInc - noExp
    return { rev, ded, net, cogs, gross, opex, opInc, noInc, noExp, netInc }
  }

  function bsSummary(key: string) {
    // Assigned FAs are already included in sectionTotal via accountTotal.
    // Only unassigned FAs need to be added separately.
    const unassignedAssets  = finAccounts.filter(a => accountSection(a.account_type) === 'asset'      && !a.parent_category)
    const unassignedLiabs   = finAccounts.filter(a => accountSection(a.account_type) === 'liability'  && !a.parent_category)
    const ca  = sectionTotal('Current Assets', key)
    const nca = sectionTotal('Non-Current Assets', key)
    const ta  = ca + nca + acctGroupTotal(unassignedAssets, key)
    const cl  = sectionTotal('Current Liabilities', key)
    const ncl = sectionTotal('Non-Current Liabilities', key)
    const tl  = cl + ncl + acctGroupTotal(unassignedLiabs, key)
    const eq  = sectionTotal('Equity', key)
    return { ca, nca, ta, cl, ncl, tl, eq, tle: tl + eq }
  }

  // ─── Period label ────────────────────────────────────────────────────────────

  function periodLabel(key: string): string {
    if (key === 'latest') return 'All Time'
    if (key === 'total')  return 'Total'
    if (key.length === 7) {
      const [yr, mo] = key.split('-')
      return `${MONTHS[parseInt(mo) - 1]} '${yr.slice(2)}`
    }
    return key
  }

  // ─── Row builders ────────────────────────────────────────────────────────────

  const N      = displayPeriods.length
  const colW   = periodMode === 'yearly'
    ? (N <= 3 ? 80 : N <= 8 ? 70 : 60)
    : (N <= 3 ? 110 : N <= 8 ? 85 : N <= 14 ? 70 : 58)
  const hPad   = N <= 3 ? 12  : N <= 8 ? 9  : N <= 14 ? 7  : 6    // px, horizontal cell padding
  const accW   = 200                                                  // px, account column min-width

  function amtCell(value: number, bold = false, colored = false, total = false): React.ReactNode {
    return (
      <td style={{
        padding: `6px ${hPad}px`, textAlign: 'right', whiteSpace: 'nowrap',
        fontWeight: bold ? 700 : 400,
        color: colored ? (value < 0 ? D.red : value > 0 ? D.green : D.muted) : (value ? D.charcoal : D.muted),
        borderLeft: total ? `2px solid ${D.gold}40` : undefined,
      }}>
        {value ? fmtAmt(value) : '—'}
      </td>
    )
  }

  // ─── Opaque background constants (rgba won't work on sticky cells — content bleeds through) ──
  const BG = {
    card:         D.card,      // #FAFAF8
    sectionTotal: '#F0F2F0',   // rgba(44,95,82,0.05) composited on card
    summary:      '#E7ECE9',   // rgba(44,95,82,0.09) composited on card
    groupHeader:  '#EEF1EE',   // rgba(44,95,82,0.06) composited on card
  }

  // ─── Sticky cell helper ─────────────────────────────────────────────────────
  const stickyFirst = (bg: string): React.CSSProperties => ({
    position: 'sticky', left: 0, zIndex: 1, background: bg,
  })

  // ─── Zero-filter helper ─────────────────────────────────────────────────────
  // Check against basePeriods (excludes 'total' column) so derived totals don't influence visibility
  function hasActivity(account: string, section: string): boolean {
    return basePeriods.some(k => dispAmt(account, section, k) !== 0)
  }

  // Section header row: first cell is sticky so the label stays visible on horizontal scroll
  function sectionHeaderRow(label: string): React.ReactNode {
    return (
      <tr key={`sh-${label}`}>
        <td style={{
          ...stickyFirst(D.sage),
          padding: `6px ${hPad}px`, fontSize: 9.5, fontWeight: 800,
          color: 'rgba(255,255,255,0.85)',
          textTransform: 'uppercase', letterSpacing: '1.2px',
        }}>{label}</td>
        {displayPeriods.map(k => <td key={k} style={{ background: D.sage }} />)}
      </tr>
    )
  }

  function accountRow(
    a: MergedAccount, section: string, depth: number, isParent: boolean,
    isCollapsed?: boolean, onToggle?: () => void,
  ): React.ReactNode {
    return (
      <tr
        key={`acc-${a.name}`}
        style={{ borderBottom: `1px solid ${D.border}`, cursor: onToggle ? 'pointer' : undefined }}
        onClick={onToggle}
      >
        <td style={{
          ...stickyFirst(BG.card),
          padding: `6px ${hPad}px 6px ${hPad + depth * 18}px`,
          fontSize: 12.5,
          fontWeight: isParent ? 600 : 400,
          color: isParent ? D.charcoal : D.muted,
          userSelect: 'none',
        }}>
          {onToggle && (
            <span style={{ display: 'inline-block', width: 12, fontSize: 8, color: D.muted, marginRight: 5, verticalAlign: 'middle' }}>
              {isCollapsed ? '▶' : '▼'}
            </span>
          )}
          {a.name}
        </td>
        {displayPeriods.map(k => {
          const v = isParent ? accountTotal(a.name, section, k) : dispAmt(a.name, section, k)
          return amtCell(v, isParent, false, k === 'total')
        })}
      </tr>
    )
  }

  function sectionTotalRow(section: string): React.ReactNode {
    return (
      <tr key={`st-${section}`} style={{ background: BG.sectionTotal, borderBottom: `2px solid ${D.border}` }}>
        <td style={{ ...stickyFirst(BG.sectionTotal), padding: `6px ${hPad}px`, fontWeight: 700, fontSize: 12.5, color: D.charcoal }}>
          Total {section}
        </td>
        {displayPeriods.map(k => amtCell(sectionTotal(section, k), true, false, k === 'total'))}
      </tr>
    )
  }

  function summaryRow(label: string, values: number[], highlight = false): React.ReactNode {
    const bg = highlight ? D.sage : BG.summary
    return (
      <tr key={`sum-${label}`} style={{ background: bg }}>
        <td style={{ ...stickyFirst(bg), padding: `7px ${hPad}px`, fontWeight: 700, fontSize: 13, color: highlight ? '#fff' : D.charcoal }}>
          {label}
        </td>
        {values.map((v, i) => {
          const isTotal = displayPeriods[i] === 'total'
          return (
            <td key={i} style={{
              padding: `7px ${hPad}px`, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap',
              color: highlight ? (v < 0 ? '#ffaaaa' : '#fff') : (v < 0 ? D.red : D.charcoal),
              borderLeft: isTotal ? `2px solid ${D.gold}40` : undefined,
            }}>
              {fmtAmt(v)}
            </td>
          )
        })}
      </tr>
    )
  }

  function spacerRow(key: string): React.ReactNode {
    return <tr key={`sp-${key}`}><td colSpan={N + 1} style={{ height: 8 }} /></tr>
  }

  // Group header (Assets / Liabilities dividers in BS): first cell sticky
  function groupHeaderRow(label: string): React.ReactNode {
    return (
      <tr key={`grp-${label}`}>
        <td style={{
          ...stickyFirst(BG.groupHeader),
          padding: `5px ${hPad}px`, fontSize: 9.5, fontWeight: 800,
          color: D.sage, textTransform: 'uppercase', letterSpacing: '1.5px',
          borderBottom: `1px solid ${D.border}`,
        }}>{label}</td>
        {displayPeriods.map(k => <td key={k} style={{ background: BG.groupHeader, borderBottom: `1px solid ${D.border}` }} />)}
      </tr>
    )
  }

  // True if account or any of its descendants have activity in any displayed period
  function hasAnyActivity(name: string, section: string): boolean {
    if (hasActivity(name, section)) return true
    const kids = (bySection[section] ?? []).filter(a => a.parent === name)
    return kids.some(c => hasAnyActivity(c.name, section))
  }

  // Render all account rows for a section — handles up to 3 levels via recursion
  function sectionRows(section: string): React.ReactNode[] {
    const accts = bySection[section] ?? []
    const rows: React.ReactNode[] = [sectionHeaderRow(section)]

    function renderAccount(a: MergedAccount, depth: number): void {
      const kids = accts.filter(c => c.parent === a.name)
      const faKids = faChildrenOf(a.name)
      const hasKids = kids.length > 0 || faKids.length > 0

      if (hasKids) {
        const activeKids = kids.filter(c => hasAnyActivity(c.name, section))
        if (activeKids.length === 0 && faKids.length === 0 && !hasActivity(a.name, section)) return
        const isCollapsed = collapsed.has(a.name)
        rows.push(accountRow(a, section, depth, true, isCollapsed, () => toggleCollapsed(a.name)))
        if (!isCollapsed) {
          activeKids.forEach(c => renderAccount(c, depth + 1))
          faKids.forEach(fa => rows.push(financialAccountRow(fa, depth + 1)))
        }
      } else {
        if (!hasActivity(a.name, section)) return
        rows.push(accountRow(a, section, depth, false))
      }
    }

    accts.filter(a => !a.parent).forEach(a => renderAccount(a, 0))
    rows.push(sectionTotalRow(section))
    return rows
  }

  // ─── P&L body ────────────────────────────────────────────────────────────────

  function plRows(): React.ReactNode[] {
    const s = displayPeriods.map(k => plSummary(k))
    return [
      ...sectionRows('Revenue'),
      ...sectionRows('Deductions to Income'),
      summaryRow('Net Revenue', s.map(x => x.net)),
      spacerRow('s1'),
      ...sectionRows('Cost of Goods Sold'),
      summaryRow('Gross Profit', s.map(x => x.gross)),
      spacerRow('s2'),
      ...sectionRows('Operating Expenses'),
      summaryRow('Operating Income', s.map(x => x.opInc)),
      spacerRow('s3'),
      ...sectionRows('Non-Operating Income'),
      ...sectionRows('Non-Operating Expenses'),
      spacerRow('s4'),
      summaryRow('Net Income', s.map(x => x.netInc), true),
    ]
  }

  // ─── Balance Sheet body ──────────────────────────────────────────────────────

  function bsRows(): React.ReactNode[] {
    const assetAccts     = finAccounts.filter(a => accountSection(a.account_type) === 'asset')
    const liabilityAccts = finAccounts.filter(a => accountSection(a.account_type) === 'liability')
    const s = displayPeriods.map(k => bsSummary(k))
    return [
      groupHeaderRow('Assets'),
      ...financialAccountsSection('Bank Accounts', assetAccts),
      ...sectionRows('Current Assets'),
      ...sectionRows('Non-Current Assets'),
      summaryRow('Total Assets', s.map(x => x.ta)),
      spacerRow('s1'),
      groupHeaderRow('Liabilities'),
      ...financialAccountsSection('Credit & Lines of Credit', liabilityAccts),
      ...sectionRows('Current Liabilities'),
      ...sectionRows('Non-Current Liabilities'),
      summaryRow('Total Liabilities', s.map(x => x.tl)),
      spacerRow('s2'),
      ...sectionRows('Equity'),
      spacerRow('s3'),
      summaryRow('Total Liabilities + Equity', s.map(x => x.tle), true),
    ]
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ padding: 40, color: D.muted, fontSize: 14 }}>Loading financial data…</div>
  )

  return (
    <div style={{ padding: '24px 32px', background: D.page, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: D.charcoal }}>Financial Reports</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: D.muted }}>
          Profit &amp; Loss and Balance Sheet from chart of accounts
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <ToggleGroup
          options={[['pl', 'Profit & Loss'], ['bs', 'Balance Sheet']]}
          value={mode}
          onChange={v => setMode(v as ReportMode)}
        />
        <ToggleGroup
          options={[['latest', 'All Time'], ['monthly', 'Monthly'], ['yearly', 'Yearly']]}
          value={periodMode}
          onChange={v => setPeriodMode(v as PeriodMode)}
        />
        {periodMode === 'monthly' && (
          <>
            <input
              type="month"
              value={monthFrom}
              onChange={e => setMonthFrom(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 12.5, border: `1px solid ${D.border}`, borderRadius: 6, background: D.card, color: D.charcoal }}
              title="From month"
            />
            <span style={{ fontSize: 12, color: D.muted }}>→</span>
            <input
              type="month"
              value={monthTo}
              onChange={e => setMonthTo(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 12.5, border: `1px solid ${D.border}`, borderRadius: 6, background: D.card, color: D.charcoal }}
              title="To month"
            />
            {(monthFrom || monthTo) && (
              <button
                onClick={() => { setMonthFrom(''); setMonthTo('') }}
                style={{ padding: '6px 10px', fontSize: 12, border: `1px solid ${D.border}`, borderRadius: 6, background: 'transparent', color: D.charcoal, cursor: 'pointer' }}
              >
                Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* Report table — overflowX:auto is the scroll container for sticky left column */}
      <div style={{
        background: D.card, border: `1px solid ${D.border}`,
        borderRadius: 10, overflowX: 'auto',
      }}>
        {displayPeriods.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: D.muted, fontSize: 13 }}>
            No transaction data found for this period.
          </div>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#F0EBE0', borderBottom: `2px solid ${D.border}` }}>
                <th style={{
                  padding: `10px ${hPad}px`, textAlign: 'left', fontSize: 10.5, fontWeight: 700,
                  color: D.muted, minWidth: accW,
                  position: 'sticky', left: 0, zIndex: 2, background: '#F0EBE0',
                }}>
                  Account
                </th>
                {displayPeriods.map(k => (
                  <th key={k} style={{
                    padding: `10px ${hPad}px`, textAlign: 'right', fontSize: 10.5, fontWeight: 700,
                    color: k === 'total' ? D.gold : D.muted,
                    minWidth: colW,
                    borderLeft: k === 'total' ? `2px solid ${D.gold}40` : undefined,
                    whiteSpace: 'nowrap',
                  }}>
                    {periodLabel(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mode === 'pl' ? plRows() : bsRows()}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 12, fontSize: 11, color: D.muted }}>
        {mode === 'pl'
          ? 'Amounts shown as activity for the period. Expenses displayed as positive costs.'
          : 'Balances shown as cumulative totals through end of period.'}
      </p>
    </div>
  )
}

// ─── Shared toggle group ─────────────────────────────────────────────────────

function ToggleGroup({ options, value, onChange }: {
  options: [string, string][]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{
      display: 'flex', background: '#FAFAF8',
      border: '1px solid #D9D4C8', borderRadius: 6, overflow: 'hidden',
    }}>
      {options.map(([k, label], i) => (
        <button key={k} onClick={() => onChange(k)} style={{
          padding: '7px 14px', fontSize: 12.5,
          fontWeight: value === k ? 600 : 400,
          background: value === k ? '#2C5F52' : 'transparent',
          color: value === k ? '#fff' : '#4A4A3F',
          border: 'none', cursor: 'pointer',
          borderRight: i < options.length - 1 ? '1px solid #D9D4C8' : 'none',
          transition: 'background .15s, color .15s',
        }}>{label}</button>
      ))}
    </div>
  )
}
