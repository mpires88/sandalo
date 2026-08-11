'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  type Loan,
  type LoanFrequency,
  type LoanType,
  type InstrumentType,
  type LoanDisbursement,
  INSTRUMENT_LABELS,
  usesInterestRate,
  usesFactorRate,
  usesFlatFee,
  hasFixedSchedule,
  hasLoanType,
  isInformalDebt,
  calcOutstandingBalance,
  calcPaymentAmount,
  calcTotalDrawn,
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

const fmt = (n: number) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const FREQ_LABELS: Record<LoanFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
}

interface LoanForm {
  id?: string
  name: string
  lender: string
  instrument_type: InstrumentType
  loan_type: LoanType
  original_principal: string
  interest_rate: string // as %, e.g. "6.5"
  total_fee: string // flat fee note: dollar amount, e.g. "30000"
  factor_rate: string // e.g. "1.35"
  holdback_pct: string // as %, e.g. "12"
  start_date: string
  term_months: string
  payment_frequency: LoanFrequency
  payment_amount: string
  default_rate: string // as %, e.g. "2.5"
  notes: string
  linked_account_id: string
}

const BLANK: LoanForm = {
  name: '',
  lender: '',
  instrument_type: 'term_loan',
  loan_type: 'amortizing',
  original_principal: '',
  interest_rate: '',
  total_fee: '',
  factor_rate: '',
  holdback_pct: '',
  start_date: '',
  term_months: '',
  payment_frequency: 'monthly',
  payment_amount: '',
  default_rate: '',
  notes: '',
  linked_account_id: '',
}

interface LoanWithBalance extends Loan {
  outstanding: number
  drawn: number
  linkedAccount?: string
}

