'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  type Loan,
  type LoanPayment,
  type LoanDisbursement,
  type AmortizationRow,
  INSTRUMENT_LABELS,
  usesFactorRate,
  usesFlatFee,
  hasFixedSchedule,
  costLabel,
  isInformalDebt,
  generateAmortizationSchedule,
  calcOutstandingBalance,
  calcTotalDrawn,
  calcRemainingToDisburse,
  suggestPaymentSplit,
} from '@/lib/loans'

const D = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  card: '#FAFAF8',
  border: '#D9D4C8',
  steel: '#4A7B6A',
  red: '#B94040',
  green: '#2E7D52',
  muted: 'rgba(74,74,63,0.55)',
}

// Inline transaction cell for a schedule row — shows linked txn info + reassign button
function SchedTxnCell({
  txn,
  pay,
  onEdit,
  label,
}: {
  txn: BankTxn | null | undefined
  pay: LoanPayment | null | undefined
  onEdit: () => void
  label?: string
}) {
  if (!pay)
    return <span style={{ color: 'rgba(74,74,63,0.55)', fontSize: 11, fontStyle: 'italic' }}>{label ?? '—'}</span>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {txn ? (
          <>
            <div
              style={{
                color: '#4A4A3F',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {txn.description}
            </div>
            <div style={{ color: 'rgba(74,74,63,0.55)', fontSize: 10.5 }}>
              {txn.transaction_date} ·{' '}
              {'$' +
                Math.abs(Number(txn.amount)).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
            </div>
          </>
        ) : (
          <span style={{ color: 'rgba(74,74,63,0.55)', fontSize: 11, fontStyle: 'italic' }}>
            {label ?? 'No transaction linked'}
          </span>
        )}
      </div>
      <button
        onClick={onEdit}
        title="Reassign bank transaction"
        style={{
          flexShrink: 0,
          background: 'none',
          border: '1px solid #D9D4C8',
          borderRadius: 3,
          cursor: 'pointer',
          color: 'rgba(74,74,63,0.55)',
          fontSize: 10,
          padding: '1px 5px',
          lineHeight: 1.5,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = '#C8A96E'
          e.currentTarget.style.borderColor = '#C8A96E'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = 'rgba(74,74,63,0.55)'
          e.currentTarget.style.borderColor = '#D9D4C8'
        }}
      >
        ↔
      </button>
    </div>
  )
}

function Pager({
  page,
  total,
  perPage,
  onChange,
}: {
  page: number
  total: number
  perPage: number
  onChange: (p: number) => void
}) {
  const pages = Math.ceil(total / perPage)
  if (pages <= 1) return null
  return (
    <div
      className="no-print"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        padding: '8px 12px',
        borderTop: `1px solid ${D.border}`,
        fontSize: 11.5,
        color: D.muted,
      }}
    >
      <span>
        {page * perPage + 1}–{Math.min((page + 1) * perPage, total)} of {total}
      </span>
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 0}
        style={{
          background: 'none',
          border: `1px solid ${D.border}`,
          borderRadius: 3,
          padding: '2px 8px',
          cursor: page === 0 ? 'default' : 'pointer',
          opacity: page === 0 ? 0.4 : 1,
          fontSize: 12,
        }}
      >
        ◀
      </button>
      <button
        onClick={() => onChange(Math.min(page + 1, pages - 1))}
        disabled={page >= pages - 1}
        style={{
          background: 'none',
          border: `1px solid ${D.border}`,
          borderRadius: 3,
          padding: '2px 8px',
          cursor: page >= pages - 1 ? 'default' : 'pointer',
          opacity: page >= pages - 1 ? 0.4 : 1,
          fontSize: 12,
        }}
      >
        ▶
      </button>
    </div>
  )
}

const fmt = (n: number) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string) =>
  new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// Returns the amount that applies to a specific account — uses the split leg when the transaction is split
function effectiveAmt(t: BankTxn, accountName: string | null): number {
  if (!accountName || !t.splits?.length) return Number(t.amount)
  return t.splits.find(s => s.account === accountName)?.amount ?? Number(t.amount)
}

const inp: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: `1px solid ${D.border}`,
  borderRadius: 5,
  fontSize: 12.5,
  background: '#fff',
  color: D.charcoal,
  outline: 'none',
}
const lbl: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: D.charcoal,
  marginBottom: 3,
  display: 'block',
}

interface BankTxn {
  id: string
  transaction_date: string
  description: string
  amount: number
  account?: string | null
  splits?: Array<{ account: string; amount: number }> | null
}

interface PayForm {
  payment_date: string
  total_amount: string
  principal_amount: string
  interest_amount: string
  fees_amount: string
  notes: string
  transaction_id: string
  txSearch: string
}

const BLANK_PAY: PayForm = {
  payment_date: '',
  total_amount: '',
  principal_amount: '',
  interest_amount: '',
  fees_amount: '0',
  notes: '',
  transaction_id: '',
  txSearch: '',
}

interface DisbForm {
  disbursement_date: string
  amount: string
  notes: string
  transaction_id: string
  txSearch: string
}

const BLANK_DISB: DisbForm = {
  disbursement_date: '',
  amount: '',
  notes: '',
  transaction_id: '',
  txSearch: '',
}

