export type LoanFrequency = 'monthly' | 'biweekly' | 'weekly' | 'quarterly' | 'daily'
export type LoanType = 'amortizing' | 'interest_only' | 'balloon'

export type InstrumentType =
  | 'term_loan'       // Standard bank term loan
  | 'sba_loan'        // SBA-backed term loan
  | 'equipment_loan'  // Equipment financing
  | 'mca'             // Merchant Cash Advance
  | 'loc'             // Line of Credit (revolving)
  | 'revenue_based'   // Revenue-Based Financing
  | 'flat_fee'        // Pre-computed flat fee loan (e.g. private note with fixed finance charge)
  | 'friends_family'  // Informal personal loan from friends or family
  | 'other'           // Any other debt obligation

export const INSTRUMENT_LABELS: Record<InstrumentType, string> = {
  term_loan:      'Term Loan',
  sba_loan:       'SBA Loan',
  equipment_loan: 'Equipment Financing',
  mca:            'Merchant Cash Advance',
  loc:            'Line of Credit',
  revenue_based:  'Revenue-Based Financing',
  flat_fee:       'Flat Fee Note',
  friends_family: 'Friends & Family',
  other:          'Other',
}

// Instruments that use a traditional interest rate (APR)
export function usesInterestRate(t: InstrumentType): boolean {
  return t !== 'mca' && t !== 'flat_fee'
}

// Instruments that use a factor rate multiplier instead of APR (MCA)
export function usesFactorRate(t: InstrumentType): boolean {
  return t === 'mca'
}

// Instruments with a predictable fixed repayment schedule
export function hasFixedSchedule(t: InstrumentType): boolean {
  return t !== 'loc' && t !== 'other' && t !== 'friends_family'
}

// Instruments where loan_type (amortizing/interest_only/balloon) applies
export function hasLoanType(t: InstrumentType): boolean {
  return t === 'term_loan' || t === 'sba_loan' || t === 'equipment_loan'
}
// flat_fee always uses interest_only schedule (fee-only payments, principal balloon at end)

// Instruments where all fields except name, lender, principal, start date are optional
export function isInformalDebt(t: InstrumentType): boolean {
  return t === 'friends_family' || t === 'other'
}

// Instruments with a pre-computed flat fee (not accruing interest)
export function usesFlatFee(t: InstrumentType): boolean {
  return t === 'flat_fee'
}

export interface Loan {
  id: string
  client_id: string
  name: string
  lender: string
  instrument_type: InstrumentType
  original_principal: number
  // For interest-bearing instruments (APR)
  interest_rate?: number      // annual decimal, e.g. 0.065 for 6.5%
  // For flat fee notes — fixed total finance charge agreed at signing
  total_fee?: number          // dollar amount, e.g. 30000
  // For MCAs and revenue-based financing
  factor_rate?: number        // total repayment multiplier, e.g. 1.35 means repay 135%
  holdback_pct?: number       // % of daily/weekly sales withheld (e.g. 0.12 for 12%)
  start_date: string          // ISO date of first payment
  term_months: number
  payment_amount: number      // scheduled periodic payment (estimated for MCAs)
  payment_frequency: LoanFrequency
  loan_type: LoanType         // only for term_loan, sba_loan, equipment_loan
  balloon_amount?: number
  default_rate?: number        // annual rate charged on unpaid balance after maturity
  notes?: string
}

export interface LoanPayment {
  id: string
  client_id: string
  loan_id: string
  transaction_id?: string     // optional link to bank_transactions row
  payment_date: string
  total_amount: number
  principal_amount: number
  interest_amount: number     // "factor cost" for MCAs
  fees_amount: number
  notes?: string
}

export interface LoanDisbursement {
  id: string
  client_id: string
  loan_id: string
  transaction_id?: string     // optional link to bank_transactions row
  disbursement_date: string
  amount: number
  notes?: string
}

export interface AmortizationRow {
  period: number
  accrualStart: string  // first day of the accrual period
  accrualEnd: string    // last day of the accrual period (day before payment)
  date: string          // payment date
  payment: number
  principal: number
  interest: number  // "factor cost" for MCAs
  balance: number
  isStub?: boolean  // true for the odd first period when draw date precedes first payment date
}

// 30/360 day count: assumes 30 days/month, 360 days/year (US Bond Basis)
export function days30360(d1: string, d2: string): number {
  const [y1, m1, day1] = d1.split('-').map(Number)
  const [y2, m2, day2] = d2.split('-').map(Number)
  const D1 = Math.min(day1, 30)
  const D2 = day1 >= 30 ? Math.min(day2, 30) : day2
  return 360 * (y2 - y1) + 30 * (m2 - m1) + (D2 - D1)
}

