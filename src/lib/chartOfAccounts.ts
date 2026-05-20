const LS_KEY        = 'sandalo_pl_sections'
const LS_PARENT_KEY = 'sandalo_parents'

export const PL_SECTIONS = [
  'Revenue',
  'Deductions to Income',
  'Cost of Goods Sold',
  'Operating Expenses',
  'Non-Operating Income',
  'Non-Operating Expenses',
]

export const BS_SECTIONS = [
  'Current Assets',
  'Non-Current Assets',
  'Current Liabilities',
  'Non-Current Liabilities',
  'Equity',
]

export const ALL_SECTIONS = [...PL_SECTIONS, ...BS_SECTIONS]

export const isPLSection = (s: string) => PL_SECTIONS.includes(s)
export const isBSSection = (s: string) => BS_SECTIONS.includes(s)

export interface AccountDef {
  name: string
  pl_section: string
  sort_order: number
  parent?: string | null
}

const DEFAULT_PL_ACCOUNTS: AccountDef[] = [
  // Revenue
  { name: 'Service Revenue',                        pl_section: 'Revenue',                sort_order: 10  },
  { name: 'Retail Sales',                           pl_section: 'Revenue',                sort_order: 20  },
  { name: 'Gift Card Redemptions',                  pl_section: 'Revenue',                sort_order: 30  },
  { name: 'Membership Revenue',                     pl_section: 'Revenue',                sort_order: 40  },
  { name: 'Tips Received',                          pl_section: 'Revenue',                sort_order: 50  },
  { name: 'Sales Tax Collected',                    pl_section: 'Revenue',                sort_order: 60  },

  // Deductions to Income
  { name: 'Refunds & Returns',                      pl_section: 'Deductions to Income',   sort_order: 100 },
  { name: 'Discounts & Promotions',                 pl_section: 'Deductions to Income',   sort_order: 110 },

  // Cost of Goods Sold
  { name: 'Retail Cost of Goods',                   pl_section: 'Cost of Goods Sold',     sort_order: 200 },
  { name: 'Massage Supplies',                       pl_section: 'Cost of Goods Sold',     sort_order: 210 },
  { name: 'Skin Care & Facial Products',            pl_section: 'Cost of Goods Sold',     sort_order: 220 },
  { name: 'Linens & Laundry',                       pl_section: 'Cost of Goods Sold',     sort_order: 230 },

  // Operating Expenses
  { name: 'Rent & Occupancy',                       pl_section: 'Operating Expenses',     sort_order: 300 },
  { name: 'Utilities',                              pl_section: 'Operating Expenses',     sort_order: 310 },
  { name: 'Therapist Compensation',                 pl_section: 'Operating Expenses',     sort_order: 320 },
  { name: 'Maria Mesa',                             pl_section: 'Operating Expenses',     sort_order: 321, parent: 'Therapist Compensation' },
  { name: 'Steven Espinosa',                        pl_section: 'Operating Expenses',     sort_order: 322, parent: 'Therapist Compensation' },
  { name: 'Cristina Molina',                        pl_section: 'Operating Expenses',     sort_order: 323, parent: 'Therapist Compensation' },
  { name: 'Yonaira Vergara',                        pl_section: 'Operating Expenses',     sort_order: 324, parent: 'Therapist Compensation' },
  { name: 'Astrid Garcia',                          pl_section: 'Operating Expenses',     sort_order: 325, parent: 'Therapist Compensation' },
  { name: 'Sara Orrego',                            pl_section: 'Operating Expenses',     sort_order: 326, parent: 'Therapist Compensation' },
  { name: 'Emily Murphy',                           pl_section: 'Operating Expenses',     sort_order: 327, parent: 'Therapist Compensation' },
  { name: 'Sandra Puerta',                          pl_section: 'Operating Expenses',     sort_order: 328, parent: 'Therapist Compensation' },
  { name: 'Danyela Galeano',                        pl_section: 'Operating Expenses',     sort_order: 329, parent: 'Therapist Compensation' },
  { name: 'Front Desk Wages',                       pl_section: 'Operating Expenses',     sort_order: 330 },
  { name: 'Wages',                                  pl_section: 'Operating Expenses',     sort_order: 331, parent: 'Front Desk Wages' },
  { name: 'Payroll Taxes',                          pl_section: 'Operating Expenses',     sort_order: 340 },
  { name: "Worker's Compensation",                  pl_section: 'Operating Expenses',     sort_order: 350 },
  { name: 'Square Processing Fees',                 pl_section: 'Operating Expenses',     sort_order: 360 },
  { name: 'Advertising & Marketing',                pl_section: 'Operating Expenses',     sort_order: 370 },
  { name: 'Software & Subscriptions',               pl_section: 'Operating Expenses',     sort_order: 380 },
  { name: 'Insurance',                              pl_section: 'Operating Expenses',     sort_order: 390 },
  { name: 'Equipment Maintenance',                  pl_section: 'Operating Expenses',     sort_order: 400 },
  { name: 'Professional Services',                  pl_section: 'Operating Expenses',     sort_order: 410 },
  { name: 'Continuing Education',                   pl_section: 'Operating Expenses',     sort_order: 420 },
  { name: 'Business Expenses',                      pl_section: 'Operating Expenses',     sort_order: 430 },
  { name: 'Meals & Entertainment',                  pl_section: 'Operating Expenses',     sort_order: 440 },
  { name: 'Miscellaneous',                          pl_section: 'Operating Expenses',     sort_order: 450 },
  { name: 'Security',                               pl_section: 'Operating Expenses',     sort_order: 455 },
  { name: 'Vehicle Expense',                        pl_section: 'Operating Expenses',     sort_order: 456 },
  { name: 'Water & Coffee Delivery',                pl_section: 'Operating Expenses',     sort_order: 457 },
  { name: 'Depreciation - Leasehold Improvements', pl_section: 'Operating Expenses',     sort_order: 460 },
  { name: 'Depreciation - Equipment',              pl_section: 'Operating Expenses',     sort_order: 470 },

  // Non-Operating Income
  { name: 'Interest Income',                        pl_section: 'Non-Operating Income',   sort_order: 500 },
  { name: 'Other Income',                           pl_section: 'Non-Operating Income',   sort_order: 510 },

  // Non-Operating Expenses
  { name: 'Interest Charges',                       pl_section: 'Non-Operating Expenses', sort_order: 600 },
  { name: 'Other Expense',                          pl_section: 'Non-Operating Expenses', sort_order: 610 },
  { name: 'Amortization - Startup Expenses',        pl_section: 'Non-Operating Expenses', sort_order: 620 },
]

