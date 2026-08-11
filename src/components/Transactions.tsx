'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { normKey } from '@/lib/merchantClustering'
import CategoryInput from './CategoryInput'
import { ALL_SECTIONS, PL_SECTIONS, BS_SECTIONS, DEFAULT_ACCOUNTS } from '@/lib/chartOfAccounts'
import { seedTransactionsOnce } from '@/lib/seedTransactions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TxnSplit {
  account: string
  amount: number
}

interface Txn {
  id: string
  transaction_date: string
  description: string
  amount: string | number
  category: string | null
  account: string | null
  splits?: TxnSplit[] | null
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

interface CsvData {
  headers: string[]
  rows: Record<string, string>[]
}

function parseCSVText(text: string): CsvData {
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i],
      next = text[i + 1]
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"'
        i++
      } else if (c === '"') inQuotes = false
      else field += c
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        row.push(field.trim())
        field = ''
      } else if (c === '\r' || c === '\n') {
        if (c === '\r' && next === '\n') i++
        row.push(field.trim())
        if (row.some(f => f !== '')) rows.push(row)
        row = []
        field = ''
      } else field += c
    }
  }
  if (field || row.length) {
    row.push(field.trim())
    if (row.some(f => f !== '')) rows.push(row)
  }
  if (!rows.length) return { headers: [], rows: [] }
  const headers = rows[0]
  return { headers, rows: rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) }
}

const DATE_FORMATS = [
  { label: 'MM/DD/YYYY  e.g. 01/31/2024', value: 'MM/DD/YYYY' },
  { label: 'M/D/YYYY    e.g. 1/5/2024', value: 'M/D/YYYY' },
  { label: 'DD/MM/YYYY  e.g. 31/01/2024', value: 'DD/MM/YYYY' },
  { label: 'YYYY-MM-DD  e.g. 2024-01-31', value: 'YYYY-MM-DD' },
  { label: 'MM-DD-YYYY  e.g. 01-31-2024', value: 'MM-DD-YYYY' },
  { label: 'YYYY/MM/DD  e.g. 2024/01/31', value: 'YYYY/MM/DD' },
]

function parseDate(raw: string, fmt: string): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  const sep = fmt.includes('-') ? '-' : '/'
  const parts = s.split(sep)
  if (parts.length !== 3) return null
  let y: string, m: string, d: string
  if (fmt.startsWith('YYYY')) [y, m, d] = parts
  else if (fmt.startsWith('DD')) [d, m, y] = parts
  else [m, d, y] = parts
  m = String(+m).padStart(2, '0')
  d = String(+d).padStart(2, '0')
  if (String(y).length !== 4 || Number.isNaN(+y) || Number.isNaN(+m) || Number.isNaN(+d)) return null
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return null
  return `${y}-${m}-${d}`
}

// Parse a CSV money cell: strips $/commas/spaces and normalizes accounting negatives —
// parens "(500.00)" and trailing minus "500.00-" — before converting. NaN on garbage.
function parseMoney(raw: string): number {
  let s = (raw || '').replace(/[$,\s]/g, '')
  if (!s) return NaN
  if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.slice(1, -1)
  else if (s.endsWith('-')) s = '-' + s.slice(0, -1)
  return s === '' || Number.isNaN(Number(s)) ? NaN : Number(s)
}

interface ParsedRow {
  id?: string
  transaction_date: string
  description: string
  amount: number
  source_account_id?: string
  account?: string
  reference_id?: string
  category?: string
  client_id?: string
}

async function deterministicUUID(
  bankAccount: string,
  date: string,
  amount: number,
  description: string,
): Promise<string> {
  const input = `${bankAccount}|${date}|${amount}|${description}`
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  const b = new Uint8Array(buf).slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = Array.from(b)
    .map(x => x.toString(16).padStart(2, '0'))
    .join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const STANDARD_FIELDS = [
  { key: 'transaction_date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount', required: false },
  { key: 'reference_id', label: 'Reference ID', required: false },
  { key: 'category', label: 'Category', required: false },
]

interface CsvCfg {
  sourceAccountId: string // financial_accounts.id — required for import
  dateFormat: string
  splitAmounts: boolean
  debitsPositive: boolean
  indicatorCol: string
  cols: Record<string, string>
}

const DEFAULT_CFG = (): CsvCfg => ({
  sourceAccountId: '',
  dateFormat: 'MM/DD/YYYY',
  splitAmounts: false,
  debitsPositive: false,
  indicatorCol: '',

  cols: { transaction_date: '', description: '', amount: '', credit: '', debit: '', reference_id: '', category: '' },
})

const LS_KEY_BANKS = 'sandalo_csv_bank_mappings'
const LS_COL_WIDTHS = 'sandalo_txn_col_widths'
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  transaction_date: 100,
  description: 260,
  category: 160,
  account: 200,
  amount: 110,
}
const loadAllMappings = (): Record<string, CsvCfg> => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY_BANKS) || '{}')
  } catch {
    return {}
  }
}
const saveBankMapping = (accountId: string, cfg: CsvCfg) => {
  const all = loadAllMappings()
  all[accountId] = cfg
  localStorage.setItem(LS_KEY_BANKS, JSON.stringify(all))
}

// ─── Transactions Page ────────────────────────────────────────────────────────

const TX_PAGE_SIZE = 100