export default function LoanDetail({ clientId, loanId }: { clientId: string; loanId: string }) {
  const [loan, setLoan] = useState<Loan | null>(null)
  const [payments, setPayments] = useState<LoanPayment[]>([])
  const [disbursements, setDisbursements] = useState<LoanDisbursement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showFullSchedule, setShowFullSchedule] = useState(false)
  const [payModal, setPayModal] = useState(false)
  const [editPayment, setEditPayment] = useState<LoanPayment | null>(null)
  const [payForm, setPayForm] = useState<PayForm>({ ...BLANK_PAY })
  const [payErr, setPayErr] = useState('')
  const [disbModal, setDisbModal] = useState(false)
  const [editDisb, setEditDisb] = useState<LoanDisbursement | null>(null)
  const [disbForm, setDisbForm] = useState<DisbForm>({ ...BLANK_DISB })
  const [disbErr, setDisbErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [bankTxns, setBankTxns] = useState<BankTxn[]>([])
  const [linkedAccount, setLinkedAccount] = useState<string | null>(null)
  const [linkedTxns, setLinkedTxns] = useState<BankTxn[]>([])
  const [paymentTxns, setPaymentTxns] = useState<Record<string, BankTxn>>({})
  const [payPage, setPayPage] = useState(0)
  const [linkedPage, setLinkedPage] = useState(0)
  const [schedPage, setSchedPage] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: loanRows } = await supabase.from('loans').select('*').eq('id', loanId).eq('client_id', clientId)
    if (!loanRows || loanRows.length === 0) {
      setError('Loan not found')
      setLoading(false)
      return
    }
    setLoan(loanRows[0])

    // A failed fetch must not render as "no payments" — the import buttons use
    // these lists to decide what's already recorded, so an empty-on-error list
    // would let a re-import duplicate every payment. Balance math needs every
    // row, so cap explicitly (PostgREST truncates at 1000 by default).
    const { data: payRows, error: payFetchErr } = await supabase
      .from('loan_payments')
      .select('*')
      .eq('loan_id', loanId)
      .eq('client_id', clientId)
      .order('payment_date')
      .limit(10000)
    if (payFetchErr) {
      setError(`Failed to load payments: ${payFetchErr.message}`)
      setLoading(false)
      return
    }
    setPayments(payRows ?? [])

    const { data: disbRows, error: disbFetchErr } = await supabase
      .from('loan_disbursements')
      .select('*')
      .eq('loan_id', loanId)
      .eq('client_id', clientId)
      .order('disbursement_date')
      .limit(10000)
    if (disbFetchErr) {
      setError(`Failed to load disbursements: ${disbFetchErr.message}`)
      setLoading(false)
      return
    }
    setDisbursements(disbRows ?? [])

    // Load bank transactions linked to recorded payments and disbursements
    const payTxnIds = (payRows ?? []).map((p: LoanPayment) => p.transaction_id).filter(Boolean) as string[]
    const disbTxnIds = (disbRows ?? []).map((d: LoanDisbursement) => d.transaction_id).filter(Boolean) as string[]
    const allLinkedIds = [...new Set([...payTxnIds, ...disbTxnIds])]
    if (allLinkedIds.length) {
      const { data: ptRows } = await supabase
        .from('bank_transactions')
        .select('id, transaction_date, description, amount')
        .in('id', allLinkedIds)
      const map: Record<string, BankTxn> = {}
      ;(ptRows ?? []).forEach((t: BankTxn) => {
        map[t.id] = t
      })
      setPaymentTxns(map)
    } else {
      setPaymentTxns({})
    }

    // Load linked liability account and its transactions
    const { data: linkedCat } = await supabase
      .from('categories')
      .select('name')
      .eq('loan_id', loanId)
      .eq('client_id', clientId)
      .maybeSingle()
    const accountName = linkedCat?.name ?? null
    setLinkedAccount(accountName)
    if (accountName) {
      const sel = 'id, transaction_date, description, amount, account, splits'
      const [{ data: directRows }, { data: splitRows }] = await Promise.all([
        supabase
          .from('bank_transactions')
          .select(sel)
          .eq('client_id', clientId)
          .eq('account', accountName)
          .order('transaction_date'),
        supabase
          .from('bank_transactions')
          .select(sel)
          .eq('client_id', clientId)
          .filter('splits', 'cs', JSON.stringify([{ account: accountName }]))
          .order('transaction_date'),
      ])
      const seen = new Set<string>()
      const combined = [...(directRows ?? []), ...(splitRows ?? [])]
        .filter(t => {
          if (seen.has(t.id)) return false
          seen.add(t.id)
          return true
        })
        .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
      setLinkedTxns(combined)
    } else {
      setLinkedTxns([])
    }

    setLoading(false)
  }, [loanId, clientId])

  useEffect(() => {
    load()
  }, [load])
  // biome-ignore lint/correctness/useExhaustiveDependencies: payments is the reset trigger — jump back to page 1 when the list changes
  useEffect(() => {
    setPayPage(0)
  }, [payments])
  // biome-ignore lint/correctness/useExhaustiveDependencies: linkedTxns is the reset trigger — jump back to page 1 when the list changes
  useEffect(() => {
    setLinkedPage(0)
  }, [linkedTxns])

  const schedule = useMemo(() => (loan ? generateAmortizationSchedule(loan, disbursements) : []), [loan, disbursements])

  // Date-based payment matching: a payment covers the period whose accrualEnd it falls within
  // (plus a GRACE_DAYS window). This correctly handles the convention where a payment that
  // arrives on 6/2 applies to the 5/1–5/31 period, not the 6/1–6/30 period.
  const GRACE_DAYS = 15
  const schedulePaymentMap = useMemo(() => {
    const map = new Map<number, LoanPayment>() // period → payment
    const usedIds = new Set<string>()
    for (const row of schedule) {
      const d = new Date(row.accrualEnd + 'T12:00:00')
      d.setDate(d.getDate() + GRACE_DAYS)
      const windowEnd = d.toISOString().slice(0, 10)
      const match = payments.find(
        p => !usedIds.has(p.id) && p.payment_date >= row.accrualStart && p.payment_date <= windowEnd,
      )
      if (match) {
        map.set(row.period, match)
        usedIds.add(match.id)
      }
    }
    return map
  }, [schedule, payments])

  const outstanding = useMemo(() => {
    if (!loan) return 0
    if (isInformalDebt(loan.instrument_type) && linkedTxns.length > 0) {
      const repaid = linkedTxns
        .filter(t => effectiveAmt(t, linkedAccount) < 0)
        .reduce((s, t) => s + Math.abs(effectiveAmt(t, linkedAccount)), 0)
      return Math.max(0, loan.original_principal - repaid)
    }
    return calcOutstandingBalance(loan, payments, disbursements)
  }, [loan, payments, linkedTxns, disbursements, linkedAccount])

  const totalPrincipalPaid = payments.reduce((s, p) => s + p.principal_amount, 0)
  const totalInterestPaid = payments.reduce((s, p) => s + p.interest_amount, 0)
  const totalFeesPaid = payments.reduce((s, p) => s + p.fees_amount, 0)
  const isPaidOff = outstanding <= 0.01

  // Index into schedule[] of the first period that has no matched payment (= next to pay)
  const currentPeriodIdx = useMemo(() => {
    for (let i = 0; i < schedule.length; i++) {
      if (!schedulePaymentMap.has(schedule[i].period)) return i
    }
    return schedule.length
  }, [schedule, schedulePaymentMap])

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-page when the schedule size or view mode changes
  useEffect(() => {
    if (!showFullSchedule) setSchedPage(Math.floor(currentPeriodIdx / 12))
  }, [schedule.length, showFullSchedule])

  // Amortization rows to display
  const visibleSchedule = useMemo(() => {
    if (showFullSchedule) return schedule
    return schedule.slice(schedPage * 12, (schedPage + 1) * 12)
  }, [schedule, showFullSchedule, schedPage])

  // Next payment from schedule
  const nextScheduledRow: AmortizationRow | undefined = schedule[currentPeriodIdx]

  async function loadBankTxns(date: string) {
    const d = new Date(date + 'T12:00:00')
    const from = new Date(d)
    from.setDate(from.getDate() - 14)
    const to = new Date(d)
    to.setDate(to.getDate() + 14)
    const { data } = await supabase
      .from('bank_transactions')
      .select('id, transaction_date, description, amount')
      .eq('client_id', clientId)
      .gte('transaction_date', from.toISOString().slice(0, 10))
      .lte('transaction_date', to.toISOString().slice(0, 10))
      .order('transaction_date')
    setBankTxns(data ?? [])
  }

  function openRecordPayment() {
    const date = nextScheduledRow?.date ?? new Date().toISOString().slice(0, 10)
    const amount = loan?.payment_amount ?? 0
    if (!loan) return
    const split = suggestPaymentSplit(loan, payments, amount, disbursements)
    setPayForm({
      ...BLANK_PAY,
      payment_date: date,
      total_amount: String(amount),
      principal_amount: String(split.principal),
      interest_amount: String(split.interest),
      fees_amount: String(split.fees),
    })
    loadBankTxns(date)
    setEditPayment(null)
    setPayErr('')
    setPayModal(true)
  }

  function openEditPayment(p: LoanPayment) {
    setPayForm({
      payment_date: p.payment_date,
      total_amount: String(p.total_amount),
      principal_amount: String(p.principal_amount),
      interest_amount: String(p.interest_amount),
      fees_amount: String(p.fees_amount),
      notes: p.notes ?? '',
      transaction_id: p.transaction_id ?? '',
      txSearch: '',
    })
    loadBankTxns(p.payment_date)
    setEditPayment(p)
    setPayErr('')
    setPayModal(true)
  }

  function recalcSplit(totalStr: string) {
    if (!loan) return
    const amount = parseFloat(totalStr)
    if (Number.isNaN(amount)) return
    const split = suggestPaymentSplit(loan, payments, amount, disbursements)
    setPayForm(f => ({
      ...f,
      total_amount: totalStr,
      principal_amount: String(split.principal),
      interest_amount: String(split.interest),
      fees_amount: String(split.fees),
    }))
  }

  async function savePayment() {
    const total = parseFloat(payForm.total_amount)
    const principal = parseFloat(payForm.principal_amount)
    const interest = parseFloat(payForm.interest_amount)
    const fees = parseFloat(payForm.fees_amount || '0')
    if (!payForm.payment_date) {
      setPayErr('Date is required')
      return
    }
    if (Number.isNaN(total) || total <= 0) {
      setPayErr('Amount must be > 0')
      return
    }
    if (Number.isNaN(principal) || Number.isNaN(interest)) {
      setPayErr('Enter principal and interest amounts')
      return
    }

    setSaving(true)
    const row = {
      client_id: clientId,
      loan_id: loanId,
      payment_date: payForm.payment_date,
      total_amount: total,
      principal_amount: principal,
      interest_amount: interest,
      fees_amount: fees,
      notes: payForm.notes.trim() || undefined,
      transaction_id: payForm.transaction_id || undefined,
    }

    const { error: payWriteErr } = editPayment
      ? await supabase
          .from('loan_payments')
          .update(row as Record<string, unknown>)
          .eq('id', editPayment.id)
      : await supabase.from('loan_payments').insert(row as Record<string, unknown>)
    setSaving(false)
    if (payWriteErr) {
      // Money write — keep the modal open instead of pretending it saved
      setPayErr(payWriteErr.message)
      return
    }
    setPayModal(false)
    load()
  }

  async function deletePayment(id: string) {
    if (!confirm('Delete this payment record?')) return
    const { error } = await supabase.from('loan_payments').delete().eq('id', id)
    if (error) {
      alert(`Delete failed: ${error.message}`)
      return
    }
    load()
  }

  function openRecordDisbursement() {
    setDisbForm({ ...BLANK_DISB, disbursement_date: new Date().toISOString().slice(0, 10) })
    setEditDisb(null)
    setDisbErr('')
    setDisbModal(true)
  }

  function openEditDisbursement(d: LoanDisbursement) {
    setDisbForm({
      disbursement_date: d.disbursement_date,
      amount: String(d.amount),
      notes: d.notes ?? '',
      transaction_id: d.transaction_id ?? '',
      txSearch: '',
    })
    loadBankTxns(d.disbursement_date)
    setEditDisb(d)
    setDisbErr('')
    setDisbModal(true)
  }

  async function saveDisbursement() {
    const amount = parseFloat(disbForm.amount)
    if (!disbForm.disbursement_date) {
      setDisbErr('Date is required')
      return
    }
    if (Number.isNaN(amount) || amount <= 0) {
      setDisbErr('Amount must be > 0')
      return
    }
    setSaving(true)
    const row = {
      client_id: clientId,
      loan_id: loanId,
      disbursement_date: disbForm.disbursement_date,
      amount,
      notes: disbForm.notes.trim() || undefined,
      transaction_id: disbForm.transaction_id || undefined,
    }
    const { error: disbWriteErr } = editDisb
      ? await supabase
          .from('loan_disbursements')
          .update(row as Record<string, unknown>)
          .eq('id', editDisb.id)
      : await supabase.from('loan_disbursements').insert(row as Record<string, unknown>)
    setSaving(false)
    if (disbWriteErr) {
      setDisbErr(disbWriteErr.message)
      return
    }
    setDisbModal(false)
    load()
  }

  async function deleteDisbursement(id: string) {
    if (!confirm('Delete this disbursement record?')) return
    const { error } = await supabase.from('loan_disbursements').delete().eq('id', id)
    if (error) {
      alert(`Delete failed: ${error.message}`)
      return
    }
    load()
  }

  async function importDisbursementsFromLinkedTxns() {
    if (!loan) return
    const draws = linkedTxns
      .filter(t => Number(t.amount) > 0)
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
    if (!draws.length) {
      alert('No disbursement transactions found on the linked liability account.')
      return
    }

    const alreadyLinked = new Set(disbursements.map(d => d.transaction_id).filter(Boolean))
    const toImport = draws.filter(t => !alreadyLinked.has(t.id))
    if (!toImport.length) {
      alert('All linked transactions are already recorded as draws.')
      return
    }

    if (!confirm(`Import ${toImport.length} draw${toImport.length !== 1 ? 's' : ''} from linked bank transactions?`))
      return

    setSaving(true)
    try {
      // supabase-js returns { error } rather than throwing — collect failures
      // explicitly or a mid-loop failure reads as a successful import
      const failures: string[] = []
      for (const t of toImport) {
        const { error } = await supabase.from('loan_disbursements').insert({
          client_id: clientId,
          loan_id: loanId,
          transaction_id: t.id,
          disbursement_date: t.transaction_date,
          amount: Math.abs(Number(t.amount)),
        })
        if (error) failures.push(`${t.transaction_date}: ${error.message}`)
      }
      if (failures.length) alert(`${failures.length} draw(s) failed to import:\n${failures.join('\n')}`)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function importFromLinkedTxns() {
    if (!loan) return
    const repayments = linkedTxns
      .filter(t => Number(t.amount) < 0)
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
    if (!repayments.length) {
      alert('No repayment transactions found on the linked liability account.')
      return
    }

    const alreadyLinked = new Set(payments.map(p => p.transaction_id).filter(Boolean))
    const toImport = repayments.filter(t => !alreadyLinked.has(t.id))
    if (!toImport.length) {
      alert('All linked transactions are already recorded as payments.')
      return
    }

    if (!confirm(`Import ${toImport.length} payment${toImport.length !== 1 ? 's' : ''} from linked bank transactions?`))
      return

    setSaving(true)
    try {
      // supabase-js returns { error } rather than throwing — collect failures
      // explicitly or a mid-loop failure reads as a successful import
      const failures: string[] = []
      const useSchedule = hasFixedSchedule(loan.instrument_type ?? 'term_loan')
      let nextPeriod = currentPeriodIdx // first unmatched schedule row

      for (const t of toImport) {
        const total = Math.abs(Number(t.amount))
        let principal = total,
          interest = 0

        if (useSchedule && schedule[nextPeriod]) {
          const row = schedule[nextPeriod]
          // Keep schedule's ratio but scale to actual amount paid
          const scaledInterest = row.payment > 0 ? (row.interest / row.payment) * total : row.interest
          interest = Math.round(Math.min(scaledInterest, total) * 100) / 100
          principal = Math.round((total - interest) * 100) / 100
          nextPeriod++
        }

        const { error } = await supabase.from('loan_payments').insert({
          client_id: clientId,
          loan_id: loanId,
          transaction_id: t.id,
          payment_date: t.transaction_date,
          total_amount: total,
          principal_amount: principal,
          interest_amount: interest,
          fees_amount: 0,
        })
        if (error) failures.push(`${t.transaction_date}: ${error.message}`)
      }
      if (failures.length) alert(`${failures.length} payment(s) failed to import:\n${failures.join('\n')}`)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const filteredTxns = useMemo(() => {
    if (!payForm.txSearch.trim()) return bankTxns
    const q = payForm.txSearch.toLowerCase()
    return bankTxns.filter(t => t.description.toLowerCase().includes(q) || String(Math.abs(t.amount)).includes(q))
  }, [bankTxns, payForm.txSearch])

  if (loading) return <div style={{ padding: 40, color: D.muted }}>Loading…</div>
  if (error || !loan) return <div style={{ padding: 40, color: D.red }}>{error || 'Loan not found'}</div>

  const termYears =
    loan.term_months >= 12
      ? `${(loan.term_months / 12).toFixed(loan.term_months % 12 === 0 ? 0 : 1)} yr`
      : `${loan.term_months} mo`

  const totalDrawn = calcTotalDrawn(loan, disbursements)
  const remainingToDisburse = calcRemainingToDisburse(loan, disbursements)

  // Running balance for payment history — starts from total drawn (not committed principal)
  let runningBalance = totalDrawn
  let cumInterest = 0,
    cumFees = 0
  const paymentRows = payments.map(p => {
    runningBalance = Math.max(0, Math.round((runningBalance - p.principal_amount) * 100) / 100)
    cumInterest = Math.round((cumInterest + p.interest_amount) * 100) / 100
    cumFees = Math.round((cumFees + p.fees_amount) * 100) / 100
    return { ...p, balance: runningBalance, cumInterest, cumFees }
  })

  // Past-maturity default interest
  const maturityDate = schedule.length > 0 ? schedule[schedule.length - 1].date : null
  const today = new Date().toISOString().slice(0, 10)
  const isPastMaturity = !isPaidOff && maturityDate != null && today > maturityDate
  const defaultInterestAccrued = (() => {
    if (!isPastMaturity || !loan.default_rate || outstanding <= 0) return null
    const days = Math.floor((Date.parse(today) - Date.parse(maturityDate!)) / 86400000)
    return Math.round(outstanding * loan.default_rate * (days / 365) * 100) / 100
  })()

  return (
    <>
      <div className="no-print" style={{ padding: '28px 32px', maxWidth: 1000 }}>
        {/* Back link + actions */}
        <div
          className="no-print"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}
        >
          <Link href="/loans" style={{ color: D.steel, fontSize: 12.5, textDecoration: 'none', fontWeight: 500 }}>
            ← Loans & Liabilities
          </Link>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => window.print()}
              style={{
                background: D.page,
                border: `1px solid ${D.border}`,
                color: D.charcoal,
                borderRadius: 5,
                padding: '6px 14px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Print / Save PDF
            </button>
          </div>
        </div>

        {/* Loan header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: D.sage, margin: 0 }}>{loan.name}</h1>
            {isPaidOff && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  background: D.green,
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: 3,
                }}
              >
                PAID OFF
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12, color: D.muted, flexWrap: 'wrap' }}>
            <span>
              Lender: <strong style={{ color: D.charcoal }}>{loan.lender || '—'}</strong>
            </span>
            {loan.default_rate != null && (
              <span>
                Default Rate:{' '}
                <strong style={{ color: D.red }}>
                  {(loan.default_rate * 100).toFixed(2).replace(/\.?0+$/, '')}% / yr
                </strong>
              </span>
            )}
            <span>
              Instrument:{' '}
              <strong style={{ color: D.charcoal }}>{INSTRUMENT_LABELS[loan.instrument_type ?? 'term_loan']}</strong>
            </span>
            {usesFactorRate(loan.instrument_type ?? 'term_loan') ? (
              <>
                <span>
                  Factor Rate: <strong style={{ color: D.charcoal }}>{loan.factor_rate ?? '—'}x</strong>
                </span>
                {loan.holdback_pct != null && (
                  <span>
                    Holdback: <strong style={{ color: D.charcoal }}>{(loan.holdback_pct * 100).toFixed(1)}%</strong>
                  </span>
                )}
              </>
            ) : usesFlatFee(loan.instrument_type ?? 'term_loan') ? (
              <span>
                Total Fee:{' '}
                <strong style={{ color: D.charcoal }}>
                  {loan.total_fee != null ? `$${loan.total_fee.toLocaleString()}` : '—'}
                </strong>
              </span>
            ) : (
              <span>
                Rate:{' '}
                <strong style={{ color: D.charcoal }}>
                  {loan.interest_rate != null ? `${(loan.interest_rate * 100).toFixed(2)}% APR` : '—'}
                </strong>
              </span>
            )}
            <span>
              Term: <strong style={{ color: D.charcoal }}>{termYears}</strong>
            </span>
            <span>
              First Payment: <strong style={{ color: D.charcoal }}>{fmtDate(loan.start_date)}</strong>
            </span>
            <span>
              Frequency: <strong style={{ color: D.charcoal }}>{loan.payment_frequency}</strong>
            </span>
          </div>
          {loan.notes && (
            <div style={{ marginTop: 6, fontSize: 12, color: D.muted, fontStyle: 'italic' }}>{loan.notes}</div>
          )}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: D.muted }}>Liability Account:</span>
            {linkedAccount ? (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: D.sage,
                  background: `${D.sage}15`,
                  border: `1px solid ${D.sage}40`,
                  borderRadius: 5,
                  padding: '3px 10px',
                }}
              >
                {linkedAccount}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: D.muted, fontStyle: 'italic' }}>
                No linked account — edit the loan to auto-create one
              </span>
            )}
          </div>
        </div>

        {/* KPI cards */}
        {(() => {
          const cards =
            disbursements.length > 0
              ? [
                  { label: 'Committed', value: fmt(loan.original_principal), color: D.charcoal },
                  {
                    label: 'Total Drawn',
                    value: fmt(totalDrawn),
                    color: remainingToDisburse > 0 ? D.gold : D.charcoal,
                  },
                  { label: 'Outstanding Balance', value: fmt(outstanding), color: isPaidOff ? D.green : D.red },
                  { label: 'Principal Paid', value: fmt(totalPrincipalPaid), color: D.green },
                  { label: 'Interest Paid', value: fmt(totalInterestPaid), color: D.charcoal },
                  { label: 'Fees Paid', value: fmt(totalFeesPaid), color: D.charcoal },
                ]
              : [
                  { label: 'Original Principal', value: fmt(loan.original_principal), color: D.charcoal },
                  { label: 'Outstanding Balance', value: fmt(outstanding), color: isPaidOff ? D.green : D.red },
                  { label: 'Principal Paid', value: fmt(totalPrincipalPaid), color: D.green },
                  { label: 'Interest Paid', value: fmt(totalInterestPaid), color: D.charcoal },
                  { label: 'Fees Paid', value: fmt(totalFeesPaid), color: D.charcoal },
                ]
          return (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cards.length}, 1fr)`,
                gap: 10,
                marginBottom: 24,
              }}
            >
              {cards.map(c => (
                <div
                  key={c.label}
                  style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 7, padding: '12px 14px' }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: D.muted,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px',
                    }}
                  >
                    {c.label}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: c.color, marginTop: 3 }}>{c.value}</div>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Disbursements */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: D.charcoal, margin: 0 }}>
              Disbursements
              {disbursements.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 400, color: D.muted, marginLeft: 8 }}>
                  {disbursements.length} draw{disbursements.length !== 1 ? 's' : ''} · {fmt(totalDrawn)} drawn
                  {remainingToDisburse > 0 && ` · ${fmt(remainingToDisburse)} remaining`}
                </span>
              )}
            </h2>
            <div style={{ display: 'flex', gap: 8 }} className="no-print">
              {linkedAccount && linkedTxns.some(t => Number(t.amount) > 0) && (
                <button
                  onClick={importDisbursementsFromLinkedTxns}
                  disabled={saving}
                  style={{
                    background: D.page,
                    border: `1px solid ${D.border}`,
                    color: D.charcoal,
                    borderRadius: 5,
                    padding: '5px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  ↓ Import from linked transactions
                </button>
              )}
              <button
                onClick={openRecordDisbursement}
                style={{
                  background: D.steel,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  padding: '5px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Record Draw
              </button>
            </div>
          </div>
          {disbursements.length === 0 ? (
            <div style={{ fontSize: 12, color: D.muted, fontStyle: 'italic', padding: '8px 0' }}>
              No draws recorded — treating full {fmt(loan.original_principal)} as disbursed at origination. Use{' '}
              <em>Record Draw</em> if funds were advanced in stages.
            </div>
          ) : (
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: D.page }}>
                    {['#', 'Date', 'Amount', 'Notes', 'Bank Transaction', ''].map(h => (
                      <th
                        key={h}
                        style={{
                          padding: '8px 12px',
                          textAlign: h === '' || h === 'Amount' ? 'right' : h === '#' ? 'center' : 'left',
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: D.muted,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          borderBottom: `1px solid ${D.border}`,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {disbursements.map((d, i) => (
                    <tr
                      key={d.id}
                      style={{ borderBottom: i < disbursements.length - 1 ? `1px solid ${D.border}` : 'none' }}
                    >
                      <td
                        style={{ padding: '8px 12px', textAlign: 'center', color: D.muted, fontSize: 11.5, width: 36 }}
                      >
                        {i + 1}
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(d.disbursement_date)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: D.green }}>
                        {fmt(d.amount)}
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          color: D.muted,
                          fontSize: 11.5,
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {d.notes || '—'}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11.5, maxWidth: 200 }}>
                        {(() => {
                          const t = d.transaction_id ? paymentTxns[d.transaction_id] : null
                          if (!t) return <span style={{ color: D.muted }}>—</span>
                          return (
                            <div>
                              <div
                                style={{
                                  color: D.charcoal,
                                  fontWeight: 500,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {t.description}
                              </div>
                              <div style={{ color: D.muted, fontSize: 10.5 }}>
                                {t.transaction_date} · {fmt(Math.abs(Number(t.amount)))}
                              </div>
                            </div>
                          )
                        })()}
                      </td>
                      <td
                        style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}
                        className="no-print"
                      >
                        <button
                          onClick={() => openEditDisbursement(d)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: D.steel,
                            fontSize: 11,
                            cursor: 'pointer',
                            marginRight: 6,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteDisbursement(d.id)}
                          style={{ background: 'none', border: 'none', color: D.red, fontSize: 11, cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Next payment */}
        {nextScheduledRow && !isPaidOff && (
          <div
            style={{
              background: `${D.sage}10`,
              border: `1px solid ${D.sage}30`,
              borderRadius: 7,
              padding: '10px 16px',
              marginBottom: 24,
              fontSize: 12.5,
              display: 'flex',
              gap: 24,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 600, color: D.sage }}>Next Scheduled Payment</span>
            <span>
              Date: <strong>{fmtDate(nextScheduledRow.date)}</strong>
            </span>
            <span>
              Total: <strong>{fmt(nextScheduledRow.payment)}</strong>
            </span>
            <span>
              Principal: <strong>{fmt(nextScheduledRow.principal)}</strong>
            </span>
            <span>
              Interest: <strong>{fmt(nextScheduledRow.interest)}</strong>
            </span>
            <span>
              Balance after: <strong>{fmt(nextScheduledRow.balance)}</strong>
            </span>
          </div>
        )}

        {/* Past-maturity default interest banner */}
        {isPastMaturity && (
          <div
            style={{
              background: `${D.red}10`,
              border: `1px solid ${D.red}40`,
              borderRadius: 7,
              padding: '10px 16px',
              marginBottom: 24,
              fontSize: 12.5,
              display: 'flex',
              gap: 24,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 600, color: D.red }}>⚠ Past Maturity — {fmtDate(maturityDate!)}</span>
            {loan.default_rate != null ? (
              <>
                <span>
                  Default rate:{' '}
                  <strong style={{ color: D.red }}>
                    {(loan.default_rate * 100).toFixed(2).replace(/\.?0+$/, '')}% / yr
                  </strong>
                </span>
                <span>
                  Unpaid balance: <strong style={{ color: D.red }}>{fmt(outstanding)}</strong>
                </span>
                {defaultInterestAccrued != null && (
                  <span>
                    Est. default interest accrued:{' '}
                    <strong style={{ color: D.red }}>{fmt(defaultInterestAccrued)}</strong>
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: D.muted }}>No default rate set — edit the loan to add one.</span>
            )}
          </div>
        )}

        {/* Payment History */}
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: D.charcoal, margin: 0 }}>Payment History</h2>
            <div style={{ display: 'flex', gap: 8 }} className="no-print">
              {linkedAccount && linkedTxns.some(t => Number(t.amount) < 0) && (
                <button
                  onClick={importFromLinkedTxns}
                  disabled={saving}
                  style={{
                    background: D.page,
                    border: `1px solid ${D.border}`,
                    color: D.charcoal,
                    borderRadius: 5,
                    padding: '5px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  ↓ Import from linked transactions
                </button>
              )}
              {!isPaidOff && (
                <button
                  onClick={openRecordPayment}
                  style={{
                    background: D.sage,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 5,
                    padding: '5px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Record Payment
                </button>
              )}
            </div>
          </div>
          {payments.length === 0 ? (
            <div style={{ color: D.muted, fontSize: 12.5, padding: '16px 0' }}>No payments recorded yet.</div>
          ) : (
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: D.page }}>
                    {['#', 'Date', 'Total Paid', 'Principal', 'Interest', 'Fee', 'Balance', 'Bank Transaction', ''].map(
                      h => (
                        <th
                          key={h}
                          style={{
                            padding: '8px 12px',
                            textAlign: h === '' ? 'right' : h === '#' ? 'center' : 'left',
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: D.muted,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            borderBottom: `1px solid ${D.border}`,
                          }}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {paymentRows.slice(payPage * 12, (payPage + 1) * 12).map((p, i, arr) => (
                    <tr key={p.id} style={{ borderBottom: i < arr.length - 1 ? `1px solid ${D.border}` : 'none' }}>
                      <td
                        style={{ padding: '8px 12px', textAlign: 'center', color: D.muted, fontSize: 11.5, width: 36 }}
                      >
                        {payPage * 12 + i + 1}
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(p.payment_date)}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{fmt(p.total_amount)}</td>
                      <td style={{ padding: '8px 12px', color: D.green }}>{fmt(p.principal_amount)}</td>
                      <td style={{ padding: '8px 12px', color: D.red }}>{fmt(p.interest_amount)}</td>
                      <td style={{ padding: '8px 12px', color: D.gold }}>{fmt(p.fees_amount)}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 500 }}>{fmt(p.balance)}</td>
                      <td style={{ padding: '8px 12px', fontSize: 11.5, maxWidth: 200 }}>
                        {(() => {
                          const t = p.transaction_id ? paymentTxns[p.transaction_id] : null
                          if (!t) return <span style={{ color: D.muted }}>—</span>
                          return (
                            <div>
                              <div
                                style={{
                                  color: D.charcoal,
                                  fontWeight: 500,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {t.description}
                              </div>
                              <div style={{ color: D.muted, fontSize: 10.5 }}>
                                {t.transaction_date} · {fmt(Math.abs(Number(t.amount)))}
                              </div>
                            </div>
                          )
                        })()}
                      </td>
                      <td
                        style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}
                        className="no-print"
                      >
                        <button
                          onClick={() => openEditPayment(p)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: D.steel,
                            fontSize: 11,
                            cursor: 'pointer',
                            marginRight: 6,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deletePayment(p.id)}
                          style={{ background: 'none', border: 'none', color: D.red, fontSize: 11, cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager page={payPage} total={paymentRows.length} perPage={12} onChange={setPayPage} />
            </div>
          )}
        </section>

        {/* Linked Transactions — bank transactions assigned to the liability account */}
        {linkedAccount && (
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: D.charcoal, margin: '0 0 4px' }}>Linked Transactions</h2>
            <p style={{ fontSize: 12, color: D.muted, margin: '0 0 12px' }}>
              Bank transactions assigned to <strong>{linkedAccount}</strong> in the Transactions view. Negative amounts
              are repayments; positive amounts are disbursements received.
            </p>
            {linkedTxns.length === 0 ? (
              <div style={{ color: D.muted, fontSize: 12.5, padding: '16px 0' }}>
                No transactions linked yet — go to Transactions and assign them to <strong>{linkedAccount}</strong>.
              </div>
            ) : (
              (() => {
                let runBal = loan.original_principal
                const rows = linkedTxns.map(t => {
                  const amt = effectiveAmt(t, linkedAccount)
                  if (amt < 0) runBal = Math.max(0, Math.round((runBal + amt) * 100) / 100)
                  return { ...t, balance: runBal }
                })
                const pageRows = rows.slice(linkedPage * 12, (linkedPage + 1) * 12)
                const totalIn = linkedTxns
                  .filter(t => effectiveAmt(t, linkedAccount) > 0)
                  .reduce((s, t) => s + effectiveAmt(t, linkedAccount), 0)
                const totalOut = linkedTxns
                  .filter(t => effectiveAmt(t, linkedAccount) < 0)
                  .reduce((s, t) => s + Math.abs(effectiveAmt(t, linkedAccount)), 0)
                return (
                  <>
                    <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                      {[
                        { label: 'Disbursements', value: fmt(totalIn), color: D.charcoal },
                        { label: 'Payments', value: fmt(totalOut), color: D.green },
                      ].map(c => (
                        <div
                          key={c.label}
                          style={{
                            background: D.page,
                            border: `1px solid ${D.border}`,
                            borderRadius: 6,
                            padding: '8px 14px',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              color: D.muted,
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            {c.label}
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: c.color, marginTop: 2 }}>{c.value}</div>
                        </div>
                      ))}
                    </div>
                    <div
                      style={{
                        background: D.card,
                        border: `1px solid ${D.border}`,
                        borderRadius: 8,
                        overflow: 'hidden',
                      }}
                    >
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: D.page }}>
                            {['Date', 'Description', 'Amount'].map(h => (
                              <th
                                key={h}
                                style={{
                                  padding: '8px 12px',
                                  textAlign: h === 'Amount' ? 'right' : 'left',
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  color: D.muted,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  borderBottom: `1px solid ${D.border}`,
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((t, i) => (
                            <tr
                              key={t.id}
                              style={{ borderBottom: i < pageRows.length - 1 ? `1px solid ${D.border}` : 'none' }}
                            >
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                {fmtDate(t.transaction_date)}
                              </td>
                              <td
                                style={{
                                  padding: '8px 12px',
                                  maxWidth: 300,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {t.description}
                              </td>
                              <td
                                style={{
                                  padding: '8px 12px',
                                  textAlign: 'right',
                                  fontWeight: 600,
                                  color: effectiveAmt(t, linkedAccount) < 0 ? D.green : D.charcoal,
                                }}
                              >
                                {effectiveAmt(t, linkedAccount) < 0
                                  ? fmt(Math.abs(effectiveAmt(t, linkedAccount)))
                                  : `+${fmt(effectiveAmt(t, linkedAccount))}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <Pager page={linkedPage} total={rows.length} perPage={12} onChange={setLinkedPage} />
                    </div>
                  </>
                )
              })()
            )}
          </section>
        )}

        {/* Repayment Schedule — hidden for LOC/other which have no fixed schedule */}
        {hasFixedSchedule(loan.instrument_type ?? 'term_loan') && (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: D.charcoal, margin: 0 }}>
                {usesFactorRate(loan.instrument_type ?? 'term_loan')
                  ? 'Repayment Schedule (Estimated)'
                  : 'Amortization Schedule'}
                <span style={{ fontSize: 11, fontWeight: 400, color: D.muted, marginLeft: 8 }}>
                  ({schedule.filter(r => !r.isStub).length} periods
                  {loan.term_months > 0 ? ` · ${loan.term_months} months` : ''})
                </span>
              </h2>
              <button
                className="no-print"
                onClick={() => setShowFullSchedule(v => !v)}
                style={{
                  background: 'none',
                  border: `1px solid ${D.border}`,
                  color: D.steel,
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {showFullSchedule ? 'Collapse' : 'Show All'}
              </button>
            </div>

            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: D.page }}>
                    {[
                      '#',
                      'Start',
                      'End',
                      'Payment Date',
                      'Payment',
                      'Principal',
                      costLabel(loan.instrument_type ?? 'term_loan'),
                      'Balance',
                      'Bank Transaction',
                    ].map(h => (
                      <th
                        key={h}
                        style={{
                          padding: '8px 12px',
                          textAlign:
                            h === '#'
                              ? 'center'
                              : h === 'Start' || h === 'End' || h === 'Payment Date' || h === 'Bank Transaction'
                                ? 'left'
                                : 'right',
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: D.muted,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          borderBottom: `1px solid ${D.border}`,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleSchedule.map(row => {
                    // Stub row — interest collected with the first regular payment
                    if (row.isStub) {
                      const stubPay = schedulePaymentMap.get(0) ?? null
                      const stubTxn = stubPay?.transaction_id ? paymentTxns[stubPay.transaction_id] : null
                      return (
                        <tr key="stub" style={{ borderBottom: `1px solid ${D.border}`, background: `${D.gold}0E` }}>
                          <td style={{ padding: '7px 12px', textAlign: 'center', color: D.gold, fontWeight: 700 }}>
                            0
                          </td>
                          <td style={{ padding: '7px 12px', color: D.charcoal }}>{fmtDate(row.accrualStart)}</td>
                          <td style={{ padding: '7px 12px', color: D.charcoal }}>{fmtDate(row.accrualEnd)}</td>
                          <td style={{ padding: '7px 12px', color: D.charcoal }}>{fmtDate(row.date)}</td>
                          <td style={{ padding: '7px 12px', textAlign: 'right', color: D.charcoal }}>
                            {fmt(row.payment)}
                          </td>
                          <td style={{ padding: '7px 12px', textAlign: 'right', color: D.muted }}>—</td>
                          <td style={{ padding: '7px 12px', textAlign: 'right', color: D.red }}>{fmt(row.interest)}</td>
                          <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 500, color: D.charcoal }}>
                            {fmt(row.balance)}
                          </td>
                          <td style={{ padding: '7px 12px', fontSize: 11.5, maxWidth: 220 }}>
                            <SchedTxnCell
                              txn={stubTxn}
                              pay={stubPay}
                              onEdit={() => {
                                if (stubPay) openEditPayment(stubPay)
                              }}
                              label="30/360 odd-day interest"
                            />
                          </td>
                        </tr>
                      )
                    }
                    const pay = schedulePaymentMap.get(row.period) ?? null
                    const isPaid = !!pay
                    const isCurrent = !isPaid && schedule[currentPeriodIdx]?.period === row.period
                    const t = pay?.transaction_id ? paymentTxns[pay.transaction_id] : null
                    return (
                      <tr
                        key={row.period}
                        style={{
                          borderBottom: `1px solid ${D.border}`,
                          background: isCurrent ? `${D.gold}18` : 'transparent',
                        }}
                      >
                        <td
                          style={{
                            padding: '7px 12px',
                            textAlign: 'center',
                            color: isPaid ? D.green : isCurrent ? D.gold : D.muted,
                            fontWeight: isCurrent ? 700 : 400,
                          }}
                        >
                          {isPaid ? '✓' : row.period}
                        </td>
                        <td
                          style={{
                            padding: '7px 12px',
                            color: isPaid ? D.muted : D.charcoal,
                            textDecoration: isPaid ? 'line-through' : 'none',
                          }}
                        >
                          {fmtDate(row.accrualStart)}
                        </td>
                        <td
                          style={{
                            padding: '7px 12px',
                            color: isPaid ? D.muted : D.charcoal,
                            textDecoration: isPaid ? 'line-through' : 'none',
                          }}
                        >
                          {fmtDate(row.accrualEnd)}
                        </td>
                        <td
                          style={{
                            padding: '7px 12px',
                            color: isPaid ? D.muted : D.charcoal,
                            textDecoration: isPaid ? 'line-through' : 'none',
                          }}
                        >
                          {fmtDate(row.date)}
                        </td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', color: isPaid ? D.muted : D.charcoal }}>
                          {fmt(row.payment)}
                        </td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', color: isPaid ? D.muted : D.green }}>
                          {fmt(row.principal)}
                        </td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', color: isPaid ? D.muted : D.red }}>
                          {fmt(row.interest)}
                        </td>
                        <td
                          style={{
                            padding: '7px 12px',
                            textAlign: 'right',
                            fontWeight: 500,
                            color: isPaid ? D.muted : D.charcoal,
                          }}
                        >
                          {fmt(row.balance)}
                        </td>
                        <td style={{ padding: '7px 12px', fontSize: 11.5, maxWidth: 220 }}>
                          <SchedTxnCell
                            txn={t}
                            pay={pay}
                            onEdit={() => {
                              if (pay) openEditPayment(pay)
                            }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!showFullSchedule && (
                <Pager page={schedPage} total={schedule.length} perPage={12} onChange={setSchedPage} />
              )}
            </div>
          </section>
        )}

        {/* Record / Edit Disbursement Modal */}
        {disbModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={e => {
              if (e.target === e.currentTarget) setDisbModal(false)
            }}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: 10,
                padding: '26px 26px 18px',
                width: 480,
                maxHeight: '90vh',
                overflowY: 'auto',
                boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              }}
            >
              <h2 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: D.sage }}>
                {editDisb ? 'Edit Disbursement' : 'Record Draw'}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px' }}>
                <div>
                  <label style={lbl}>Date *</label>
                  <input
                    style={inp}
                    type="date"
                    value={disbForm.disbursement_date}
                    onChange={e => {
                      setDisbForm(f => ({ ...f, disbursement_date: e.target.value }))
                      loadBankTxns(e.target.value)
                    }}
                  />
                </div>
                <div>
                  <label style={lbl}>Amount *</label>
                  <input
                    style={inp}
                    type="number"
                    min="0"
                    step="0.01"
                    value={disbForm.amount}
                    onChange={e => setDisbForm(f => ({ ...f, amount: e.target.value }))}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <input
                    style={inp}
                    value={disbForm.notes}
                    onChange={e => setDisbForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="e.g. First tranche — equipment purchase"
                  />
                </div>
              </div>
              <div style={{ marginTop: 14, borderTop: `1px solid ${D.border}`, paddingTop: 14 }}>
                <label style={{ ...lbl, marginBottom: 6 }}>
                  Link to Bank Transaction
                  <span style={{ fontWeight: 400, color: D.muted, marginLeft: 4 }}>(optional)</span>
                </label>
                <input
                  style={{ ...inp, marginBottom: 8 }}
                  placeholder="Search by description or amount…"
                  value={disbForm.txSearch}
                  onChange={e => setDisbForm(f => ({ ...f, txSearch: e.target.value }))}
                />
                {bankTxns.length > 0 && (
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: `1px solid ${D.border}`, borderRadius: 5 }}>
                    {bankTxns
                      .filter(
                        t =>
                          !disbForm.txSearch.trim() ||
                          t.description.toLowerCase().includes(disbForm.txSearch.toLowerCase()) ||
                          String(Math.abs(t.amount)).includes(disbForm.txSearch),
                      )
                      .map(t => (
                        <div
                          key={t.id}
                          onClick={() =>
                            setDisbForm(f => ({
                              ...f,
                              transaction_id: f.transaction_id === t.id ? '' : t.id,
                            }))
                          }
                          style={{
                            padding: '7px 10px',
                            cursor: 'pointer',
                            fontSize: 12,
                            background: disbForm.transaction_id === t.id ? `${D.sage}15` : 'transparent',
                            borderBottom: `1px solid ${D.border}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>
                            {t.transaction_date} · {t.description}
                          </span>
                          <span style={{ fontWeight: 600, color: t.amount > 0 ? D.green : D.red }}>
                            {fmt(t.amount)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
                {disbForm.transaction_id && (
                  <div style={{ fontSize: 11.5, color: D.steel, marginTop: 4 }}>
                    ✓ Linked to transaction ID {disbForm.transaction_id.slice(0, 8)}…
                  </div>
                )}
              </div>
              {disbErr && <div style={{ color: D.red, fontSize: 12, marginTop: 10 }}>{disbErr}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button
                  onClick={() => setDisbModal(false)}
                  style={{
                    background: D.page,
                    border: `1px solid ${D.border}`,
                    color: D.charcoal,
                    borderRadius: 5,
                    padding: '7px 14px',
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveDisbursement}
                  disabled={saving}
                  style={{
                    background: D.sage,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 5,
                    padding: '7px 18px',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving…' : 'Save Draw'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Record / Edit Payment Modal */}
        {payModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={e => {
              if (e.target === e.currentTarget) setPayModal(false)
            }}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: 10,
                padding: '26px 26px 18px',
                width: 520,
                maxHeight: '92vh',
                overflowY: 'auto',
                boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              }}
            >
              <h2 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: D.sage }}>
                {editPayment ? 'Edit Payment' : 'Record Payment'}
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px' }}>
                <div>
                  <label style={lbl}>Payment Date *</label>
                  <input
                    style={inp}
                    type="date"
                    value={payForm.payment_date}
                    onChange={e => {
                      setPayForm(f => ({ ...f, payment_date: e.target.value }))
                      loadBankTxns(e.target.value)
                    }}
                  />
                </div>
                <div>
                  <label style={lbl}>Total Amount *</label>
                  <input
                    style={inp}
                    type="number"
                    min="0"
                    step="0.01"
                    value={payForm.total_amount}
                    onChange={e => recalcSplit(e.target.value)}
                  />
                </div>
                <div>
                  <label style={lbl}>Principal</label>
                  <input
                    style={inp}
                    type="number"
                    min="0"
                    step="0.01"
                    value={payForm.principal_amount}
                    onChange={e => setPayForm(f => ({ ...f, principal_amount: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={lbl}>Interest</label>
                  <input
                    style={inp}
                    type="number"
                    min="0"
                    step="0.01"
                    value={payForm.interest_amount}
                    onChange={e => setPayForm(f => ({ ...f, interest_amount: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={lbl}>Fees</label>
                  <input
                    style={inp}
                    type="number"
                    min="0"
                    step="0.01"
                    value={payForm.fees_amount}
                    onChange={e => setPayForm(f => ({ ...f, fees_amount: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={lbl}>Notes</label>
                  <input
                    style={inp}
                    value={payForm.notes}
                    onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>

              {/* Bank transaction linking */}
              <div style={{ marginTop: 14, borderTop: `1px solid ${D.border}`, paddingTop: 14 }}>
                <label style={{ ...lbl, marginBottom: 6 }}>
                  Link to Bank Transaction
                  <span style={{ fontWeight: 400, color: D.muted, marginLeft: 4 }}>
                    (optional — within ±14 days of payment date)
                  </span>
                </label>
                <input
                  style={{ ...inp, marginBottom: 8 }}
                  placeholder="Search by description or amount…"
                  value={payForm.txSearch}
                  onChange={e => setPayForm(f => ({ ...f, txSearch: e.target.value }))}
                />
                {filteredTxns.length > 0 && (
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: `1px solid ${D.border}`, borderRadius: 5 }}>
                    {filteredTxns.map(t => (
                      <div
                        key={t.id}
                        onClick={() =>
                          setPayForm(f => ({
                            ...f,
                            transaction_id: f.transaction_id === t.id ? '' : t.id,
                            total_amount: f.transaction_id === t.id ? f.total_amount : String(Math.abs(t.amount)),
                          }))
                        }
                        style={{
                          padding: '7px 10px',
                          cursor: 'pointer',
                          fontSize: 12,
                          background: payForm.transaction_id === t.id ? `${D.sage}15` : 'transparent',
                          borderBottom: `1px solid ${D.border}`,
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>
                          {t.transaction_date} · {t.description}
                        </span>
                        <span style={{ fontWeight: 600, color: t.amount < 0 ? D.red : D.green }}>{fmt(t.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {filteredTxns.length === 0 && bankTxns.length === 0 && (
                  <div style={{ fontSize: 11.5, color: D.muted }}>No bank transactions found near this date.</div>
                )}
                {payForm.transaction_id && (
                  <div style={{ fontSize: 11.5, color: D.steel, marginTop: 4 }}>
                    ✓ Linked to transaction ID {payForm.transaction_id.slice(0, 8)}…
                  </div>
                )}
              </div>

              {payErr && <div style={{ color: D.red, fontSize: 12, marginTop: 10 }}>{payErr}</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button
                  onClick={() => setPayModal(false)}
                  style={{
                    background: D.page,
                    border: `1px solid ${D.border}`,
                    color: D.charcoal,
                    borderRadius: 5,
                    padding: '7px 14px',
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={savePayment}
                  disabled={saving}
                  style={{
                    background: D.sage,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 5,
                    padding: '7px 18px',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving…' : 'Save Payment'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Print-only Loan Statement ─────────────────────────────────── */}
      <div
        className="print-only"
        style={{ display: 'none', padding: '20px 24px', fontFamily: 'inherit', background: '#fff' }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            borderBottom: '3px solid #2C5F52',
            paddingBottom: 12,
            marginBottom: 18,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: '#2C5F52',
                textTransform: 'uppercase',
                letterSpacing: '2.5px',
                marginBottom: 4,
              }}
            >
              Loan Statement
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a' }}>{loan.name}</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>
              Lender: <strong>{loan.lender}</strong>
              {' · '}
              {INSTRUMENT_LABELS[loan.instrument_type ?? 'term_loan']}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 11, color: '#666' }}>
            <div>
              Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
            <div style={{ marginTop: 2 }}>
              {payments.length} payment{payments.length !== 1 ? 's' : ''} recorded
            </div>
          </div>
        </div>

        {/* Loan Terms */}
        <div
          style={{
            display: 'flex',
            gap: 28,
            marginBottom: 18,
            padding: '9px 14px',
            background: '#F5F0E8',
            borderRadius: 4,
            fontSize: 11,
          }}
        >
          <span>
            <span style={{ color: '#888', fontWeight: 600 }}>Committed: </span>
            <strong>{fmt(loan.original_principal)}</strong>
          </span>
          {disbursements.length > 0 && (
            <span>
              <span style={{ color: '#888', fontWeight: 600 }}>Drawn: </span>
              <strong>{fmt(totalDrawn)}</strong>
            </span>
          )}
          {usesFactorRate(loan.instrument_type ?? 'term_loan') ? (
            <span>
              <span style={{ color: '#888', fontWeight: 600 }}>Factor Rate: </span>
              <strong>{loan.factor_rate ?? '—'}x</strong>
            </span>
          ) : usesFlatFee(loan.instrument_type ?? 'term_loan') ? (
            <span>
              <span style={{ color: '#888', fontWeight: 600 }}>Total Fee: </span>
              <strong>{loan.total_fee != null ? `$${loan.total_fee.toLocaleString()}` : '—'}</strong>
            </span>
          ) : (
            <span>
              <span style={{ color: '#888', fontWeight: 600 }}>Rate: </span>
              <strong>{loan.interest_rate != null ? `${(loan.interest_rate * 100).toFixed(2)}% APR` : '—'}</strong>
            </span>
          )}
          <span>
            <span style={{ color: '#888', fontWeight: 600 }}>Term: </span>
            <strong>{termYears}</strong>
          </span>
          <span>
            <span style={{ color: '#888', fontWeight: 600 }}>First Payment: </span>
            <strong>{fmtDate(loan.start_date)}</strong>
          </span>
          <span>
            <span style={{ color: '#888', fontWeight: 600 }}>Frequency: </span>
            <strong style={{ textTransform: 'capitalize' }}>{loan.payment_frequency}</strong>
          </span>
        </div>

        {/* Account Summary */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            marginBottom: 22,
            border: '1px solid #D9D4C8',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          {(
            [
              { label: 'Committed', value: fmt(loan.original_principal), color: '#1a1a1a' },
              ...(disbursements.length > 0
                ? [
                    {
                      label: 'Total Drawn',
                      value: fmt(totalDrawn),
                      color: remainingToDisburse > 0 ? '#C8A96E' : '#1a1a1a',
                    },
                  ]
                : []),
              { label: 'Outstanding Balance', value: fmt(outstanding), color: isPaidOff ? '#2E7D52' : '#B94040' },
              { label: 'Principal Paid', value: fmt(totalPrincipalPaid), color: '#2E7D52' },
              { label: 'Interest Paid', value: fmt(totalInterestPaid), color: '#1a1a1a' },
              { label: 'Fees Paid', value: fmt(totalFeesPaid), color: '#1a1a1a' },
            ] as { label: string; value: string; color: string }[]
          ).map((c, idx) => (
            <div
              key={c.label}
              style={{
                flex: 1,
                padding: '9px 12px',
                borderLeft: idx > 0 ? '1px solid #D9D4C8' : 'none',
                background: '#fff',
              }}
            >
              <div
                style={{
                  fontSize: 8.5,
                  fontWeight: 700,
                  color: '#aaa',
                  textTransform: 'uppercase',
                  letterSpacing: '0.4px',
                  marginBottom: 3,
                }}
              >
                {c.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* Disbursements (print) */}
        {disbursements.length > 0 && (
          <>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: '#2C5F52',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: 7,
              }}
            >
              Disbursements
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, marginBottom: 20 }}>
              <thead>
                <tr style={{ background: '#2C5F52', color: '#fff' }}>
                  {(['#', 'Date', 'Amount', 'Notes'] as string[]).map((h, hi) => (
                    <th
                      key={`dh-${hi}`}
                      style={{
                        padding: '6px 8px',
                        fontWeight: 700,
                        fontSize: 8.5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.3px',
                        textAlign: hi <= 1 ? 'left' : 'right',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disbursements.map((d, i) => (
                  <tr
                    key={d.id}
                    style={{ background: i % 2 === 0 ? '#fff' : '#F9F7F4', borderBottom: '1px solid #eeebe5' }}
                  >
                    <td style={{ padding: '5px 8px', color: '#bbb', fontSize: 9.5 }}>{i + 1}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{fmtDate(d.disbursement_date)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(d.amount)}</td>
                    <td style={{ padding: '5px 8px', color: '#666' }}>{d.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#2C5F52', color: '#fff', fontWeight: 700 }}>
                  <td colSpan={2} style={{ padding: '6px 8px', fontSize: 10.5 }}>
                    Total Drawn
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(totalDrawn)}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {remainingToDisburse > 0 ? `${fmt(remainingToDisburse)} remaining` : 'Fully drawn'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </>
        )}

        {/* Payment History */}
        {payments.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#aaa', fontSize: 12 }}>No payments recorded.</div>
        ) : (
          <>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: '#2C5F52',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: 7,
              }}
            >
              Payment History
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
              <thead>
                <tr style={{ background: '#2C5F52', color: '#fff' }}>
                  {(
                    [
                      '#',
                      'Date',
                      'Total Paid',
                      'Principal',
                      'Interest',
                      'Fee',
                      'Balance',
                      'Interest to Date',
                      'Fees to Date',
                    ] as string[]
                  ).map((h, hi) => (
                    <th
                      key={`sh-${hi}`}
                      style={{
                        padding: '6px 8px',
                        fontWeight: 700,
                        fontSize: 8.5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.3px',
                        textAlign: hi <= 1 ? 'left' : 'right',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paymentRows.map((p, i) => (
                  <tr
                    key={p.id}
                    style={{ background: i % 2 === 0 ? '#fff' : '#F9F7F4', borderBottom: '1px solid #eeebe5' }}
                  >
                    <td style={{ padding: '5px 8px', color: '#bbb', fontSize: 9.5, textAlign: 'left' }}>{i + 1}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', textAlign: 'left' }}>
                      {fmtDate(p.payment_date)}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(p.total_amount)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmt(p.principal_amount)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmt(p.interest_amount)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{fmt(p.fees_amount)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(p.balance)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: '#666' }}>{fmt(p.cumInterest)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: '#666' }}>{fmt(p.cumFees)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#2C5F52', color: '#fff', fontWeight: 700 }}>
                  <td colSpan={2} style={{ padding: '6px 8px', fontSize: 10.5 }}>
                    Totals
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {fmt(payments.reduce((s, p) => s + p.total_amount, 0))}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(totalPrincipalPaid)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(totalInterestPaid)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(totalFeesPaid)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(outstanding)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(totalInterestPaid)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(totalFeesPaid)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}

        {/* Footer */}
        <div style={{ marginTop: 18, paddingTop: 10, borderTop: '1px solid #e0ddd7', fontSize: 9.5, color: '#aaa' }}>
          Generated by Sandalo Business Finance · {new Date().toLocaleDateString()}
          {' · '}
          {disbursements.length > 0
            ? `Outstanding balance = ${fmt(totalDrawn)} drawn − ${fmt(totalPrincipalPaid)} repaid.`
            : 'Outstanding balance reflects principal reduction from fully-drawn original principal.'}
          {isPaidOff && ' This loan is fully paid off.'}
          {loan.notes && ` Notes: ${loan.notes}`}
        </div>
      </div>
    </>
  )
}