const DEFAULT_BS_ACCOUNTS: AccountDef[] = [
  // Current Assets
  { name: 'Cash & Bank Accounts',                              pl_section: 'Current Assets',          sort_order: 700 },
  { name: 'Accounts Receivable',                               pl_section: 'Current Assets',          sort_order: 710 },
  { name: 'Gift Card Asset',                                   pl_section: 'Current Assets',          sort_order: 720 },
  { name: 'Inventory',                                         pl_section: 'Current Assets',          sort_order: 730 },
  { name: 'Prepaid Expenses',                                  pl_section: 'Current Assets',          sort_order: 740 },

  // Non-Current Assets
  { name: 'Leasehold Improvements',                            pl_section: 'Non-Current Assets',      sort_order: 800 },
  { name: 'Massage Equipment',                                 pl_section: 'Non-Current Assets',      sort_order: 810 },
  { name: 'Furniture & Fixtures',                              pl_section: 'Non-Current Assets',      sort_order: 820 },
  { name: 'Accumulated Depreciation - LI',                     pl_section: 'Non-Current Assets',      sort_order: 830 },
  { name: 'Accumulated Depreciation - Equipment',              pl_section: 'Non-Current Assets',      sort_order: 840 },
  { name: 'Security Deposits',                                 pl_section: 'Non-Current Assets',      sort_order: 850 },
  { name: 'Startup Expenses',                                  pl_section: 'Non-Current Assets',      sort_order: 860 },
  { name: 'Accumulated Amortization - Startup Expenses',       pl_section: 'Non-Current Assets',      sort_order: 870 },

  // Current Liabilities
  { name: 'Accounts Payable',                                  pl_section: 'Current Liabilities',     sort_order: 900 },
  { name: 'Notes Payable',                                     pl_section: 'Current Liabilities',     sort_order: 935 },
  { name: 'Notes Payable — Pevez LLC',                         pl_section: 'Current Liabilities',     sort_order: 936, parent: 'Notes Payable' },
  { name: 'Gift Card Liability',                               pl_section: 'Current Liabilities',     sort_order: 910 },
  { name: 'Sales Tax Payable',                                 pl_section: 'Current Liabilities',     sort_order: 920 },
  { name: 'Payroll Liabilities',                               pl_section: 'Current Liabilities',     sort_order: 930 },

  // Non-Current Liabilities
  { name: 'Long-Term Debt',                                    pl_section: 'Non-Current Liabilities', sort_order: 1000 },

  // Equity
  { name: "Owner's Equity",                                    pl_section: 'Equity',                  sort_order: 1100 },
  { name: "Owner's Draw",                                      pl_section: 'Equity',                  sort_order: 1110 },
  { name: 'Additional Paid-in Capital',                        pl_section: 'Equity',                  sort_order: 1120 },
  { name: 'Retained Earnings',                                 pl_section: 'Equity',                  sort_order: 1130 },
]

export const DEFAULT_ACCOUNTS: AccountDef[] = [...DEFAULT_PL_ACCOUNTS, ...DEFAULT_BS_ACCOUNTS]

export function loadPlSections(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') } catch { return {} }
}

export function savePlSection(name: string, pl_section: string): void {
  const map = loadPlSections()
  map[name] = pl_section
  localStorage.setItem(LS_KEY, JSON.stringify(map))
}

export function removePlSection(name: string): void {
  const map = loadPlSections()
  delete map[name]
  localStorage.setItem(LS_KEY, JSON.stringify(map))
}

export function loadParents(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_PARENT_KEY) || '{}') } catch { return {} }
}

export function saveParent(name: string, parentName: string): void {
  const map = loadParents()
  if (parentName) map[name] = parentName
  else delete map[name]
  localStorage.setItem(LS_PARENT_KEY, JSON.stringify(map))
}

export function removeParent(name: string): void {
  const map = loadParents()
  delete map[name]
  localStorage.setItem(LS_PARENT_KEY, JSON.stringify(map))
}

export interface MergedAccount {
  name: string
  sort_order: number
  pl_section: string
  parent: string | null
}

export function mergeAccounts(dbRows: Array<{ name: string; sort_order: number; pl_section?: string | null; parent?: string | null }>): MergedAccount[] {
  return (dbRows || [])
    .map(r => ({
      name:       r.name,
      sort_order: r.sort_order,
      pl_section: r.pl_section ?? 'Operating Expenses',
      parent:     r.parent ?? null,
    }))
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
}

// Legacy — used only by the migration page to read existing localStorage data
export function seedLocalDefaults(): void {}