export default function Loans({ clientId }: { clientId: string }) {
  const [loans, setLoans] = useState<LoanWithBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<LoanForm>({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')
  const [availableAccounts, setAvailableAccounts] = useState<{ id: string; name: string; pl_section: string }[]>([])

  const load = useCallback(async () => {
    setLoading(true)

    // One-time seed: Galeano-Molina personal loan (Pevez LLC as lender)
    const SEED_KEY = 'sandalo_seeded_pevez_loan_v2'
    if (typeof window !== 'undefined' && !localStorage.getItem(SEED_KEY)) {
      // localStorage is per-browser — check the DB too, or every new device
      // inserts another $50k loan and doubles Total Outstanding
      const { data: existingPevez } = await supabase
        .from('loans')
        .select('id')
        .eq('client_id', clientId)
        .eq('lender', 'Pevez LLC')
        .limit(1)
      if ((existingPevez ?? []).length > 0) {
        localStorage.setItem(SEED_KEY, '1')
      } else {
        const { error: seedErr } = await supabase.from('loans').insert({
          client_id: clientId,
          name: 'Pevez LLC — $50k Note',
          lender: 'Pevez LLC',
          instrument_type: 'flat_fee',
          loan_type: 'interest_only',
          original_principal: 50000,
          total_fee: 30000,
          start_date: '2023-10-05',
          term_months: 24,
          payment_frequency: 'monthly',
          payment_amount: 1250,
          notes:
            'Lender: Pevez LLC (974 Bennington St, Boston MA 02128). Borrower: Alejandro Galeano-Molina (52 Bennington St, Revere MA 02151). Interest-only $1,250/mo (2.5%/mo on $50k). Pre-computed $30,000 fixed finance charge under Rule of 78 — fee largely owed regardless of payoff timing. $50,000 balloon principal due Oct 2025 (past due as of recording). Note: lender signature line blank on original agreement. Signed 10/4/2023.',
        })
        // Only mark seeded on verified success so a failed insert retries next load
        if (!seedErr) localStorage.setItem(SEED_KEY, '1')
      }
    }

    const { data: loanRows, error: e1 } = await supabase
      .from('loans')
      .select('*')
      .eq('client_id', clientId)
      .order('start_date')
    if (e1) {
      setError(e1.message)
      setLoading(false)
      return
    }

    // Whole-portfolio balance math needs every payment/disbursement row; without an
    // explicit limit PostgREST silently truncates at 1000 and balances drift
    const { data: payRows } = await supabase.from('loan_payments').select('*').eq('client_id', clientId).limit(10000)

    const { data: disbRows } = await supabase
      .from('loan_disbursements')
      .select('*')
      .eq('client_id', clientId)
      .limit(10000)

    const { data: linkedCats } = await supabase
      .from('categories')
      .select('loan_id, name')
      .eq('client_id', clientId)
      .filter('loan_id', 'not.is', null)

    const linkedAccountMap: Record<string, string> = {}
    for (const c of linkedCats ?? []) {
      if (c.loan_id) linkedAccountMap[c.loan_id] = c.name
    }

    const groupedPay: Record<string, typeof payRows> = {}
    for (const p of payRows ?? []) {
      if (!groupedPay[p.loan_id]) groupedPay[p.loan_id] = []
      groupedPay[p.loan_id]!.push(p)
    }

    const groupedDisb: Record<string, LoanDisbursement[]> = {}
    for (const d of disbRows ?? []) {
      if (!groupedDisb[d.loan_id]) groupedDisb[d.loan_id] = []
      groupedDisb[d.loan_id]!.push(d)
    }

    setLoans(
      (loanRows ?? []).map((l: Loan) => ({
        ...l,
        outstanding: calcOutstandingBalance(l, groupedPay[l.id] ?? [], groupedDisb[l.id] ?? []),
        drawn: calcTotalDrawn(l, groupedDisb[l.id] ?? []),
        linkedAccount: linkedAccountMap[l.id],
      })),
    )
    setLoading(false)
  }, [clientId])

  useEffect(() => {
    load()
  }, [load])

  // Load unlinked liability accounts (+ currently linked one if editing) whenever the modal opens
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-runs only when the modal opens
  useEffect(() => {
    if (!modal) return
    const loanId = form.id
    const run = async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name, pl_section')
        .eq('client_id', clientId)
        .in('pl_section', ['Current Liabilities', 'Non-Current Liabilities'])
        .or(loanId ? `loan_id.is.null,loan_id.eq.${loanId}` : 'loan_id.is.null')
        .order('pl_section')
        .order('name')
      setAvailableAccounts(data ?? [])

      if (loanId) {
        const { data: linked } = await supabase
          .from('categories')
          .select('id')
          .eq('loan_id', loanId)
          .eq('client_id', clientId)
          .maybeSingle()
        if (linked) setForm(f => ({ ...f, linked_account_id: linked.id }))
      }
    }
    run()
  }, [modal])

  function openAdd() {
    setForm({ ...BLANK, start_date: new Date().toISOString().slice(0, 10) })
    setFormErr('')
    setModal(true)
  }

  function openEdit(l: LoanWithBalance) {
    setForm({
      id: l.id,
      name: l.name,
      lender: l.lender,
      instrument_type: l.instrument_type ?? 'term_loan',
      loan_type: l.loan_type ?? 'amortizing',
      original_principal: String(l.original_principal),
      interest_rate: l.interest_rate != null ? String((l.interest_rate * 100).toFixed(4).replace(/\.?0+$/, '')) : '',
      total_fee: l.total_fee != null ? String(l.total_fee) : '',
      factor_rate: l.factor_rate != null ? String(l.factor_rate) : '',
      holdback_pct: l.holdback_pct != null ? String((l.holdback_pct * 100).toFixed(2).replace(/\.?0+$/, '')) : '',
      start_date: l.start_date,
      term_months: String(l.term_months),
      payment_frequency: l.payment_frequency,
      payment_amount: String(l.payment_amount),
      default_rate: l.default_rate != null ? String((l.default_rate * 100).toFixed(4).replace(/\.?0+$/, '')) : '',
      notes: l.notes ?? '',
      linked_account_id: '', // populated asynchronously by the modal useEffect
    })
    setFormErr('')
    setModal(true)
  }

  const itype = form.instrument_type
  const showInterestRate = usesInterestRate(itype)
  const showTotalFee = usesFlatFee(itype)
  const showFactorRate = usesFactorRate(itype)
  const showScheduleFields = hasFixedSchedule(itype)
  const showLoanType = hasLoanType(itype)
  const isInformal = isInformalDebt(itype)

  function calcPayment() {
    const p = parseFloat(form.original_principal)
    const r = parseFloat(form.interest_rate) / 100
    const t = parseInt(form.term_months, 10)
    if (!p || Number.isNaN(r) || !t) return
    const amt = calcPaymentAmount(p, r, t, form.payment_frequency)
    setForm(f => ({ ...f, payment_amount: String(amt) }))
  }

  async function save() {
    const p = parseFloat(form.original_principal)
    const pmt = parseFloat(form.payment_amount)
    const t = parseInt(form.term_months, 10)

    if (!form.name.trim()) {
      setFormErr('Name is required')
      return
    }
    if (!p || p <= 0) {
      setFormErr('Advance / principal amount must be > 0')
      return
    }
    if (!form.start_date) {
      setFormErr('Start date is required')
      return
    }

    if (showFactorRate) {
      const fr = parseFloat(form.factor_rate)
      if (Number.isNaN(fr) || fr <= 1) {
        setFormErr('Factor rate must be > 1.0 (e.g. 1.35)')
        return
      }
    } else if (showTotalFee) {
      const tf = parseFloat(form.total_fee)
      if (Number.isNaN(tf) || tf < 0) {
        setFormErr('Total fee must be ≥ 0')
        return
      }
    } else if (showInterestRate && !isInformal) {
      const r = parseFloat(form.interest_rate)
      if (Number.isNaN(r) || r < 0) {
        setFormErr('Interest rate must be ≥ 0')
        return
      }
    }

    if (showScheduleFields && (!t || t <= 0)) {
      setFormErr('Term (months) is required')
      return
    }
    if (!isInformal && (!pmt || pmt < 0)) {
      setFormErr('Payment amount is required')
      return
    }

    setSaving(true)

    const row: Omit<Loan, 'id'> & Record<string, unknown> = {
      client_id: clientId,
      name: form.name.trim(),
      lender: form.lender.trim(),
      instrument_type: itype,
      loan_type: itype === 'flat_fee' ? 'interest_only' : showLoanType ? form.loan_type : 'amortizing',
      original_principal: p,
      start_date: form.start_date,
      term_months: showScheduleFields ? t : 0,
      payment_frequency: form.payment_frequency,
      payment_amount: Number.isNaN(pmt) ? 0 : pmt,
      notes: form.notes.trim() || undefined,
      // Conditional rate/fee fields
      interest_rate: showInterestRate ? parseFloat(form.interest_rate) / 100 : undefined,
      total_fee: showTotalFee ? parseFloat(form.total_fee) || undefined : undefined,
      factor_rate: showFactorRate ? parseFloat(form.factor_rate) : undefined,
      holdback_pct: showFactorRate && form.holdback_pct ? parseFloat(form.holdback_pct) / 100 : undefined,
      default_rate: form.default_rate ? parseFloat(form.default_rate) / 100 : undefined,
    }

    let loanId = form.id ?? ''
    if (form.id) {
      const { error } = await supabase.from('loans').update(row).eq('id', form.id)
      if (error) {
        setFormErr(error.message)
        setSaving(false)
        return
      }
    } else {
      const { data: inserted, error } = await supabase.from('loans').insert(row).select('id').single()
      if (error || !inserted?.id) {
        setFormErr(error?.message ?? 'Could not save the loan.')
        setSaving(false)
        return
      }
      loanId = inserted.id
    }

    // Handle chart-of-accounts linking — the loan itself is saved by now, so a
    // linking failure is surfaced without closing the modal (retry is idempotent)
    let linkErr: string | null = null
    if (loanId && form.linked_account_id) {
      // User chose an existing account — link it and unlink any previously linked different account
      const { error: unlinkE } = await supabase
        .from('categories')
        .update({ loan_id: null })
        .eq('loan_id', loanId)
        .eq('client_id', clientId)
        .neq('id', form.linked_account_id)
      const { error: linkE } = await supabase
        .from('categories')
        .update({ loan_id: loanId })
        .eq('id', form.linked_account_id)
        .eq('client_id', clientId)
      linkErr = unlinkE?.message ?? linkE?.message ?? null
    } else if (loanId) {
      // Auto-create / update the linked liability account in chart of accounts
      const section = (showScheduleFields ? t : 0) > 12 ? 'Non-Current Liabilities' : 'Current Liabilities'
      const acctName = form.name.trim()

      // Check if a category is already linked to this loan
      const { data: existingLinked } = await supabase
        .from('categories')
        .select('id')
        .eq('loan_id', loanId)
        .eq('client_id', clientId)
        .maybeSingle()

      if (existingLinked) {
        const { error: updE } = await supabase
          .from('categories')
          .update({ name: acctName, pl_section: section })
          .eq('id', existingLinked.id)
        linkErr = updE?.message ?? null
      } else {
        // Check if a category with this name already exists (to avoid unique conflict)
        const { data: nameMatch } = await supabase
          .from('categories')
          .select('id')
          .eq('name', acctName)
          .eq('client_id', clientId)
          .maybeSingle()

        if (nameMatch) {
          const { error: updE } = await supabase
            .from('categories')
            .update({ loan_id: loanId, pl_section: section })
            .eq('id', nameMatch.id)
          linkErr = updE?.message ?? null
        } else {
          const { data: liabCats } = await supabase
            .from('categories')
            .select('sort_order')
            .eq('client_id', clientId)
            .eq('pl_section', section)
          const maxOrder = (liabCats ?? []).reduce(
            (m: number, c: { sort_order: number }) => Math.max(m, c.sort_order || 0),
            0,
          )
          const { error: insE } = await supabase.from('categories').insert({
            client_id: clientId,
            name: acctName,
            sort_order: maxOrder + 10,
            pl_section: section,
            loan_id: loanId,
          })
          linkErr = insE?.message ?? null
        }
      }
    }

    setSaving(false)
    if (linkErr) {
      setFormErr(`Loan saved, but account linking failed: ${linkErr}`)
      load()
      return
    }
    setModal(false)
    load()
  }

  async function deleteLoan(id: string) {
    if (!confirm('Delete this debt record and all its payment records?')) return
    // loan_payments cascades via FK — a manual pre-delete would open a window
    // where payment history is destroyed but the loan survives
    const { error } = await supabase.from('loans').delete().eq('id', id)
    if (error) {
      alert(`Delete failed: ${error.message}`)
      return
    }
    // categories.loan_id is set to NULL by FK ON DELETE SET NULL — account stays in COA
    load()
  }

  const totalOutstanding = loans.reduce((s, l) => s + l.outstanding, 0)
  const totalOriginal = loans.reduce((s, l) => s + l.original_principal, 0)
  // Principal actually repaid = drawn − outstanding; using original − outstanding
  // would count undrawn commitment as "paid down"
  const totalPaid = loans.reduce((s, l) => s + (l.drawn - l.outstanding), 0)

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
    marginBottom: 4,
    display: 'block',
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: D.sage, margin: 0 }}>Debt & Liabilities</h1>
          <p style={{ fontSize: 12, color: D.muted, margin: '3px 0 0' }}>
            Loans, merchant cash advances, lines of credit, and other obligations
          </p>
        </div>
        <button
          onClick={openAdd}
          style={{
            background: D.sage,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Add Debt
        </button>
      </div>

      {/* Summary cards */}
      {loans.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Outstanding', value: fmt(totalOutstanding), color: D.red },
            { label: 'Total Original', value: fmt(totalOriginal), color: D.charcoal },
            { label: 'Paid Down', value: fmt(totalPaid), color: D.green },
          ].map(c => (
            <div
              key={c.label}
              style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, padding: '14px 18px' }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  color: D.muted,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {c.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.color, marginTop: 4 }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ color: D.muted, fontSize: 13 }}>Loading…</div>}
      {error && <div style={{ color: D.red, fontSize: 13 }}>{error}</div>}

      {!loading && loans.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: D.muted }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🏦</div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>No debt obligations yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Add a loan, MCA, line of credit, or other obligation to start tracking payments.
          </div>
        </div>
      )}

      {/* Debt table */}
      {loans.length > 0 && (
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: D.page }}>
                {[
                  'Name',
                  'Lender',
                  'Instrument',
                  'Original',
                  'Outstanding',
                  'Rate / Factor',
                  'Payment',
                  'Term',
                  '',
                ].map(h => (
                  <th
                    key={h}
                    style={{
                      padding: '9px 12px',
                      textAlign: ['Original', 'Outstanding', 'Rate / Factor', 'Payment', ''].includes(h)
                        ? 'right'
                        : 'left',
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
              {loans.map((l, i) => {
                const pct = l.original_principal > 0 ? (l.outstanding / l.original_principal) * 100 : 0
                const isPaidOff = l.outstanding <= 0.01
                const isMca = usesFactorRate(l.instrument_type ?? 'term_loan')
                const isFlatFee = usesFlatFee(l.instrument_type ?? 'term_loan')
                const rateDisplay = isMca
                  ? l.factor_rate
                    ? `${l.factor_rate}x`
                    : '—'
                  : isFlatFee
                    ? l.total_fee != null
                      ? `$${l.total_fee.toLocaleString()} fee`
                      : '—'
                    : l.interest_rate != null
                      ? `${(l.interest_rate * 100).toFixed(2)}%`
                      : '—'
                return (
                  <tr key={l.id} style={{ borderBottom: i < loans.length - 1 ? `1px solid ${D.border}` : 'none' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Link
                          href={`/loans/${l.id}`}
                          style={{ color: D.sage, fontWeight: 600, textDecoration: 'none', fontSize: 13 }}
                        >
                          {l.name}
                        </Link>
                        {isPaidOff && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              background: D.green,
                              color: '#fff',
                              padding: '1px 5px',
                              borderRadius: 3,
                            }}
                          >
                            PAID
                          </span>
                        )}
                      </div>
                      {l.linkedAccount && (
                        <div style={{ fontSize: 10.5, color: D.muted, marginTop: 2 }}>{l.linkedAccount}</div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', color: D.charcoal }}>{l.lender || '—'}</td>
                    <td style={{ padding: '10px 12px', color: D.muted, fontSize: 11.5 }}>
                      {INSTRUMENT_LABELS[l.instrument_type ?? 'term_loan']}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: D.charcoal }}>
                      {fmt(l.original_principal)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <div style={{ color: isPaidOff ? D.green : D.red, fontWeight: 600 }}>{fmt(l.outstanding)}</div>
                      <div
                        style={{
                          height: 3,
                          background: D.border,
                          borderRadius: 2,
                          marginTop: 3,
                          width: 60,
                          marginLeft: 'auto',
                        }}
                      >
                        <div style={{ height: '100%', width: `${100 - pct}%`, background: D.green, borderRadius: 2 }} />
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: D.charcoal, fontSize: 11.5 }}>
                      {rateDisplay}
                      {isMca && l.holdback_pct ? (
                        <div style={{ color: D.muted, fontSize: 10 }}>
                          {(l.holdback_pct * 100).toFixed(0)}% holdback
                        </div>
                      ) : null}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        textAlign: 'right',
                        color: isInformalDebt(l.instrument_type ?? 'term_loan') ? D.muted : D.charcoal,
                      }}
                    >
                      {isInformalDebt(l.instrument_type ?? 'term_loan') ? (
                        <span style={{ fontStyle: 'italic' }}>Irregular</span>
                      ) : (
                        <>
                          {fmt(l.payment_amount)}
                          <span style={{ color: D.muted, fontSize: 10.5 }}>
                            {' '}
                            /{FREQ_LABELS[l.payment_frequency].toLowerCase().slice(0, 2)}
                          </span>
                        </>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: D.muted }}>
                      {l.term_months > 0 ? `${l.term_months}mo` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <button
                        onClick={() => openEdit(l)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: D.steel,
                          fontSize: 11,
                          cursor: 'pointer',
                          marginRight: 8,
                          fontWeight: 500,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteLoan(l.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: D.red,
                          fontSize: 11,
                          cursor: 'pointer',
                          fontWeight: 500,
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Modal */}
      {modal && (
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
            if (e.target === e.currentTarget) setModal(false)
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: '28px 28px 20px',
              width: 580,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: D.sage }}>
              {form.id ? 'Edit Debt Obligation' : 'Add Debt Obligation'}
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
              {/* Instrument type — first, drives conditional fields */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Instrument Type *</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {(Object.entries(INSTRUMENT_LABELS) as [InstrumentType, string][]).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setForm(f => ({ ...f, instrument_type: k }))}
                      style={{
                        padding: '6px 4px',
                        borderRadius: 5,
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: 'pointer',
                        border: `1.5px solid ${form.instrument_type === k ? D.sage : D.border}`,
                        background: form.instrument_type === k ? `${D.sage}12` : '#fff',
                        color: form.instrument_type === k ? D.sage : D.charcoal,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {itype === 'mca' && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: D.muted,
                      background: D.page,
                      padding: '6px 10px',
                      borderRadius: 5,
                    }}
                  >
                    MCA uses a <strong>factor rate</strong> (e.g. 1.35 = repay 135% of advance). Repayment schedule is
                    estimated from payment amount.
                  </div>
                )}
                {itype === 'loc' && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: D.muted,
                      background: D.page,
                      padding: '6px 10px',
                      borderRadius: 5,
                    }}
                  >
                    Line of credit is revolving. Record the current outstanding draw as principal. No fixed amortization
                    schedule.
                  </div>
                )}
                {itype === 'friends_family' && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: D.muted,
                      background: D.page,
                      padding: '6px 10px',
                      borderRadius: 5,
                    }}
                  >
                    Informal personal loan — repayments are typically irregular with no fixed cadence. Payments are
                    tracked via linked bank transactions on the liability account. Interest rate and term are optional.
                  </div>
                )}
                {itype === 'flat_fee' && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: D.muted,
                      background: D.page,
                      padding: '6px 10px',
                      borderRadius: 5,
                    }}
                  >
                    Pre-computed flat fee note — the finance charge is a fixed dollar amount agreed at signing. Fee
                    payments are spread evenly; principal is due as a balloon on the last payment.
                  </div>
                )}
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Name *</label>
                <input
                  style={inp}
                  placeholder={itype === 'mca' ? 'e.g. Kabbage MCA — Jan 2026' : 'e.g. SBA Loan, Equipment Financing'}
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Lender / Provider</label>
                <input
                  style={inp}
                  placeholder="Bank, funder, or creditor name"
                  value={form.lender}
                  onChange={e => setForm(f => ({ ...f, lender: e.target.value }))}
                />
              </div>

              {/* Interest-bearing fields */}
              {showInterestRate && (
                <div>
                  <label style={lbl}>Annual Interest Rate (%)</label>
                  <input
                    style={inp}
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="e.g. 6.5"
                    value={form.interest_rate}
                    onChange={e => setForm(f => ({ ...f, interest_rate: e.target.value }))}
                  />
                </div>
              )}

              {/* Flat fee note: total fixed finance charge */}
              {showTotalFee && (
                <div>
                  <label style={lbl}>Total Fee ($)</label>
                  <input
                    style={inp}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 30000"
                    value={form.total_fee}
                    onChange={e => setForm(f => ({ ...f, total_fee: e.target.value }))}
                  />
                </div>
              )}

              {/* MCA-specific fields */}
              {showFactorRate && (
                <>
                  <div>
                    <label style={lbl}>Factor Rate *</label>
                    <input
                      style={inp}
                      type="number"
                      min="1.001"
                      step="0.001"
                      placeholder="e.g. 1.35"
                      value={form.factor_rate}
                      onChange={e => setForm(f => ({ ...f, factor_rate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={lbl}>
                      Holdback % <span style={{ fontWeight: 400, color: D.muted }}>(of daily sales)</span>
                    </label>
                    <input
                      style={inp}
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder="e.g. 12"
                      value={form.holdback_pct}
                      onChange={e => setForm(f => ({ ...f, holdback_pct: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {showLoanType && (
                <div>
                  <label style={lbl}>Repayment Structure</label>
                  <select
                    style={inp}
                    value={form.loan_type}
                    onChange={e => setForm(f => ({ ...f, loan_type: e.target.value as LoanType }))}
                  >
                    <option value="amortizing">Amortizing</option>
                    <option value="interest_only">Interest Only</option>
                    <option value="balloon">Balloon</option>
                  </select>
                </div>
              )}

              <div>
                <label style={lbl}>{itype === 'mca' ? 'Advance Amount *' : 'Principal Amount *'}</label>
                <input
                  style={inp}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.original_principal}
                  onChange={e => setForm(f => ({ ...f, original_principal: e.target.value }))}
                />
              </div>

              <div>
                <label style={lbl}>Start Date *</label>
                <input
                  style={inp}
                  type="date"
                  value={form.start_date}
                  onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                />
              </div>

              {showScheduleFields && (
                <div>
                  <label style={lbl}>Term (months) {itype === 'mca' ? '(estimated)' : '*'}</label>
                  <input
                    style={inp}
                    type="number"
                    min="1"
                    step="1"
                    placeholder="e.g. 12"
                    value={form.term_months}
                    onChange={e => setForm(f => ({ ...f, term_months: e.target.value }))}
                  />
                </div>
              )}

              {!isInformal && (
                <div>
                  <label style={lbl}>Payment Frequency</label>
                  <select
                    style={inp}
                    value={form.payment_frequency}
                    onChange={e => setForm(f => ({ ...f, payment_frequency: e.target.value as LoanFrequency }))}
                  >
                    {itype === 'mca' && <option value="daily">Daily</option>}
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
              )}

              {!isInformal && (
                <div>
                  <label style={lbl}>{itype === 'mca' ? 'Est. Payment Amount' : 'Payment Amount *'}</label>
                  <input
                    style={inp}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.payment_amount}
                    onChange={e => setForm(f => ({ ...f, payment_amount: e.target.value }))}
                  />
                </div>
              )}

              {showInterestRate && showLoanType && form.loan_type === 'amortizing' && (
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button
                    onClick={calcPayment}
                    style={{
                      background: D.page,
                      border: `1px solid ${D.border}`,
                      color: D.sage,
                      borderRadius: 5,
                      padding: '7px 12px',
                      fontSize: 11.5,
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    ↻ Calculate Payment
                  </button>
                </div>
              )}

              <div>
                <label style={lbl}>Default Rate (% / yr)</label>
                <input
                  style={inp}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 2.5"
                  value={form.default_rate}
                  onChange={e => setForm(f => ({ ...f, default_rate: e.target.value }))}
                />
                <div style={{ fontSize: 10, color: D.muted, marginTop: 3 }}>
                  Rate charged on unpaid balance after maturity
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Notes</label>
                <textarea
                  style={{ ...inp, height: 56, resize: 'vertical' } as React.CSSProperties}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Liability Account</label>
                <select
                  style={inp}
                  value={form.linked_account_id}
                  onChange={e => setForm(f => ({ ...f, linked_account_id: e.target.value }))}
                >
                  <option value="">— Auto-create from loan name —</option>
                  {availableAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 10, color: D.muted, marginTop: 3 }}>
                  {availableAccounts.length === 0
                    ? 'No unlinked liability accounts — a new one will be created.'
                    : 'Select an existing unlinked account, or leave blank to auto-create one named after this loan.'}
                </div>
              </div>
            </div>

            {formErr && <div style={{ color: D.red, fontSize: 12, marginTop: 10 }}>{formErr}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => setModal(false)}
                style={{
                  background: D.page,
                  border: `1px solid ${D.border}`,
                  color: D.charcoal,
                  borderRadius: 5,
                  padding: '8px 16px',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{
                  background: D.sage,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  padding: '8px 20px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
