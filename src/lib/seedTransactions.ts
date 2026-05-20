import { supabase } from '@/lib/supabase'

export const SEED_KEY = 'sandalo_seeded_transactions_v1'

// Maps LEAF categories from the source spreadsheet → COA account names
const CATEGORY_MAP: Record<string, string> = {
  // Advertising
  'Ad - Canva':               'Advertising & Marketing',
  'Ad - Facebook':            'Advertising & Marketing',
  'Ad - Google Ads':          'Advertising & Marketing',
  'Ad - Runway':              'Advertising & Marketing',
  'Ad - Website':             'Advertising & Marketing',
  'Ad -Yelp':                 'Advertising & Marketing',
  'Advertising & Marketing':  'Advertising & Marketing',

  // Software & Subscriptions
  'Alohi Fax Plus':           'Software & Subscriptions',
  'Amazon Music':             'Software & Subscriptions',
  'ChatGPT':                  'Software & Subscriptions',
  'Google Cloud':             'Software & Subscriptions',
  'GSuite':                   'Software & Subscriptions',
  'Simplybook.me':            'Software & Subscriptions',

  // Professional Services
  'Angel Franko':             'Professional Services',
  'Annual Report':            'Professional Services',
  'Legal & Professional Services': 'Professional Services',

  // Business / Office Expenses
  'Bank & Credit Card Fees':  'Business Expenses',
  'Business Expense':         'Business Expenses',
  'Office Expense':           'Business Expenses',
  'USPS':                     'Business Expenses',
  'Security':                 'Security',
  'Water Coffee Delivery':    'Water & Coffee Delivery',
  'Prime Water':              'Water & Coffee Delivery',
  'Primo Water':              'Water & Coffee Delivery',

  // Accounts Payable (credit card payments)
  'CC Payment - Capital One': 'Accounts Payable',
  'CC Payment - Citi':        'Accounts Payable',
  'CC Payment - JPMorgan':    'Accounts Payable',

  // Equipment & Maintenance
  'Equipment':                'Equipment Maintenance',
  'Repairs & Maintenance':    'Equipment Maintenance',

  // Insurance
  'Geiko':                    'Insurance',
  'The Hartford':             'Insurance',

  // Rent
  'Cubesmart':                'Rent & Occupancy',
  'King':                     'Rent & Occupancy',
  'Rent - East Boston':       'Rent & Occupancy',
  'Rent - Winthrop':          'Rent & Occupancy',

  // Utilities
  'Util - Comcast':           'Utilities',
  'Util - Electricity':       'Utilities',
  'Util - T-Mobile':          'Utilities',
  'Util - Ultra Mobile':      'Utilities',
  'Util - Verizon':           'Utilities',
  'Utilities':                'Utilities',

  // Meals
  'Meals Expense':            'Meals & Entertainment',

  // Miscellaneous / Other
  'Duplicate Check':          'Miscellaneous',
  'Misc':                     'Miscellaneous',
  'Other Expense':            'Other Expense',
  'Travel Expense':           'Miscellaneous',
  'Vehicle Expense':          'Vehicle Expense',

  // Refunds
  'Check Refund':             'Refunds & Returns',
  'Refunds':                  'Refunds & Returns',

  // Taxes
  'Taxes':                    'Payroll Taxes',

  // Revenue
  'Misc Revenue':             'Other Income',
  'Other Income':             'Other Income',
  'Revenue - Affirm':         'Service Revenue',
  'Revenue - Cash Deposits':  'Service Revenue',
  'Revenue - Cashapp':        'Service Revenue',
  'Revenue - GoDaddy Deposit':'Service Revenue',
  'Revenue - Groupon':        'Service Revenue',
  'Revenue - Local 26':       'Service Revenue',
  'Revenue - Mobile Check Deposit': 'Service Revenue',
  'Revenue - Square Deposit': 'Service Revenue',
  'Revenue - Venmo':          'Service Revenue',

  // Notes Payable (loans)
  'Loan Disbursement - Diana Marcela Lope Galeano':  'Notes Payable',
  'Loan Disbursement - Jesus Alberto Galeano-Molina':'Notes Payable',
  'Loan Disbursement - Olga Cecilia Galeano Molina': 'Notes Payable',
  'Loan Disbursement - Pevez':                       'Notes Payable — Pevez LLC',
  'Loan Interest - Pevez':                           'Interest Charges',
  'Loan Repayment - Diana Marcela Lope Galeano':     'Notes Payable',
  'Loan Repayment - Horacio Jaramillo':              'Notes Payable',
  'Loan Repayment - Jesus Alberto Galeano-Molina':   'Notes Payable',
  'Loan Repayment - Nissan':                         'Miscellaneous',

  // Equity
  "Owners Draw":              "Owner's Draw",
  "Owners Equity":            "Owner's Equity",
  "Payroll - Alejandro":      "Owner's Draw",

  // Payroll — individual staff sub-accounts
  'Payroll - Astrid Garcia':   'Astrid Garcia',
  'Payroll - Cristina Molina': 'Cristina Molina',
  'Payroll - Danyela Galeano': 'Danyela Galeano',
  'Payroll - Emily Murphy':    'Emily Murphy',
  'Payroll - Maria Mesa':      'Maria Mesa',
  'Payroll - Sandra Puerta':   'Sandra Puerta',
  'Payroll - Sara Orrego':     'Sara Orrego',
  'Payroll - Steven Espinosa': 'Steven Espinosa',
  'Payroll - Wages':           'Wages',
  'Payroll - Yonaira Vergara': 'Yonaira Vergara',
}

interface SeedRow {
  ref: string
  date: string
  desc: string
  origDesc: string
  amount: number
  leafCat: string
  notes: string
}

export async function seedTransactionsOnce(clientId: string): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(SEED_KEY)) return

  const res = await fetch('/seeds/transactions.json')
  if (!res.ok) throw new Error(`Failed to load seed data: ${res.status}`)
  const rows: SeedRow[] = await res.json()

  const records = rows.map(r => ({
    client_id:        clientId,
    transaction_date: r.date,
    description:      r.desc || r.origDesc,
    amount:           r.amount,
    account:          'Checking - 1716',
    category:         CATEGORY_MAP[r.leafCat] ?? null,
    reference_id:     r.ref || null,
  }))

  // Insert in batches of 500
  for (let i = 0; i < records.length; i += 500) {
    await supabase.from('bank_transactions').insert(records.slice(i, i + 500))
  }

  localStorage.setItem(SEED_KEY, '1')
}