export function periodsPerYear(freq: LoanFrequency): number {
  switch (freq) {
    case 'daily':     return 365
    case 'weekly':    return 52
    case 'biweekly':  return 26
    case 'monthly':   return 12
    case 'quarterly': return 4
  }
}

export function addPeriod(dateStr: string, freq: LoanFrequency): string {
  const d = new Date(dateStr + 'T12:00:00')
  switch (freq) {
    case 'daily':     d.setDate(d.getDate() + 1); break
    case 'weekly':    d.setDate(d.getDate() + 7); break
    case 'biweekly':  d.setDate(d.getDate() + 14); break
    case 'monthly':   d.setMonth(d.getMonth() + 1); break
    case 'quarterly': d.setMonth(d.getMonth() + 3); break
  }
  return d.toISOString().slice(0, 10)
}

export function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function subPeriod(dateStr: string, freq: LoanFrequency): string {
  const d = new Date(dateStr + 'T12:00:00')
  switch (freq) {
    case 'daily':     d.setDate(d.getDate() - 1); break
    case 'weekly':    d.setDate(d.getDate() - 7); break
    case 'biweekly':  d.setDate(d.getDate() - 14); break
    case 'monthly':   d.setMonth(d.getMonth() - 1); break
    case 'quarterly': d.setMonth(d.getMonth() - 3); break
  }
  return d.toISOString().slice(0, 10)
}

// Standard amortizing payment formula: P·r / (1 − (1+r)^−n)
export function calcPaymentAmount(
  principal: number,
  annualRate: number,
  termMonths: number,
  freq: LoanFrequency
): number {
  const r = annualRate / periodsPerYear(freq)
  const n = Math.round(termMonths * periodsPerYear(freq) / 12)
  if (r === 0) return r2(principal / n)
  return r2(principal * r / (1 - Math.pow(1 + r, -n)))
}

export function generateAmortizationSchedule(loan: Loan, disbursements?: LoanDisbursement[]): AmortizationRow[] {
  const draws = disbursements && disbursements.length > 0 ? disbursements : null
  if (usesFactorRate(loan.instrument_type) && loan.factor_rate) {
    return generateMcaSchedule(loan, draws)
  }
  return generateStandardSchedule(loan, draws)
}

// MCA schedule: each payment splits proportionally by factor rate.
// Every dollar repaid: 1/factor_rate recovers principal, (1 - 1/factor_rate) is factor cost.
// For MCAs, tranches are uncommon — use total drawn and earliest draw date.
function generateMcaSchedule(loan: Loan, draws: LoanDisbursement[] | null): AmortizationRow[] {
  const fr = loan.factor_rate!
  const basePrincipal = draws ? r2(draws.reduce((s, d) => s + d.amount, 0)) : loan.original_principal
  // With draws: use earliest draw date as accrualStart (advance received = accrual begins).
  // No draws: loan.start_date is first payment date; step back one period for accrualStart.
  const startDate = draws
    ? draws.reduce((min, d) => d.disbursement_date < min ? d.disbursement_date : min, draws[0].disbursement_date)
    : subPeriod(loan.start_date, loan.payment_frequency)
  const totalOwed = r2(basePrincipal * fr)
  const principalRatio = 1 / fr  // fraction of each payment that is principal recovery

  const ppy = periodsPerYear(loan.payment_frequency)
  const totalPeriods = loan.term_months > 0
    ? Math.round(loan.term_months * ppy / 12)
    : Math.ceil(totalOwed / loan.payment_amount)

  const rows: AmortizationRow[] = []
  let remaining = totalOwed       // total still owed (principal + factor cost combined)
  let principalBalance = basePrincipal
  let accrualStart = startDate

  for (let i = 1; i <= totalPeriods && remaining > 0.005; i++) {
    const payment = i === totalPeriods ? r2(remaining) : Math.min(loan.payment_amount, remaining)
    const principal = r2(payment * principalRatio)
    const interest = r2(payment - principal)   // factor cost portion
    remaining = r2(remaining - payment)
    principalBalance = r2(Math.max(0, principalBalance - principal))
    const paymentDate = addPeriod(accrualStart, loan.payment_frequency)
    const accrualEnd = dayBefore(paymentDate)

    rows.push({ period: i, accrualStart, accrualEnd, date: paymentDate, payment: r2(payment), principal, interest, balance: principalBalance })
    accrualStart = paymentDate
  }

  return rows
}