export default function Transactions({ clientId }: { clientId: string }) {
  const [txns, setTxns] = useState<Txn[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [allCats, setAllCats] = useState<string[]>([])
  const [catSectionMap, setCatSectionMap] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [createModal, setCreateModal] = useState<{
    categoryKey: string
    accountName: string
    txnIds?: string[]
  } | null>(null)
  const [newAccName, setNewAccName] = useState('')
  const [newAccSection, setNewAccSection] = useState('Operating Expenses')
  const [newAccParent, setNewAccParent] = useState('')
  const [savingNewAcc, setSavingNewAcc] = useState(false)

  const [txnFilter, setTxnFilter] = useState<'all' | 'mapped' | 'unmapped'>('all')
  const [txDateFrom, setTxDateFrom] = useState('')
  const [txDateTo, setTxDateTo] = useState('')
  const [txSearch, setTxSearch] = useState('')
  const [txSortCol, setTxSortCol] = useState<'transaction_date' | 'description' | 'category' | 'account' | 'amount'>(
    'transaction_date',
  )
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('desc')
  const [txPage, setTxPage] = useState(1)
  const [txSelected, setTxSelected] = useState(new Set<string>())
  const [deletingTxns, setDeletingTxns] = useState(false)
  const [txEditId, setTxEditId] = useState<string | null>(null)
  const [txEditVal, setTxEditVal] = useState('')
  const [txBulkAccount, setTxBulkAccount] = useState('')
  const [txBulkAssigning, setTxBulkAssigning] = useState(false)
  const [splitModal, setSplitModal] = useState<Txn | null>(null)
  const [splitLines, setSplitLines] = useState<Array<{ account: string; amount: string }>>([])
  const [savingSplit, setSavingSplit] = useState(false)
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(localStorage.getItem(LS_COL_WIDTHS) || '{}') }
    } catch {
      return { ...DEFAULT_COL_WIDTHS }
    }
  })
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      await seedTransactionsOnce(clientId)
      const [txnRes, catRes] = await Promise.all([
        supabase
          .from('bank_transactions')
          .select('id, transaction_date, description, amount, category, account, splits')
          .eq('client_id', clientId)
          .order('id')
          .range(0, 999),
        supabase
          .from('categories')
          .select('name, sort_order, pl_section, parent')
          .eq('client_id', clientId)
          .order('sort_order'),
      ])
      if (txnRes.error) throw txnRes.error

      const first = txnRes.data ?? []

      // Ensure categories table is seeded (may be empty if user hasn't visited Chart of Accounts)
      const catData = catRes.data ?? []
      const existingCatNames = new Set(catData.map((r: { name: string }) => r.name))
      const missingAccts = DEFAULT_ACCOUNTS.filter(a => !existingCatNames.has(a.name))
      if (missingAccts.length) {
        const toSeed = missingAccts.map(a => ({
          client_id: clientId,
          name: a.name,
          sort_order: a.sort_order,
          pl_section: a.pl_section,
          parent: a.parent ?? null,
        }))
        await supabase.from('categories').upsert(toSeed, { onConflict: 'name' })
      }
      const allCatNames = missingAccts.length
        ? [...Array.from(existingCatNames), ...missingAccts.map(a => a.name)]
        : catData.map((r: { name: string }) => r.name)
      setAllCats(allCatNames)
      const sectionMap: Record<string, string> = {}
      catData.forEach((r: { name: string; pl_section?: string | null }) => {
        if (r.pl_section) sectionMap[r.name] = r.pl_section
      })
      missingAccts.forEach(a => {
        sectionMap[a.name] = a.pl_section
      })
      setCatSectionMap(sectionMap)
      setTxns(first)
      setLoading(false)

      let all = first
      if (first.length === 1000) {
        setLoadingMore(true)
        let offset = 1000
        while (true) {
          const res = await supabase
            .from('bank_transactions')
            .select('id, transaction_date, description, amount, category, account, splits')
            .eq('client_id', clientId)
            .order('id')
            .range(offset, offset + 999)
          if (res.error || !res.data?.length) break
          all = [...all, ...res.data]
          setTxns(all)
          if (res.data.length < 1000) break
          offset += 1000
        }
        setLoadingMore(false)
      }
    } catch (e: unknown) {
      setLoadError((e as Error).message)
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const { col, startX, startW } = resizingRef.current
      setColWidths(prev => ({ ...prev, [col]: Math.max(60, startW + e.clientX - startX) }))
    }
    const onUp = () => {
      if (!resizingRef.current) return
      resizingRef.current = null
      setColWidths(prev => {
        localStorage.setItem(LS_COL_WIDTHS, JSON.stringify(prev))
        return prev
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const accountGroups = useMemo(() => {
    const bySection: Record<string, string[]> = {}
    allCats.forEach(name => {
      const sec = catSectionMap[name] ?? 'Operating Expenses'
      if (!bySection[sec]) bySection[sec] = []
      bySection[sec].push(name)
    })
    const ordered = ALL_SECTIONS.filter(s => bySection[s]?.length).map(s => ({ section: s, accounts: bySection[s] }))
    return ordered.length ? ordered : undefined
  }, [allCats, catSectionMap])

  const filteredTxns = useMemo(() => {
    let list = [...txns]
    // Status filter
    switch (txnFilter) {
      case 'mapped':
        list = list.filter(t => !!t.account || (t.splits?.length ?? 0) > 0)
        break
      case 'unmapped':
        list = list.filter(t => !t.account && !(t.splits?.length ?? 0))
        break
    }
    // Date range
    if (txDateFrom) list = list.filter(t => t.transaction_date >= txDateFrom)
    if (txDateTo) list = list.filter(t => t.transaction_date <= txDateTo)
    // Text search
    if (txSearch.trim()) {
      const q = txSearch.trim().toLowerCase()
      list = list.filter(
        t =>
          (t.description || '').toLowerCase().includes(q) ||
          (t.category || '').toLowerCase().includes(q) ||
          (t.account || '').toLowerCase().includes(q) ||
          (t.splits ?? []).some(s => s.account.toLowerCase().includes(q)),
      )
    }
    list.sort((a, b) => {
      let av: string | number, bv: string | number
      switch (txSortCol) {
        case 'transaction_date':
          av = a.transaction_date || ''
          bv = b.transaction_date || ''
          break
        case 'description':
          av = (a.description || '').toLowerCase()
          bv = (b.description || '').toLowerCase()
          break
        case 'category':
          av = (a.category || '').toLowerCase()
          bv = (b.category || '').toLowerCase()
          break
        case 'account':
          av = (a.account || '').toLowerCase()
          bv = (b.account || '').toLowerCase()
          break
        case 'amount':
          av = Number(a.amount)
          bv = Number(b.amount)
          break
        default:
          av = ''
          bv = ''
      }
      if (av < bv) return txSortDir === 'asc' ? -1 : 1
      if (av > bv) return txSortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [txns, txSearch, txSortCol, txSortDir, txnFilter, txDateFrom, txDateTo])

  const createAndApplyAccount = async () => {
    if (!createModal) return
    const name = newAccName.trim()
    if (!name) return
    setSavingNewAcc(true)
    try {
      const maxOrder = allCats.length * 10 + 10
      const { error } = await supabase.from('categories').insert({
        client_id: clientId,
        name,
        sort_order: maxOrder,
        pl_section: newAccSection,
        parent: newAccParent || null,
      })
      if (error) throw error
      setAllCats(prev => [...prev, name])
      if (createModal.txnIds?.length) {
        // Bulk assign to specific transaction IDs (from filter+select)
        const ids = createModal.txnIds
        for (let i = 0; i < ids.length; i += 500) {
          const { error: updateErr } = await supabase
            .from('bank_transactions')
            .update({ account: name })
            .in('id', ids.slice(i, i + 500))
          if (updateErr) throw updateErr
        }
        setTxns(prev => prev.map(t => (ids.includes(t.id) ? { ...t, account: name } : t)))
        setTxSelected(new Set())
        setTxBulkAccount('')
      } else {
        // Assign to all transactions in this category
        const { error: updateErr } = await supabase
          .from('bank_transactions')
          .update({ account: name })
          .eq('category', createModal.categoryKey)
          .eq('client_id', clientId)
        if (updateErr) throw updateErr
        setTxns(prev =>
          prev.map(t =>
            ((t.category as string) || '(uncategorized)') === createModal.categoryKey ? { ...t, account: name } : t,
          ),
        )
      }
      setCreateModal(null)
    } catch (e: unknown) {
      alert('Failed: ' + (e as Error).message)
    } finally {
      setSavingNewAcc(false)
    }
  }

  const bulkAssignAccount = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || !txSelected.size) return
    const ids = [...txSelected]
    if (!allCats.includes(trimmed)) {
      setCreateModal({ categoryKey: '', accountName: trimmed, txnIds: ids })
      setNewAccName(trimmed)
      setNewAccSection('Operating Expenses')
      setNewAccParent('')
      return
    }
    setTxBulkAssigning(true)
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await supabase
          .from('bank_transactions')
          .update({ account: trimmed })
          .in('id', ids.slice(i, i + 500))
        if (error) throw error
      }
      setTxns(prev => prev.map(t => (ids.includes(t.id) ? { ...t, account: trimmed } : t)))
      setTxSelected(new Set())
      setTxBulkAccount('')
    } catch (e: unknown) {
      alert('Assign failed: ' + (e as Error).message)
    } finally {
      setTxBulkAssigning(false)
    }
  }

  const saveTxAccount = async (id: string, name: string) => {
    try {
      const { error } = await supabase.from('bank_transactions').update({ account: name }).eq('id', id)
      if (error) throw error
      setTxns(prev => prev.map(t => (t.id === id ? { ...t, account: name } : t)))
    } catch (e: unknown) {
      alert('Save failed: ' + (e as Error).message)
    } finally {
      setTxEditId(null)
    }
  }

  const deleteTxns = async (ids: string[]) => {
    if (!ids.length) return
    if (!confirm(`Delete ${ids.length} transaction${ids.length !== 1 ? 's' : ''}?`)) return
    setDeletingTxns(true)
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await supabase
          .from('bank_transactions')
          .delete()
          .in('id', ids.slice(i, i + 500))
        if (error) throw error
      }
      setTxns(prev => prev.filter(t => !ids.includes(t.id)))
      setTxSelected(prev => {
        const s = new Set(prev)
        ids.forEach(id => s.delete(id))
        return s
      })
    } catch (e: unknown) {
      alert('Delete failed: ' + (e as Error).message)
    } finally {
      setDeletingTxns(false)
    }
  }

  const openSplitModal = (t: Txn) => {
    setSplitLines(
      t.splits?.length
        ? t.splits.map(s => ({ account: s.account, amount: String(s.amount) }))
        : [
            { account: t.account || '', amount: '' },
            { account: '', amount: '' },
          ],
    )
    setSplitModal(t)
  }

  const saveSplits = async () => {
    if (!splitModal) return
    const lines = splitLines
      .map(l => ({ account: l.account.trim(), amount: parseFloat(l.amount) }))
      .filter(l => l.account && !Number.isNaN(l.amount))
    if (lines.length < 2) {
      alert('Need at least 2 split lines with accounts and amounts')
      return
    }
    setSavingSplit(true)
    try {
      const { error } = await supabase
        .from('bank_transactions')
        .update({ splits: lines, account: null })
        .eq('id', splitModal.id)
      if (error) throw error
      setTxns(prev => prev.map(t => (t.id === splitModal.id ? { ...t, splits: lines, account: null } : t)))
      setSplitModal(null)
    } catch (e: unknown) {
      alert('Save failed: ' + (e as Error).message)
    } finally {
      setSavingSplit(false)
    }
  }

  const clearSplitsOnTxn = async (id: string) => {
    try {
      const { error } = await supabase.from('bank_transactions').update({ splits: null }).eq('id', id)
      if (error) throw error
      setTxns(prev => prev.map(t => (t.id === id ? { ...t, splits: null } : t)))
      setSplitModal(null)
    } catch (e: unknown) {
      alert('Failed: ' + (e as Error).message)
    }
  }

  const deleteAll = async () => {
    if (!confirm(`Permanently delete ALL ${txns.length} transactions? This cannot be undone.`)) return
    const typed = window.prompt('Type DELETE to confirm:')
    if (typed !== 'DELETE') return
    setSaving(true)
    try {
      const { error } = await supabase.from('bank_transactions').delete().eq('client_id', clientId)
      if (error) throw error
      setTxns([])
    } catch (e: unknown) {
      alert('Delete failed: ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <p style={{ color: '#6b7280', marginTop: 16 }}>Loading transactions…</p>
      </div>
    )

  if (loadError)
    return (
      <div style={s.wrap}>
        <div style={{ padding: 28 }}>
          <div style={s.errorBox}>Failed to load: {loadError}</div>
        </div>
      </div>
    )

  const txTotalPages = Math.max(1, Math.ceil(filteredTxns.length / TX_PAGE_SIZE))
  const txPagedTxns = filteredTxns.slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE)
  const txAllPageSel = txPagedTxns.length > 0 && txPagedTxns.every(t => txSelected.has(t.id))
  const toggleTxPageAll = () =>
    setTxSelected(prev => {
      const next = new Set(prev)
      if (txAllPageSel) txPagedTxns.forEach(t => next.delete(t.id))
      else txPagedTxns.forEach(t => next.add(t.id))
      return next
    })
  const toggleTxRow = (id: string) =>
    setTxSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const setTxSort = (col: typeof txSortCol) => {
    if (txSortCol === col) setTxSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setTxSortCol(col)
      setTxSortDir('asc')
      setTxPage(1)
    }
  }

  return (
    <div style={s.wrap}>
      <header style={s.pageHeader}>
        <div>
          <h2 style={s.h2}>Transactions</h2>
          <p style={s.sub}>
            {txns.length} transactions
            {loadingMore && (
              <>
                {' '}
                · <span style={{ color: T.charcoal, opacity: 0.6 }}>loading more…</span>
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {txns.length > 0 && (
            <button style={s.btnDanger} disabled={saving} onClick={deleteAll}>
              Delete All
            </button>
          )}
          <button style={s.btnSecondary} onClick={() => setShowImport(true)}>
            ↑ Import CSV
          </button>
        </div>
      </header>

      <div style={s.content}>
        <div>
          {/* Status filter tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' as const }}>
            {(
              [
                { key: 'all', label: 'All', count: txns.length },
                {
                  key: 'unmapped',
                  label: 'Unmapped',
                  count: txns.filter(t => !t.account && !(t.splits?.length ?? 0)).length,
                },
                {
                  key: 'mapped',
                  label: 'Mapped',
                  count: txns.filter(t => !!t.account || (t.splits?.length ?? 0) > 0).length,
                },
              ] as const
            ).map(f => (
              <button
                key={f.key}
                style={{
                  ...s.tab,
                  ...(txnFilter === f.key ? s.tabActive : {}),
                  display: 'flex',
                  gap: 5,
                  alignItems: 'center' as const,
                }}
                onClick={() => {
                  setTxnFilter(f.key)
                  setTxPage(1)
                  setTxSelected(new Set())
                }}
              >
                {f.label}
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 600,
                    background: txnFilter === f.key ? 'rgba(255,255,255,0.25)' : T.page,
                    color: txnFilter === f.key ? '#fff' : '#9ca3af',
                    borderRadius: 9,
                    padding: '1px 6px',
                    lineHeight: 1.5,
                  }}
                >
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' as const }}>
            <input
              style={{ ...s.input, flex: '1 1 240px', fontSize: 12 }}
              placeholder="Search description, account…"
              value={txSearch}
              onChange={e => {
                setTxSearch(e.target.value)
                setTxPage(1)
                setTxSelected(new Set())
              }}
            />
            <input
              type="date"
              value={txDateFrom}
              onChange={e => {
                setTxDateFrom(e.target.value)
                setTxPage(1)
              }}
              style={{ ...s.input, width: 140, fontSize: 12 }}
              title="From date"
            />
            <span style={{ fontSize: 11, color: T.charcoal, opacity: 0.5 }}>→</span>
            <input
              type="date"
              value={txDateTo}
              onChange={e => {
                setTxDateTo(e.target.value)
                setTxPage(1)
              }}
              style={{ ...s.input, width: 140, fontSize: 12 }}
              title="To date"
            />
            {(txDateFrom || txDateTo) && (
              <button
                style={{ ...s.btnSecondary, fontSize: 11, padding: '4px 8px', flexShrink: 0 }}
                onClick={() => {
                  setTxDateFrom('')
                  setTxDateTo('')
                  setTxPage(1)
                }}
              >
                Clear dates
              </button>
            )}
            <span style={{ fontSize: 11, color: T.charcoal, opacity: 0.6, flexShrink: 0 }}>
              {filteredTxns.length.toLocaleString()} transaction{filteredTxns.length !== 1 ? 's' : ''}
            </span>
            {txSelected.size > 0 && (
              <button
                style={{ ...s.btnDanger, flexShrink: 0, opacity: deletingTxns ? 0.6 : 1 }}
                disabled={deletingTxns}
                onClick={() => deleteTxns([...txSelected])}
              >
                {deletingTxns ? 'Deleting…' : `Delete ${txSelected.size} selected`}
              </button>
            )}
          </div>

          {/* Bulk assign bar */}
          {txSelected.size > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginBottom: 10,
                padding: '8px 12px',
                background: '#f0fdf4',
                border: `1px solid #bbf7d0`,
                borderRadius: 8,
                flexWrap: 'wrap' as const,
              }}
            >
              <span style={{ fontSize: 12, color: T.sage, fontWeight: 600, flexShrink: 0 }}>
                {txSelected.size} selected
              </span>
              <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                <CategoryInput
                  value={txBulkAccount}
                  onChange={setTxBulkAccount}
                  groups={accountGroups}
                  placeholder="Assign account…"
                  onCreate={name => {
                    setCreateModal({ categoryKey: '', accountName: name, txnIds: [...txSelected] })
                    setNewAccName(name)
                    setNewAccSection('Operating Expenses')
                    setNewAccParent('')
                  }}
                />
              </div>
              <button
                style={{ ...s.btnPrimary, flexShrink: 0, opacity: txBulkAssigning || !txBulkAccount.trim() ? 0.6 : 1 }}
                disabled={txBulkAssigning || !txBulkAccount.trim()}
                onClick={() => bulkAssignAccount(txBulkAccount)}
              >
                {txBulkAssigning ? 'Assigning…' : 'Assign'}
              </button>
              <button
                style={{ ...s.btnSecondary, flexShrink: 0 }}
                onClick={() => {
                  setTxSelected(new Set())
                  setTxBulkAccount('')
                }}
              >
                Clear
              </button>
            </div>
          )}

          {/* Table */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflowX: 'auto' }}>
            <table
              style={{
                ...s.table,
                tableLayout: 'fixed',
                width:
                  colWidths.transaction_date +
                  colWidths.description +
                  colWidths.category +
                  colWidths.account +
                  colWidths.amount +
                  68,
              }}
            >
              <thead>
                <tr>
                  <th style={{ ...s.th, width: 32, padding: '7px 8px' }}>
                    <input type="checkbox" checked={txAllPageSel} onChange={toggleTxPageAll} />
                  </th>
                  {[
                    { col: 'transaction_date' as const, label: 'Date' },
                    { col: 'description' as const, label: 'Description' },
                    { col: 'category' as const, label: 'Category' },
                    { col: 'account' as const, label: 'Account' },
                    { col: 'amount' as const, label: 'Amount', right: true },
                  ].map(({ col, label, right }) => (
                    <th
                      key={col}
                      style={{
                        ...s.th,
                        cursor: 'pointer',
                        userSelect: 'none',
                        textAlign: right ? 'right' : 'left',
                        whiteSpace: 'nowrap',
                        position: 'relative',
                        width: colWidths[col],
                      }}
                      onClick={() => setTxSort(col)}
                    >
                      {label}{' '}
                      <span style={{ opacity: txSortCol === col ? 0.75 : 0.25 }}>
                        {txSortCol === col ? (txSortDir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                      <div
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: '15%',
                          bottom: '15%',
                          width: 4,
                          cursor: 'col-resize',
                          zIndex: 1,
                          borderRight: `2px solid rgba(200,169,110,0.35)`,
                          borderRadius: 1,
                        }}
                        onMouseDown={e => {
                          e.stopPropagation()
                          e.preventDefault()
                          resizingRef.current = { col, startX: e.clientX, startW: colWidths[col] }
                        }}
                      />
                    </th>
                  ))}
                  <th style={{ ...s.th, width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {txPagedTxns.map(t => (
                  <tr
                    key={t.id}
                    style={{ background: txSelected.has(t.id) ? '#dceee8' : undefined, cursor: 'pointer' }}
                    onClick={() => toggleTxRow(t.id)}
                  >
                    <td style={{ ...s.td, padding: '5px 8px', width: 32 }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={txSelected.has(t.id)} onChange={() => toggleTxRow(t.id)} />
                    </td>
                    <td
                      style={{
                        ...s.td,
                        padding: '5px 10px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t.transaction_date}
                    </td>
                    <td
                      style={{
                        ...s.td,
                        padding: '5px 10px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t.description || '—'}
                    </td>
                    <td
                      style={{
                        ...s.td,
                        padding: '5px 10px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: t.category ? T.charcoal : '#c0bdb7',
                      }}
                    >
                      {t.category || '—'}
                    </td>
                    <td style={{ ...s.td, padding: '4px 6px' }} onClick={e => e.stopPropagation()}>
                      {t.splits?.length ? (
                        <div onClick={() => openSplitModal(t)} style={{ cursor: 'pointer' }}>
                          {t.splits.map((sp, si) => (
                            <div
                              key={si}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 4,
                                fontSize: 11,
                                lineHeight: 1.6,
                              }}
                            >
                              <span
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  color: T.charcoal,
                                }}
                              >
                                {sp.account}
                              </span>
                              <span
                                style={{
                                  flexShrink: 0,
                                  fontVariantNumeric: 'tabular-nums',
                                  color: sp.amount < 0 ? '#dc2626' : '#16a34a',
                                }}
                              >
                                {sp.amount < 0 ? '−' : '+'}${Math.abs(sp.amount).toFixed(2)}
                              </span>
                            </div>
                          ))}
                          <span style={{ fontSize: 10, color: T.gold }}>Edit splits</span>
                        </div>
                      ) : txEditId === t.id ? (
                        <div
                          tabIndex={-1}
                          onBlur={e => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setTxEditId(null)
                          }}
                        >
                          <CategoryInput
                            value={txEditVal}
                            onChange={v => {
                              setTxEditVal(v)
                              if (allCats.includes(v.trim())) saveTxAccount(t.id, v.trim())
                            }}
                            groups={accountGroups}
                            placeholder="Select account…"
                            onCreate={name => {
                              setCreateModal({
                                categoryKey: (t.category as string) || '',
                                accountName: name,
                                txnIds: [t.id],
                              })
                              setNewAccName(name)
                              setNewAccSection('Operating Expenses')
                              setNewAccParent('')
                              setTxEditId(null)
                            }}
                          />
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <div
                            onClick={() => {
                              setTxEditId(t.id)
                              setTxEditVal(t.account || '')
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            style={{
                              cursor: 'pointer',
                              color: t.account ? T.charcoal : '#c0bdb7',
                              padding: '3px 6px',
                              borderRadius: 4,
                              fontSize: 12,
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.account || '— assign —'}
                          </div>
                          <button
                            title="Split transaction"
                            onClick={() => openSplitModal(t)}
                            style={{
                              flexShrink: 0,
                              background: 'none',
                              border: `1px solid ${T.border}`,
                              borderRadius: 3,
                              cursor: 'pointer',
                              color: '#9ca3af',
                              fontSize: 11,
                              padding: '1px 5px',
                              lineHeight: 1.4,
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.color = T.gold
                              e.currentTarget.style.borderColor = T.gold
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.color = '#9ca3af'
                              e.currentTarget.style.borderColor = T.border
                            }}
                          >
                            ÷
                          </button>
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        ...s.td,
                        padding: '5px 10px',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        color: Number(t.amount) < 0 ? '#dc2626' : '#16a34a',
                      }}
                    >
                      {Number(t.amount) < 0 ? '−' : '+'}$
                      {Math.abs(Number(t.amount)).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td
                      style={{ ...s.td, padding: '4px 8px', width: 36, textAlign: 'center' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        onClick={() => deleteTxns([t.id])}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#c0bdb7',
                          fontSize: 14,
                          padding: '2px 4px',
                          lineHeight: 1,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#c0bdb7')}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {txPagedTxns.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
                      {txSearch ? 'No transactions match that search' : 'No transactions'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {txTotalPages > 1 && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 12, color: T.charcoal }}
            >
              <button
                style={{ ...s.btnSecondary, padding: '4px 12px', opacity: txPage <= 1 ? 0.4 : 1 }}
                disabled={txPage <= 1}
                onClick={() => setTxPage(p => p - 1)}
              >
                ← Prev
              </button>
              <span style={{ color: '#9ca3af' }}>
                Page {txPage} of {txTotalPages}
              </span>
              <button
                style={{ ...s.btnSecondary, padding: '4px 12px', opacity: txPage >= txTotalPages ? 0.4 : 1 }}
                disabled={txPage >= txTotalPages}
                onClick={() => setTxPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>

      {createModal && (
        <div
          style={m.overlay}
          onClick={e => {
            if (e.target === e.currentTarget) setCreateModal(null)
          }}
        >
          <div style={{ ...m.modal, maxWidth: 460 }}>
            <div style={m.head}>
              <h3 style={m.title}>Create New Account</h3>
              <button style={m.closeBtn} onClick={() => setCreateModal(null)}>
                ✕
              </button>
            </div>
            <div style={m.body}>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.5 }}>
                &ldquo;{createModal.accountName}&rdquo; doesn&apos;t exist yet. Create it to apply the mapping.
              </p>
              <IRow label="Account Name">
                <input style={m.input} value={newAccName} onChange={e => setNewAccName(e.target.value)} autoFocus />
              </IRow>
              <IRow label="Section">
                <select
                  style={m.select}
                  value={newAccSection}
                  onChange={e => {
                    setNewAccSection(e.target.value)
                    setNewAccParent('')
                  }}
                >
                  <optgroup label="— P&L —">
                    {PL_SECTIONS.map(sec => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="— Balance Sheet —">
                    {BS_SECTIONS.map(sec => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </IRow>
              <IRow label="Parent (optional)">
                <select style={m.select} value={newAccParent} onChange={e => setNewAccParent(e.target.value)}>
                  <option value="">— none —</option>
                  {allCats
                    .filter(c => catSectionMap[c] === newAccSection)
                    .map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                </select>
              </IRow>
              <div style={m.actions}>
                <button style={m.btnSec} onClick={() => setCreateModal(null)}>
                  Cancel
                </button>
                <button style={m.btnPri} onClick={createAndApplyAccount} disabled={!newAccName.trim() || savingNewAcc}>
                  {savingNewAcc ? 'Creating…' : 'Create & Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {splitModal &&
        (() => {
          const total = Number(splitModal.amount)
          const allocated = splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
          const remaining = parseFloat((total - allocated).toFixed(2))
          const balanced = Math.abs(remaining) < 0.005
          return (
            <div
              style={m.overlay}
              onClick={e => {
                if (e.target === e.currentTarget) setSplitModal(null)
              }}
            >
              <div style={{ ...m.modal, maxWidth: 500 }}>
                <div style={m.head}>
                  <h3 style={m.title}>Split Transaction</h3>
                  <button style={m.closeBtn} onClick={() => setSplitModal(null)}>
                    ✕
                  </button>
                </div>
                <div style={m.body}>
                  <div
                    style={{
                      marginBottom: 16,
                      padding: '10px 12px',
                      background: T.page,
                      borderRadius: 6,
                      fontSize: 12,
                      color: T.charcoal,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        marginBottom: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {splitModal.description}
                    </div>
                    <div style={{ color: '#6b7280' }}>
                      {splitModal.transaction_date} · Total:{' '}
                      <span style={{ fontWeight: 600, color: total < 0 ? '#dc2626' : '#16a34a' }}>
                        {total < 0 ? '−' : '+'}$
                        {Math.abs(total).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>

                  {splitLines.map((line, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <CategoryInput
                          value={line.account}
                          onChange={v =>
                            setSplitLines(prev => prev.map((l, j) => (j === i ? { ...l, account: v } : l)))
                          }
                          groups={accountGroups}
                          placeholder="Select account…"
                        />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        value={line.amount}
                        onChange={e =>
                          setSplitLines(prev => prev.map((l, j) => (j === i ? { ...l, amount: e.target.value } : l)))
                        }
                        placeholder="Amount"
                        style={{ ...m.input, width: 110, textAlign: 'right' as const }}
                      />
                      {splitLines.length > 2 && (
                        <button
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#c0bdb7',
                            fontSize: 14,
                            padding: '2px 4px',
                            lineHeight: 1,
                            flexShrink: 0,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#c0bdb7')}
                          onClick={() => setSplitLines(prev => prev.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    style={{ ...m.btnSec, fontSize: 11, padding: '4px 10px', marginBottom: 14 }}
                    onClick={() => setSplitLines(prev => [...prev, { account: '', amount: '' }])}
                  >
                    + Add line
                  </button>

                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      marginBottom: 4,
                      color: balanced ? '#059669' : remaining === 0 ? '#059669' : '#d97706',
                    }}
                  >
                    Remaining: {remaining < 0 ? '−' : remaining > 0 ? '+' : ''}${Math.abs(remaining).toFixed(2)}
                    {balanced ? ' ✓' : ' — splits must equal the transaction total'}
                  </div>

                  <div style={m.actions}>
                    {(splitModal.splits?.length ?? 0) > 0 && (
                      <button
                        style={{ ...m.btnSec, color: T.danger, borderColor: '#F5C2C2', marginRight: 'auto' }}
                        onClick={() => clearSplitsOnTxn(splitModal.id)}
                      >
                        Clear splits
                      </button>
                    )}
                    <button style={m.btnSec} onClick={() => setSplitModal(null)}>
                      Cancel
                    </button>
                    <button
                      style={{ ...m.btnPri, opacity: !balanced || savingSplit ? 0.5 : 1 }}
                      disabled={!balanced || savingSplit}
                      onClick={saveSplits}
                    >
                      {savingSplit ? 'Saving…' : 'Save splits'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

      {showImport && (
        <ImportModal
          clientId={clientId}
          existingTxns={txns}
          onDone={() => {
            setShowImport(false)
            load()
          }}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}

// ─── Import Modal ─────────────────────────────────────────────────────────────

function autoDetectCols(headers: string[]): Partial<CsvCfg> & { cols: Record<string, string> } {
  const find = (candidates: string[], exclude?: string[]) => {
    const h = headers.map(x => x.toLowerCase().trim())
    for (const c of candidates) {
      const idx = h.findIndex(x => (x === c || x.includes(c)) && !exclude?.some(e => x.includes(e)))
      if (idx >= 0) return headers[idx]
    }
    return ''
  }
  // exclude headers containing both "credit" and "debit" — those are indicator columns, not amount columns
  const credit = find(['cr amount', 'credit amount', 'credit', 'deposits'], ['debit'])
  const debit = find(['db amount', 'debit amount', 'debit', 'withdrawals'], ['credit'])
  const splitAmounts = !!(credit || debit)
  const indicatorCol =
    headers.find(h => {
      const l = h.toLowerCase()
      return l.includes('credit') && l.includes('debit')
    }) ?? ''
  return {
    splitAmounts,
    indicatorCol,
    cols: {
      transaction_date: find(['date', 'posted date', 'posting date', 'transaction date', 'trans date']),
      description: find(['description', 'memo', 'payee', 'narrative', 'details', 'name', 'transaction description']),
      amount: splitAmounts ? '' : find(['amount', 'transaction amount', 'net amount']),
      reference_id: find(['ref num', 'reference', 'ref', 'check number', 'transaction id', 'confirmation']),
      category: find(['category']),
      credit,
      debit,
    },
  }
}

interface ImportModalProps {
  clientId: string
  existingTxns: Txn[]
  onDone: () => void
  onClose: () => void
}

function ImportModal({ clientId, existingTxns, onDone, onClose }: ImportModalProps) {
  const [step, setStep] = useState<string>('upload')
  const [dragOver, setDragOver] = useState(false)
  const [csv, setCsv] = useState<CsvData | null>(null)
  const [cfg, setCfg] = useState<CsvCfg>(DEFAULT_CFG)
  const [mapError, setMapError] = useState('')
  const [parsed, setParsed] = useState<ParsedRow[]>([])
  const [parseErrs, setParseErrs] = useState<Array<{ line: number; msg: string }>>([])
  const [catLoading, setCatLoading] = useState(false)
  const [importRows, setImportRows] = useState<ParsedRow[]>([])
  const [dupeRows, setDupeRows] = useState<ParsedRow[]>([])
  const [showDupes, setShowDupes] = useState(false)
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [result, setResult] = useState<{
    inserted: number
    skipped: number
    errors: string[]
    parseErrors: unknown[]
  } | null>(null)
  const [showInstr, setShowInstr] = useState(false)
  const [catLoadingMsg, setCatLoadingMsg] = useState('')
  const [finAccounts, setFinAccounts] = useState<
    { id: string; name: string; institution: string | null; account_type: string }[]
  >([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase
      .from('financial_accounts')
      .select('id,name,institution,account_type')
      .eq('client_id', clientId ?? '')
      .order('created_at')
      .then(({ data }) => setFinAccounts(data ?? []))
  }, [clientId])

  const handleFile = useCallback((file: File | null | undefined) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setMapError('Please select a .csv file')
      return
    }
    const reader = new FileReader()
    reader.onload = e => {
      let text = String(e.target?.result ?? '').replace(/^﻿/, '')
      const allLines = text.split(/\r?\n/)
      let txnSectionStart = 0
      for (let i = 0; i < allLines.length; i++) {
        const lower = allLines[i].toLowerCase()
        if (lower.includes('date') && lower.includes('description')) txnSectionStart = i
      }
      if (txnSectionStart > 0) text = allLines.slice(txnSectionStart).join('\n')
      const raw = parseCSVText(text)
      if (!raw.headers.length) {
        setMapError('Could not parse CSV — no headers found')
        return
      }
      const data: CsvData = {
        headers: raw.headers,
        rows: raw.rows.filter(r => {
          const firstVal = (Object.values(r)[0] || '').trim()
          return firstVal.toLowerCase() !== 'totals' && !firstVal.includes(' - ')
        }),
      }
      const { cols, splitAmounts, indicatorCol } = autoDetectCols(data.headers)
      const base = DEFAULT_CFG()
      setCsv(data)
      setCfg({
        ...base,
        cols: { ...base.cols, ...cols },
        splitAmounts: splitAmounts ?? false,
        indicatorCol: indicatorCol ?? '',
      })
      setMapError('')
      setStep('mapping')
    }
    reader.readAsText(file)
  }, [])

  const setCol = (key: string, val: string) => {
    setCfg(c => ({ ...c, cols: { ...c.cols, [key]: val } }))
    setMapError('')
  }
  const setProp = (key: keyof CsvCfg, val: unknown) => setCfg(c => ({ ...c, [key]: val }))

  const onApplyMapping = async () => {
    const { cols, dateFormat, splitAmounts, debitsPositive, indicatorCol, sourceAccountId } = cfg
    if (!sourceAccountId) {
      setMapError('Please select a financial account')
      return
    }
    if (!cols.transaction_date) {
      setMapError('Please map the Date column')
      return
    }
    if (!cols.description) {
      setMapError('Please map the Description column')
      return
    }
    if (!splitAmounts && !cols.amount) {
      setMapError('Please map the Amount column')
      return
    }
    if (splitAmounts && !cols.debit && !cols.credit) {
      setMapError('Please map at least one of Debit or Credit')
      return
    }
    setMapError('')
    saveBankMapping(sourceAccountId, cfg)

    // Parse all rows and generate deterministic UUIDs in parallel
    const settled = await Promise.all(
      csv!.rows.map(async (raw, i) => {
        const line = i + 2
        const rawDate = raw[cols.transaction_date] || ''
        const date = parseDate(rawDate, dateFormat)
        if (!date) return { error: { line, msg: `Invalid date "${rawDate}"` } }
        const rawDesc = (raw[cols.description] || '').trim()
        if (!rawDesc) return { error: { line, msg: 'Empty description' } }
        let amount: number
        if (splitAmounts) {
          const rawCredit = (raw[cols.credit] || '').trim()
          const rawDebit = (raw[cols.debit] || '').trim()
          const credit = rawCredit ? parseMoney(rawCredit) : 0
          const debit = rawDebit ? parseMoney(rawDebit) : 0
          // A malformed cell must be a parse error, not a silent 0 — `|| 0` here
          // imported parens-negative debits as $0 transactions
          if (Number.isNaN(credit)) return { error: { line, msg: `Invalid credit "${raw[cols.credit]}"` } }
          if (Number.isNaN(debit)) return { error: { line, msg: `Invalid debit "${raw[cols.debit]}"` } }
          amount = credit - debit
        } else {
          amount = parseMoney(raw[cols.amount] || '')
          if (Number.isNaN(amount)) return { error: { line, msg: `Invalid amount "${raw[cols.amount]}"` } }
          if (debitsPositive) amount = -amount
          if (indicatorCol && raw[indicatorCol]) {
            const ind = (raw[indicatorCol] || '').toLowerCase().trim()
            if (ind === 'debit' || ind === 'dr') amount = -Math.abs(amount)
            else if (ind === 'credit' || ind === 'cr') amount = Math.abs(amount)
          }
        }
        const id = await deterministicUUID(sourceAccountId, date, amount, rawDesc)
        return {
          row: {
            id,
            transaction_date: date,
            description: rawDesc,
            amount,
            source_account_id: sourceAccountId,
            ...(cols.reference_id && raw[cols.reference_id] ? { reference_id: raw[cols.reference_id].trim() } : {}),
            ...(cols.category && raw[cols.category] ? { category: raw[cols.category].trim() } : {}),
            ...(clientId !== null ? { client_id: clientId } : {}),
          } as ParsedRow,
        }
      }),
    )
    const errors = settled.filter(r => 'error' in r).map(r => (r as { error: { line: number; msg: string } }).error)
    const rows = settled.filter(r => 'row' in r).map(r => (r as { row: ParsedRow }).row)
    setParsed(rows)
    setParseErrs(errors)
    setStep('categorize')
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: upload pipeline runs once per step transition by design
  useEffect(() => {
    if (step !== 'categorize') return
    let cancelled = false
    const run = async () => {
      setCatLoading(true)
      try {
        // Build category suggestion map from in-memory transactions (used for suggestions only)
        const descCatMap: Record<string, string> = {}
        existingTxns.forEach(r => {
          if (r.category) {
            const k = normKey(r.description)
            if (k && !descCatMap[k]) descCatMap[k] = r.category
          }
        })
        if (cancelled) return

        // Deduplicate within the CSV itself (same row appearing twice)
        const seenIds = new Set<string>()
        const uniqueParsed: ParsedRow[] = [],
          withinCsvDupes: ParsedRow[] = []
        parsed.forEach(row => {
          if (seenIds.has(row.id!)) {
            withinCsvDupes.push(row)
            return
          }
          seenIds.add(row.id!)
          uniqueParsed.push(row)
        })

        // Upload all unique rows in parallel batches.
        // select('id') returns only rows actually inserted (ON CONFLICT DO NOTHING RETURNING *),
        // giving us accurate new-vs-duplicate counts without a separate check query.
        setCatLoadingMsg('Uploading transactions…')
        const uploadBatches: ParsedRow[][] = []
        for (let i = 0; i < uniqueParsed.length; i += 500) uploadBatches.push(uniqueParsed.slice(i, i + 500))
        const uploadResults =
          uniqueParsed.length > 0
            ? await Promise.all(
                uploadBatches.map(batch =>
                  supabase
                    .from('bank_transactions')
                    .upsert(batch, { onConflict: 'id', ignoreDuplicates: true })
                    .select('id'),
                ),
              )
            : []
        if (cancelled) return

        const insertedIds = new Set<string>()
        uploadResults.forEach(({ data, error }) => {
          if (error) return
          data?.forEach(r => insertedIds.add(r.id))
        })

        const newRows = uniqueParsed.filter(r => insertedIds.has(r.id!))
        const dupes = [...withinCsvDupes, ...uniqueParsed.filter(r => !insertedIds.has(r.id!))]

        const errs = uploadResults.filter(r => r.error).map(r => r.error!.message)
        if (!cancelled) {
          setImportRows(newRows)
          setDupeRows(dupes)
          setUploadErrors(errs)
        }
      } catch (e: unknown) {
        alert('Error: ' + (e as Error).message)
        setStep('mapping')
      } finally {
        if (!cancelled) {
          setCatLoading(false)
          setCatLoadingMsg('')
        }
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [step])

  const colOptions = csv
    ? csv.headers.map(h => (
        <option key={h} value={h}>
          {h}
        </option>
      ))
    : []

  return (
    <div
      style={m.overlay}
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={m.modal}>
        <div style={m.head}>
          <h3 style={m.title}>
            {step === 'upload' && 'Import CSV'}
            {step === 'mapping' && 'Map Columns'}
            {step === 'categorize' && 'Preview & Categorize'}
            {step === 'uploading' && 'Uploading…'}
            {step === 'result' && 'Import Complete'}
          </h3>
          <button style={m.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={m.body}>
          {step === 'upload' && (
            <div>
              <div
                style={{ ...m.dropzone, ...(dragOver ? m.dropzoneOn : {}) }}
                onDrop={e => {
                  e.preventDefault()
                  setDragOver(false)
                  handleFile(e.dataTransfer.files[0])
                }}
                onDragOver={e => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileRef.current!.click()}
              >
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={T.gold}
                  strokeWidth={1.25}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginBottom: 14 }}
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="11" x2="12" y2="17" />
                  <polyline points="9 14 12 11 15 14" />
                </svg>
                <p style={{ fontSize: 14, margin: '0 0 5px', color: T.sage, fontWeight: 500 }}>
                  Drag &amp; drop a CSV file, or <strong>click to browse</strong>
                </p>
                <p style={{ fontSize: 11, color: T.charcoal, margin: 0, opacity: 0.7 }}>
                  Supports most bank CSV exports — column mapping happens next
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  style={{ display: 'none' }}
                  onChange={e => handleFile(e.target.files?.[0])}
                />
              </div>

              <div style={m.instrWrap}>
                <button style={m.instrToggle} onClick={() => setShowInstr(v => !v)}>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ marginRight: 5, flexShrink: 0 }}
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  How to download your bank statement
                  <span style={{ marginLeft: 'auto', fontSize: 11 }}>{showInstr ? '▲' : '▼'}</span>
                </button>
                {showInstr && (
                  <div style={m.instrBody}>
                    <p style={m.instrTitle}>Most banks</p>
                    <ol style={m.instrList}>
                      <li>Log in to your bank&apos;s online portal</li>
                      <li>Navigate to your account activity or transaction history</li>
                      <li>
                        Look for an <strong>Export</strong> or <strong>Download</strong> option
                      </li>
                      <li>
                        Select <strong>CSV</strong> format and your desired date range, then download
                      </li>
                      <li>Upload the file here — you&apos;ll map the columns in the next step</li>
                    </ol>
                    <p style={{ fontSize: 12, color: '#9ca3af', margin: '8px 0 0' }}>
                      The system automatically detects most formats. If columns aren&apos;t mapped correctly you can
                      adjust them manually.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'mapping' && csv && (
            <div>
              <p style={m.sub}>
                {csv.rows.length} rows · columns: <em>{csv.headers.join(', ')}</em>
              </p>
              <ISection title="Account">
                <IRow
                  label={
                    <>
                      Financial account <span style={{ color: '#dc2626', fontWeight: 700 }}>*</span>
                    </>
                  }
                >
                  {finAccounts.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#dc2626' }}>
                      No accounts set up.{' '}
                      <a href="/accounts" target="_blank" style={{ color: '#2C5F52' }} rel="noopener">
                        Add one on the Accounts page
                      </a>
                      , then re-open this dialog.
                    </div>
                  ) : (
                    <select
                      style={m.select}
                      value={cfg.sourceAccountId}
                      onChange={e => {
                        const id = e.target.value
                        const saved = loadAllMappings()[id]
                        if (saved) {
                          const { indicatorCol: auto } = csv ? autoDetectCols(csv.headers) : { indicatorCol: '' }
                          setCfg({
                            ...DEFAULT_CFG(),
                            ...saved,
                            indicatorCol: saved.indicatorCol ?? auto ?? '',
                            sourceAccountId: id,
                          })
                        } else {
                          setProp('sourceAccountId', id)
                        }
                      }}
                    >
                      <option value="">— Select account —</option>
                      {finAccounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.institution ? ` (${a.institution})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </IRow>
              </ISection>

              <ISection title="Map CSV Columns">
                {STANDARD_FIELDS.filter(f => !(cfg.splitAmounts && f.key === 'amount')).map(f => {
                  const req =
                    f.key === 'transaction_date' || f.key === 'description' || (f.key === 'amount' && !cfg.splitAmounts)
                  return (
                    <IRow
                      key={f.key}
                      label={
                        <>
                          {f.label}
                          {req && <span style={{ color: '#dc2626' }}> *</span>}
                        </>
                      }
                    >
                      <select style={m.select} value={cfg.cols[f.key]} onChange={e => setCol(f.key, e.target.value)}>
                        <option value="">— not mapped —</option>
                        {colOptions}
                      </select>
                    </IRow>
                  )
                })}
              </ISection>

              <ISection title="Date Format">
                <IRow
                  label={
                    <>
                      Format<span style={{ color: '#dc2626' }}> *</span>
                    </>
                  }
                >
                  <select style={m.select} value={cfg.dateFormat} onChange={e => setProp('dateFormat', e.target.value)}>
                    {DATE_FORMATS.map(f => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </IRow>
                {cfg.cols.transaction_date && csv.rows[0] && (
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0 232px' }}>
                    Preview: &quot;{csv.rows[0][cfg.cols.transaction_date]}&quot; →{' '}
                    <strong>{parseDate(csv.rows[0][cfg.cols.transaction_date], cfg.dateFormat) || '⚠ invalid'}</strong>
                  </p>
                )}
              </ISection>

              <ISection title="Amount Handling">
                <IRow label="Split debit / credit columns">
                  <input
                    type="checkbox"
                    checked={cfg.splitAmounts}
                    onChange={e => setProp('splitAmounts', e.target.checked)}
                  />
                </IRow>
                {cfg.splitAmounts ? (
                  <>
                    <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 232px' }}>Net = credit − debit</p>
                    <IRow label="Credit column (money in)">
                      <select style={m.select} value={cfg.cols.credit} onChange={e => setCol('credit', e.target.value)}>
                        <option value="">— not mapped —</option>
                        {colOptions}
                      </select>
                    </IRow>
                    <IRow label="Debit column (money out)">
                      <select style={m.select} value={cfg.cols.debit} onChange={e => setCol('debit', e.target.value)}>
                        <option value="">— not mapped —</option>
                        {colOptions}
                      </select>
                    </IRow>
                  </>
                ) : (
                  <>
                    <IRow label="Debits shown as positive numbers">
                      <input
                        type="checkbox"
                        checked={cfg.debitsPositive}
                        onChange={e => setProp('debitsPositive', e.target.checked)}
                      />
                    </IRow>
                    <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 232px' }}>
                      Sign will be flipped if enabled.
                    </p>
                    <IRow label="Debit/credit indicator column">
                      <select
                        style={m.select}
                        value={cfg.indicatorCol}
                        onChange={e => setProp('indicatorCol', e.target.value)}
                      >
                        <option value="">— not mapped —</option>
                        {colOptions}
                      </select>
                    </IRow>
                    <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 0 232px' }}>
                      Column containing &quot;Debit&quot; / &quot;Credit&quot; text. Overrides sign flip above.
                    </p>
                  </>
                )}
              </ISection>

              {mapError && <div style={{ ...m.errBox, marginTop: 12 }}>{mapError}</div>}
              <div style={m.actions}>
                <button style={m.btnSec} onClick={() => setStep('upload')}>
                  ← Back
                </button>
                <button style={m.btnPri} onClick={onApplyMapping}>
                  Continue →
                </button>
              </div>
            </div>
          )}

          {step === 'categorize' && (
            <div>
              {catLoading ? (
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                  <div style={m.spinner} />
                  <p style={{ color: '#6b7280', marginTop: 12 }}>{catLoadingMsg || 'Uploading…'}</p>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <StatCard label="Imported" value={importRows.length} color="#2563eb" />
                    <StatCard label="Duplicates" value={dupeRows.length} color="#d97706" />
                    <StatCard
                      label="Parse errors"
                      value={parseErrs.length}
                      color={parseErrs.length ? '#dc2626' : '#9ca3af'}
                    />
                  </div>

                  {(uploadErrors.length > 0 || parseErrs.length > 0) && (
                    <div style={m.errBox}>
                      {parseErrs.length > 0 && (
                        <>
                          <strong>{parseErrs.length} row(s) could not be parsed:</strong>
                          <ul style={{ margin: '6px 0 8px', paddingLeft: 20 }}>
                            {parseErrs.slice(0, 5).map((e, i) => (
                              <li key={i}>
                                Line {e.line}: {e.msg}
                              </li>
                            ))}
                            {parseErrs.length > 5 && <li>…and {parseErrs.length - 5} more</li>}
                          </ul>
                        </>
                      )}
                      {uploadErrors.length > 0 && (
                        <>
                          <strong>Upload errors:</strong>
                          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                            {uploadErrors.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}

                  {/* New transactions */}
                  {importRows.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: T.gold,
                          textTransform: 'uppercase' as const,
                          letterSpacing: '.06em',
                          margin: '0 0 6px',
                        }}
                      >
                        New transactions — {importRows.length}
                      </p>
                      <div
                        style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflowY: 'auto', maxHeight: 280 }}
                      >
                        <table style={m.table}>
                          <thead>
                            <tr>
                              <th style={m.th}>Date</th>
                              <th style={m.th}>Description</th>
                              <th style={{ ...m.th, textAlign: 'right' }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importRows.map((r, i) => (
                              <tr key={r.id} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                                <td style={{ ...m.td, whiteSpace: 'nowrap' }}>{r.transaction_date}</td>
                                <td
                                  style={{
                                    ...m.td,
                                    maxWidth: 340,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {r.description}
                                </td>
                                <td
                                  style={{
                                    ...m.td,
                                    textAlign: 'right',
                                    fontVariantNumeric: 'tabular-nums',
                                    color: r.amount < 0 ? '#dc2626' : '#16a34a',
                                  }}
                                >
                                  {r.amount < 0 ? '−' : '+'}${Math.abs(r.amount).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {importRows.length === 0 && (
                    <p style={{ color: '#6b7280', fontSize: 14, padding: '8px 0 16px' }}>
                      All rows already exist — nothing new was imported.
                    </p>
                  )}

                  {/* Duplicates — collapsible */}
                  {dupeRows.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <button
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#d97706',
                          textTransform: 'uppercase' as const,
                          letterSpacing: '.06em',
                        }}
                        onClick={() => setShowDupes(v => !v)}
                      >
                        {showDupes ? '▲' : '▼'} Duplicates skipped — {dupeRows.length} (click to review)
                      </button>
                      {showDupes && (
                        <div
                          style={{
                            border: `1px solid ${T.border}`,
                            borderRadius: 6,
                            overflowY: 'auto',
                            maxHeight: 220,
                            marginTop: 6,
                          }}
                        >
                          <table style={m.table}>
                            <thead>
                              <tr>
                                <th style={m.th}>Date</th>
                                <th style={m.th}>Description</th>
                                <th style={{ ...m.th, textAlign: 'right' }}>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dupeRows.map((r, i) => (
                                <tr key={r.id || i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                                  <td style={{ ...m.td, whiteSpace: 'nowrap' }}>{r.transaction_date}</td>
                                  <td
                                    style={{
                                      ...m.td,
                                      maxWidth: 340,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {r.description}
                                  </td>
                                  <td
                                    style={{
                                      ...m.td,
                                      textAlign: 'right',
                                      fontVariantNumeric: 'tabular-nums',
                                      color: r.amount < 0 ? '#dc2626' : '#16a34a',
                                    }}
                                  >
                                    {r.amount < 0 ? '−' : '+'}${Math.abs(r.amount).toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={m.actions}>
                    <button style={m.btnSec} onClick={() => setStep('mapping')}>
                      ← Back
                    </button>
                    <button
                      style={m.btnPri}
                      onClick={() => {
                        setResult({
                          inserted: importRows.length,
                          skipped: dupeRows.length,
                          errors: uploadErrors,
                          parseErrors: parseErrs,
                        })
                        setStep('result')
                      }}
                    >
                      Done →
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'uploading' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={m.spinner} />
              <p style={{ color: '#6b7280', marginTop: 16 }}>Uploading transactions…</p>
            </div>
          )}

          {step === 'result' && result && (
            <div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <StatCard label="Imported" value={result.inserted} color="#16a34a" />
                <StatCard label="Duplicates" value={result.skipped} color="#d97706" />
                <StatCard label="Parse errors" value={(result.parseErrors as unknown[])?.length ?? 0} color="#9ca3af" />
                <StatCard
                  label="Insert errors"
                  value={result.errors.length}
                  color={result.errors.length ? '#dc2626' : '#9ca3af'}
                />
              </div>
              {result.errors.length > 0 && (
                <div style={m.errBox}>
                  <strong>Insert errors:</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                    {result.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div style={m.actions}>
                <button style={m.btnPri} onClick={onDone}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Import sub-components ────────────────────────────────────────────────────

function ISection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 12,
      }}
    >
      <h4
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#374151',
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          margin: '0 0 10px',
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  )
}

function IRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, minHeight: 34 }}>
      <label style={{ minWidth: 220, fontSize: 13, fontWeight: 500, color: '#374151', flexShrink: 0 }}>{label}</label>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        flex: '1 1 100px',
        minWidth: 100,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderTop: `3px solid ${color}`,
        borderRadius: 8,
        padding: '12px 14px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  )
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  card: '#FAFAF8',
  border: '#D9D4C8',
  success: '#059669',
  danger: '#DC2626',
  amber: '#D97706',
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  wrap: { width: '100%', background: T.page, minHeight: '100%' },
  pageHeader: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    padding: '14px 28px',
    background: T.card,
    borderBottom: `1px solid ${T.border}`,
  },
  h2: { fontSize: 14, fontWeight: 600, color: T.sage, margin: '0 0 2px' },
  sub: { fontSize: 11, color: 'rgba(74,74,63,0.65)', margin: 0 },
  savedMsg: { fontSize: 11, color: T.success, fontWeight: 500 },
  center: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: 300,
    background: T.page,
  },
  spinner: {
    width: 28,
    height: 28,
    border: `2px solid ${T.border}`,
    borderTopColor: T.sage,
    borderRadius: '50%',
    animation: 'spin .7s linear infinite',
  },
  errorBox: {
    background: '#FDE8E8',
    border: '1px solid #F5C2C2',
    borderRadius: 6,
    padding: '10px 14px',
    fontSize: 11,
    color: '#991B1B',
    marginBottom: 14,
  },
  content: { padding: '20px 28px' },
  toolbar: {
    display: 'flex' as const,
    gap: 8,
    alignItems: 'center' as const,
    marginBottom: 14,
    flexWrap: 'wrap' as const,
  },
  input: {
    padding: '5px 9px',
    border: `1px solid ${T.border}`,
    borderRadius: 5,
    fontSize: 11,
    color: T.charcoal,
    background: '#fff',
    outline: 'none',
  },
  tabs: { display: 'flex' as const, gap: 2 },
  tab: {
    padding: '5px 12px',
    border: `1px solid ${T.border}`,
    borderRadius: 5,
    background: '#fff',
    fontSize: 11,
    color: T.charcoal,
    cursor: 'pointer',
    fontWeight: 400,
  },
  tabActive: { background: T.sage, color: '#fff', borderColor: T.sage, fontWeight: 500 },
  fuzzyLabel: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    fontSize: 11,
    color: T.charcoal,
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  bulkBar: {
    display: 'flex' as const,
    gap: 8,
    alignItems: 'center' as const,
    background: '#E8F0EE',
    border: '1px solid #B8D4CC',
    borderRadius: 6,
    padding: '8px 12px',
    marginBottom: 12,
    flexWrap: 'wrap' as const,
  },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    background: T.page,
    padding: '7px 10px',
    textAlign: 'left' as const,
    fontWeight: 700,
    borderBottom: `2px solid ${T.border}`,
    fontSize: 9.5,
    color: T.gold,
    textTransform: 'uppercase' as const,
    letterSpacing: '.06em',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '7px 10px',
    borderBottom: `1px solid ${T.border}`,
    verticalAlign: 'middle' as const,
    fontSize: 12,
    color: T.charcoal,
  },
  dirtyDot: {
    flexShrink: 0,
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: T.sage,
    display: 'inline-block' as const,
  },
  sepTag: {
    flexShrink: 0,
    fontSize: 9.5,
    color: '#9ca3af',
    background: T.page,
    border: `1px solid ${T.border}`,
    borderRadius: 3,
    padding: '1px 5px',
  },
  badge: {
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 500,
    color: '#4A7B6A',
    background: '#E8F0EE',
    borderRadius: 3,
    padding: '1px 6px',
    whiteSpace: 'nowrap' as const,
    cursor: 'default',
  },
  suggRow: { display: 'flex' as const, alignItems: 'center' as const, gap: 5, marginBottom: 4 },
  suggDot: {
    flexShrink: 0,
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: T.gold,
    display: 'inline-block' as const,
  },
  suggLabel: {
    fontSize: 11,
    color: T.gold,
    fontWeight: 500,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  acceptBtn: {
    flexShrink: 0,
    padding: '1px 7px',
    background: '#E6F0E9',
    color: '#047857',
    border: '1px solid #B8D4BE',
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  rejectBtn: {
    flexShrink: 0,
    padding: '1px 5px',
    background: '#FDE8E8',
    color: T.danger,
    border: '1px solid #F5C2C2',
    borderRadius: 3,
    fontSize: 11,
    cursor: 'pointer',
  },
  expandBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#9ca3af',
    fontSize: 10,
    padding: '2px 5px',
    lineHeight: 1,
  },
  separateBtn: {
    padding: '2px 8px',
    background: '#FEF3C7',
    color: '#92400E',
    border: '1px solid #FCD34D',
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 500,
    cursor: 'pointer',
  },
  rejoinBtn: {
    padding: '2px 8px',
    background: '#E8F0EE',
    color: T.sage,
    border: `1px solid #B8D4CC`,
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 500,
    cursor: 'pointer',
  },
  pager: {
    display: 'flex' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 14,
    marginTop: 20,
  },
  btnPrimary: {
    padding: '6px 16px',
    background: T.sage,
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnSecondary: {
    padding: '6px 14px',
    background: '#fff',
    color: T.charcoal,
    border: `1px solid ${T.border}`,
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnOutline: {
    padding: '6px 14px',
    background: 'transparent',
    color: T.gold,
    border: `1px solid ${T.gold}`,
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnDisabled: { opacity: 0.45, cursor: 'not-allowed' as const },
  btnDanger: {
    padding: '6px 14px',
    background: '#FDE8E8',
    color: T.danger,
    border: '1px solid #F5C2C2',
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  },
  unbundleBtn: {
    fontSize: 11,
    padding: '1px 5px',
    background: 'none',
    border: `1px solid ${T.border}`,
    borderRadius: 3,
    cursor: 'pointer',
    color: '#6b7280',
    lineHeight: 1.4,
  },
}

const m = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(44,95,82,.4)',
    display: 'flex' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'center' as const,
    zIndex: 1000,
    padding: '40px 16px',
    overflowY: 'auto' as const,
  },
  modal: {
    background: '#fff',
    borderRadius: 8,
    width: '100%',
    maxWidth: 800,
    boxShadow: '0 20px 60px rgba(0,0,0,.18)',
    display: 'flex' as const,
    flexDirection: 'column' as const,
  },
  head: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: '14px 20px',
    borderBottom: `1px solid ${T.border}`,
  },
  title: { fontSize: 14, fontWeight: 600, color: T.sage, margin: 0 },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: 15,
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '3px 7px',
    borderRadius: 4,
  },
  body: { padding: '20px 22px', overflowY: 'auto' as const },
  sub: { fontSize: 11, color: T.charcoal, margin: '0 0 14px' },
  input: {
    width: '100%',
    padding: '5px 9px',
    border: `1px solid ${T.border}`,
    borderRadius: 5,
    fontSize: 12,
    color: T.charcoal,
    background: '#fff',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  select: {
    width: '100%',
    padding: '5px 9px',
    border: `1px solid ${T.border}`,
    borderRadius: 5,
    fontSize: 12,
    color: T.charcoal,
    background: '#fff',
    outline: 'none',
  },
  actions: {
    display: 'flex' as const,
    justifyContent: 'flex-end' as const,
    gap: 8,
    marginTop: 18,
    paddingTop: 14,
    borderTop: `1px solid ${T.border}`,
  },
  btnPri: {
    padding: '7px 20px',
    background: T.sage,
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnSec: {
    padding: '7px 18px',
    background: '#fff',
    color: T.charcoal,
    border: `1px solid ${T.border}`,
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    background: T.page,
    padding: '7px 10px',
    textAlign: 'left' as const,
    fontWeight: 700,
    borderBottom: `2px solid ${T.border}`,
    fontSize: 9.5,
    color: T.gold,
    textTransform: 'uppercase' as const,
    letterSpacing: '.06em',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '7px 10px',
    borderBottom: `1px solid ${T.border}`,
    verticalAlign: 'middle' as const,
    fontSize: 12,
    color: T.charcoal,
  },
  dropzone: {
    border: `2px dashed ${T.border}`,
    borderRadius: 8,
    padding: '52px 24px',
    textAlign: 'center' as const,
    cursor: 'pointer',
    background: T.page,
    userSelect: 'none' as const,
    transition: 'border-color .2s, background .2s',
  },
  dropzoneOn: { borderColor: T.sage, background: '#E8F0EE' },
  spinner: {
    display: 'inline-block',
    width: 28,
    height: 28,
    border: `2px solid ${T.border}`,
    borderTopColor: T.sage,
    borderRadius: '50%',
    animation: 'spin .7s linear infinite',
  },
  errBox: {
    background: '#FDE8E8',
    border: '1px solid #F5C2C2',
    borderRadius: 6,
    padding: '10px 14px',
    fontSize: 11,
    color: '#991B1B',
    marginBottom: 14,
  },
  instrWrap: { marginTop: 14, border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden' as const },
  instrToggle: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    width: '100%',
    padding: '9px 12px',
    background: T.page,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    color: T.charcoal,
    fontWeight: 500,
    gap: 4,
  },
  instrBody: { padding: '14px 16px', background: '#fff', borderTop: `1px solid ${T.border}` },
  instrTitle: { fontSize: 12, fontWeight: 600, color: T.sage, margin: '0 0 6px' },
  instrList: { fontSize: 12, color: T.charcoal, margin: '0 0 12px', paddingLeft: 20, lineHeight: 1.7 },
}
