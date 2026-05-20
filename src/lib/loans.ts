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
  return t !== 'mca'
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
  date: string
  payment: number
  principal: number
  interest: number  // "factor cost" for MCAs
  balance: number
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

export function generateAmortizationSchedule(loan: Loan): AmortizationRow[] {
  if (usesFactorRate(loan.instrument_type) && loan.factor_rate) {
    return generateMcaSchedule(loan)
  }
  return generateStandardSchedule(loan)
}

// MCA schedule: each payment splits proportionally by factor rate.
// Every dollar repaid: 1/factor_rate recovers principal, (1 - 1/factor_rate) is factor cost.
function generateMcaSchedule(loan: Loan): AmortizationRow[] {
  const fr = loan.factor_rate!
  const totalOwed = r2(loan.original_principal * fr)
  const principalRatio = 1 / fr  // fraction of each payment that is principal recovery

  const ppy = periodsPerYear(loan.payment_frequency)
  const totalPeriods = loan.term_months > 0
    ? Math.round(loan.term_months * ppy / 12)
    : Math.ceil(totalOwed / loan.payment_amount)

  const rows: AmortizationRow[] = []
  let remaining = totalOwed       // total still owed (principal + factor cost combined)
  let principalBalance = loan.original_principal
  let date = loan.start_date

  for (let i = 1; i <= totalPeriods && remaining > 0.005; i++) {
    const payment = i === totalPeriods ? r2(remaining) : Math.min(loan.payment_amount, remaining)
    const principal = r2(payment * principalRatio)
    const interest = r2(payment - principal)   // factor cost portion
    remaining = r2(remaining - payment)
    principalBalance = r2(Math.max(0, principalBalance - principal))

    rows.push({ period: i, date, payment: r2(payment), principal, interest, balance: principalBalance })
    if (remaining > 0) date = addPeriod(date, loan.payment_frequency)
  }

  return rows
}

function generateStandardSchedule(loan: Loan): AmortizationRow[] {
  const ppy = periodsPerYear(loan.payment_frequency)
  const totalPeriods = Math.round(loan.term_months * ppy / 12)
  const periodicRate = (loan.interest_rate ?? 0) / ppy
  const rows: AmortizationRow[] = []
  let balance = loan.original_principal
  let date = loan.start_date

  for (let i = 1; i <= totalPeriods && balance > 0.005; i++) {
    const interest = r2(balance * periodicRate)
    let payment: number, principal: number
    const isLast = i === totalPeriods || balance - (loan.payment_amount - interest) < 0.005

    if (loan.loan_type === 'interest_only') {
      principal = isLast ? balance : 0
      payment = r2(principal + interest)
    } else if (loan.loan_type === 'balloon' && isLast) {
      principal = balance
      payment = r2(balance + interest)
    } else {
      payment = isLast ? r2(balance + interest) : loan.payment_amount
      principal = r2(Math.min(payment - interest, balance))
    }

    balance = r2(Math.max(0, balance - principal))
    rows.push({ period: i, date, payment, principal, interest, balance })
    if (balance > 0) date = addPeriod(date, loan.payment_frequency)
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