function generateStandardSchedule(loan: Loan, draws: LoanDisbursement[] | null): AmortizationRow[] {
  const ppy = periodsPerYear(loan.payment_frequency)
  const totalPeriods = Math.round(loan.term_months * ppy / 12)

  // Flat fee note: fixed total finance charge spread evenly; principal balloon on last payment.
  if (usesFlatFee(loan.instrument_type) && loan.total_fee != null) {
    const principal = draws ? r2(draws.reduce((s, d) => s + d.amount, 0)) : loan.original_principal
    const perPeriodFee = r2(loan.total_fee / totalPeriods)
    const rows: AmortizationRow[] = []
    let accrualStart = subPeriod(loan.start_date, loan.payment_frequency)
    let feeRemaining = loan.total_fee
    for (let i = 1; i <= totalPeriods; i++) {
      const paymentDate = addPeriod(accrualStart, loan.payment_frequency)
      const accrualEnd = dayBefore(paymentDate)
      const isLast = i === totalPeriods
      const fee = isLast ? r2(feeRemaining) : perPeriodFee
      const princ = isLast ? principal : 0
      const balance = isLast ? 0 : principal
      feeRemaining = r2(feeRemaining - fee)
      rows.push({ period: i, accrualStart, accrualEnd, date: paymentDate, payment: r2(fee + princ), principal: princ, interest: fee, balance })
      accrualStart = paymentDate
    }
    return rows
  }

  const periodicRate = (loan.interest_rate ?? 0) / ppy

  // No draws: loan.start_date is first payment date; pass subPeriod so the schedule
  // preserves that date while computing accrualStart one period earlier.
  if (!draws) {
    return buildScheduleSegment(
      loan.original_principal, subPeriod(loan.start_date, loan.payment_frequency), 1, totalPeriods,
      periodicRate, loan.payment_frequency, loan.loan_type,
    )
  }

  // Multi-tranche: process each draw in date order.
  // Each draw re-amortizes (outstanding balance + draw amount) over the remaining term periods.
  const sortedDraws = [...draws].sort((a, b) => a.disbursement_date.localeCompare(b.disbursement_date))

  // Stub period: if the earliest draw precedes start_date (first payment date), compute
  // 30/360 interest-only for the partial first period. Built separately so the draw
  // loop operates only on regular amortization rows.
  let stubRow: AmortizationRow | null = null
  const earliestDraw = sortedDraws[0]
  if (earliestDraw.disbursement_date < loan.start_date) {
    const drawnAtStub = r2(sortedDraws
      .filter(d => d.disbursement_date <= earliestDraw.disbursement_date)
      .reduce((s, d) => s + d.amount, 0))
    const stubDays = days30360(earliestDraw.disbursement_date, loan.start_date)
    const stubInterest = r2(drawnAtStub * (loan.interest_rate ?? 0) * stubDays / 360)
    stubRow = {
      period: 0,
      accrualStart: earliestDraw.disbursement_date,
      accrualEnd: dayBefore(loan.start_date),
      date: loan.start_date,
      payment: stubInterest,
      principal: 0, interest: stubInterest, balance: drawnAtStub, isStub: true,
    }
  }

  // Regular amortization rows (period 1..N), using start_date as the first payment date
  // when the draw precedes it (so the first segment starts at start_date, not the draw date).
  let rows: AmortizationRow[] = []
  for (const draw of sortedDraws) {
    let splitIdx = -1
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].date <= draw.disbursement_date) { splitIdx = i; break }
    }

    const keptRows = rows.slice(0, splitIdx + 1)
    const balanceAtDraw = splitIdx >= 0 ? keptRows[splitIdx].balance : 0
    const periodsUsed = keptRows.length
    const remainingPeriods = totalPeriods - periodsUsed

    if (remainingPeriods <= 0) break

    // buildScheduleSegment uses startDate as accrualStart of its first row.
    // splitIdx >= 0: last kept row's payment date IS the accrualStart of the next period.
    // first draw, draw < start_date: stub covers draw→start_date; period 1 accrues from start_date.
    // first draw, draw >= start_date: preserve original payment date (draw date) via subPeriod.
    //
    // For pre-start draws, multiple disbursements (e.g. principal + origination fee) all have
    // splitIdx=-1 since every generated payment date is after the draw date. Accumulate the full
    // pre-start total so the second draw doesn't overwrite with just its own amount.
    let newBalance: number
    if (splitIdx >= 0) {
      newBalance = r2(keptRows[splitIdx].balance + draw.amount)
    } else if (draw.disbursement_date < loan.start_date) {
      newBalance = r2(sortedDraws
        .filter(d => d.disbursement_date < loan.start_date)
        .reduce((s, d) => s + d.amount, 0))
    } else {
      newBalance = r2(draw.amount)
    }
    const segmentStartDate = splitIdx >= 0
      ? keptRows[splitIdx].date
      : (draw.disbursement_date < loan.start_date
          ? loan.start_date
          : subPeriod(draw.disbursement_date, loan.payment_frequency))

    rows = [
      ...keptRows,
      ...buildScheduleSegment(
        newBalance, segmentStartDate, periodsUsed + 1, totalPeriods,
        periodicRate, loan.payment_frequency, loan.loan_type,
      ),
    ]
  }

  return stubRow ? [stubRow, ...rows] : rows
}

// Builds amortization rows for a single segment. Payment is calculated from the
// balance and number of remaining periods — not taken from loan.payment_amount.
function buildScheduleSegment(
  balance: number, startDate: string,
  startPeriod: number, endPeriod: number,
  periodicRate: number, freq: LoanFrequency, loanType: LoanType,
): AmortizationRow[] {
  const nPeriods = endPeriod - startPeriod + 1

  // Recalculate payment for this balance and remaining term
  let payment: number
  if (loanType === 'interest_only') {
    payment = r2(balance * periodicRate)  // interest-only; principal balloon at end
  } else if (periodicRate > 0) {
    payment = r2(balance * periodicRate / (1 - Math.pow(1 + periodicRate, -nPeriods)))
  } else {
    payment = r2(balance / nPeriods)
  }

  const rows: AmortizationRow[] = []
  let bal = balance
  let accrualStart = startDate

  for (let i = startPeriod; i <= endPeriod && bal > 0.005; i++) {
    const interest = r2(bal * periodicRate)
    const isLast = i === endPeriod || bal - (payment - interest) < 0.005
    let pmt: number, principal: number

    if (loanType === 'interest_only') {
      principal = isLast ? bal : 0
      pmt = r2(principal + interest)
    } else if (loanType === 'balloon' && isLast) {
      principal = bal
      pmt = r2(bal + interest)
    } else {
      pmt = isLast ? r2(bal + interest) : payment
      principal = r2(Math.min(pmt - interest, bal))
    }

    const paymentDate = addPeriod(accrualStart, freq)
    const accrualEnd = dayBefore(paymentDate)
    bal = r2(Math.max(0, bal - principal))
    rows.push({ period: i, accrualStart, accrualEnd, date: paymentDate, payment: pmt, principal, interest, balance: bal })
    accrualStart = paymentDate
  }

  return rows
}

// Sum of all draws; falls back to original_principal when no disbursements recorded
export function calcTotalDrawn(loan: Loan, disbursements: LoanDisbursement[]): number {
  if (disbursements.length === 0) return loan.original_principal
  return r2(disbursements.reduce((s, d) => s + d.amount, 0))
}

export function calcRemainingToDisburse(loan: Loan, disbursements: LoanDisbursement[]): number {
  if (disbursements.length === 0) return 0
  return r2(Math.max(0, loan.original_principal - calcTotalDrawn(loan, disbursements)))
}

export function calcOutstandingBalance(
  loan: Loan,
  payments: LoanPayment[],
  disbursements?: LoanDisbursement[],
): number {
  const drawn = disbursements ? calcTotalDrawn(loan, disbursements) : loan.original_principal
  const paid = payments.reduce((s, p) => s + p.principal_amount, 0)
  return r2(Math.max(0, drawn - paid))
}

// Suggest a principal / interest (or factor cost) split for a payment
export function suggestPaymentSplit(
  loan: Loan,
  payments: LoanPayment[],
  amount: number,
  disbursements?: LoanDisbursement[],
): { principal: number; interest: number; fees: number } {
  const outstanding = calcOutstandingBalance(loan, payments, disbursements)

  if (usesFactorRate(loan.instrument_type) && loan.factor_rate) {
    // MCA: split proportionally by factor rate
    const principal = r2(Math.min(amount / loan.factor_rate, outstanding))
    const interest = r2(amount - principal)
    return { principal, interest, fees: 0 }
  }

  // Interest-bearing: interest = outstanding * periodic rate
  const periodicRate = (loan.interest_rate ?? 0) / periodsPerYear(loan.payment_frequency)
  const interest = r2(outstanding * periodicRate)
  const principal = r2(Math.min(Math.max(0, amount - interest), outstanding))
  return { principal, interest, fees: r2(Math.max(0, amount - principal - interest)) }
}

// Human-readable label for the "interest" column depending on instrument type
export function costLabel(t: InstrumentType): string {
  if (t === 'mca') return 'Factor Cost'
  if (t === 'flat_fee') return 'Fee'
  return 'Interest'
}

// Total cost of capital (interest + factor cost) a loan will generate over its life
export function totalCostOfCapital(loan: Loan): number {
  const schedule = generateAmortizationSchedule(loan)
  return r2(schedule.reduce((s, row) => s + row.interest, 0))
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}
