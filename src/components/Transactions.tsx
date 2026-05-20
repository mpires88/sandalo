'use client'

import { useState, useEffect, useMemo, useCallback, Fragment, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { normKey, buildCatIndex, suggestCat, clusterGroups, type MerchantGroup } from '@/lib/merchantClustering'
import CategoryInput from './CategoryInput'
import { ALL_SECTIONS, PL_SECTIONS, BS_SECTIONS, DEFAULT_ACCOUNTS } from '@/lib/chartOfAccounts'
import { seedTransactionsOnce } from '@/lib/seedTransactions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface Txn {
  id: string; transaction_date: string; description: string
  amount: string | number; category: string | null; account: string | null
}

function dominantCat(txns: Txn[]): string {
  const counts: Record<string, number> = {}
  txns.forEach(t => { const c = t.category || ''; if (c) counts[c] = (counts[c] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

interface CsvData { headers: string[]; rows: Record<string, string>[] }

function parseCSVText(text: string): CsvData {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else {
      if      (c === '"')                { inQuotes = true }
      else if (c === ',')               { row.push(field.trim()); field = '' }
      else if (c === '\r' || c === '\n') {
        if (c === '\r' && next === '\n') i++
        row.push(field.trim())
        if (row.some(f => f !== '')) rows.push(row)
        row = []; field = ''
      } else field += c
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(f => f !== '')) rows.push(row) }
  if (!rows.length) return { headers: [], rows: [] }
  const headers = rows[0]
  return { headers, rows: rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) }
}

const DATE_FORMATS = [
  { label: 'MM/DD/YYYY  e.g. 01/31/2024', value: 'MM/DD/YYYY' },
  { label: 'M/D/YYYY    e.g. 1/5/2024',   value: 'M/D/YYYY'   },
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
  if (fmt.startsWith('YYYY'))    [y, m, d] = parts
  else if (fmt.startsWith('DD')) [d, m, y] = parts
  else                           [m, d, y] = parts
  m = String(+m).padStart(2, '0')
  d = String(+d).padStart(2, '0')
  if (String(y).length !== 4 || isNaN(+y) || isNaN(+m) || isNaN(+d)) return null
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return null
  return `${y}-${m}-${d}`
}

interface ParsedRow {
  transaction_date: string; description: string; amount: number
  account?: string; reference_id?: string; category?: string; client_id?: string
}

function fingerprint(row: ParsedRow | Txn): string {
  if ('reference_id' in row && row.reference_id) return `ref:${row.reference_id}`
  return `${row.transaction_date}|${row.amount}|${((row.description) || '').toLowerCase().trim()}`
}

const STANDARD_FIELDS = [
  { key: 'transaction_date', label: 'Date',         required: true  },
  { key: 'description',      label: 'Description',  required: true  },
  { key: 'amount',           label: 'Amount',        required: false },
  { key: 'account',          label: 'Account',       required: false },
  { key: 'reference_id',     label: 'Reference ID',  required: false },
  { key: 'category',         label: 'Category',      required: false },
]

interface CsvCfg {
  bankName: string; dateFormat: string; splitAmounts: boolean; debitsPositive: boolean
  cols: Record<string, string>
}

const DEFAULT_CFG = (): CsvCfg => ({
  bankName: '', dateFormat: 'MM/DD/YYYY', splitAmounts: false, debitsPositive: false,
  cols: { transaction_date: '', description: '', amount: '', credit: '', debit: '', account: '', reference_id: '', category: '' },
})

const LS_KEY_BANKS = 'sandalo_csv_bank_mappings'
const loadAllMappings = (): Record<string, CsvCfg> => { try { return JSON.parse(localStorage.getItem(LS_KEY_BANKS) || '{}') } catch { return {} } }
const saveBankMapping = (bank: string, cfg: CsvCfg) => {
  const all = loadAllMappings(); all[bank] = cfg
  localStorage.setItem(LS_KEY_BANKS, JSON.stringify(all))
}

// ─── Transactions Page ────────────────────────────────────────────────────────

const TX_PAGE_SIZE = 100

const gridRow = {
  display: 'grid' as const,
  gridTemplateColumns: '1.5fr 1fr 240px 60px 120px 36px',
  gap: 0,
  padding: '9px 14px',
  alignItems: 'center' as const,
}

const colHd = {
  fontSize: 9.5, fontWeight: 700 as const, color: '#C8A96E',
  textTransform: 'uppercase' as const, letterSpacing: '.06em',
}

export default function Transactions({ clientId }: { clientId: string }) {
  const [txns,          setTxns]          = useState<Txn[]>([])
  const [loading,       setLoading]       = useState(true)
  const [loadError,     setLoadError]     = useState<string | null>(null)
  const [loadingMore,   setLoadingMore]   = useState(false)
  const [allCats,       setAllCats]       = useState<string[]>([])
  const [catSectionMap, setCatSectionMap] = useState<Record<string, string>>({})
  const [accountMap,    setAccountMap]    = useState<Record<string, string>>({})
  const [saved,         setSaved]         = useState(new Set<string>())
  const [applying,      setApplying]      = useState(new Set<string>())
  const [expanded,      setExpanded]      = useState<Record<string, boolean>>({})
  const [saving,        setSaving]        = useState(false)
  const [showImport,    setShowImport]    = useState(false)
  const [createModal,   setCreateModal]   = useState<{ categoryKey: string; accountName: string; txnIds?: string[] } | null>(null)
  const [newAccName,    setNewAccName]    = useState('')
  const [newAccSection, setNewAccSection] = useState('Operating Expenses')
  const [newAccParent,  setNewAccParent]  = useState('')
  const [savingNewAcc,  setSavingNewAcc]  = useState(false)

  const [expandFilters,   setExpandFilters]   = useState<Record<string, string>>({})
  const [expandSelected,  setExpandSelected]  = useState<Record<string, Set<string>>>({})
  const [expandMoveTo,    setExpandMoveTo]    = useState<Record<string, string>>({})
  const [expandExtractTo, setExpandExtractTo] = useState<Record<string, string>>({})
  const [movingGroup,     setMovingGroup]     = useState<string | null>(null)
  const [splitMode,      setSplitMode]      = useState<string | null>(null)
  const [splitConfig,    setSplitConfig]    = useState<Record<string, { checked: boolean; newCat: string }>>({})
  const [applyingSplit,  setApplyingSplit]  = useState(false)
  const [txnFilter,      setTxnFilter]      = useState<'all' | 'mapped' | 'unmapped' | 'uncategorized'>('all')
  const [txDateFrom,     setTxDateFrom]     = useState('')
  const [txDateTo,       setTxDateTo]       = useState('')
  const [view,           setView]           = useState<'groups' | 'transactions'>('groups')
  const [groupMode,      setGroupMode]      = useState<'category' | 'desc_amount'>('category')
  const [txSearch,       setTxSearch]       = useState('')
  const [txSortCol,      setTxSortCol]      = useState<'transaction_date' | 'description' | 'category' | 'account' | 'amount'>('transaction_date')
  const [txSortDir,      setTxSortDir]      = useState<'asc' | 'desc'>('desc')
  const [txPage,         setTxPage]         = useState(1)
  const [txSelected,     setTxSelected]     = useState(new Set<string>())
  const [deletingTxns,   setDeletingTxns]   = useState(false)
  const [txEditId,       setTxEditId]       = useState<string | null>(null)
  const [txEditVal,      setTxEditVal]      = useState('')
  const [txBulkAccount,  setTxBulkAccount]  = useState('')
  const [txBulkAssigning,setTxBulkAssigning]= useState(false)

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      await seedTransactionsOnce(clientId)
      const [txnRes, catRes] = await Promise.all([
        supabase.from('bank_transactions').select('id, transaction_date, description, amount, category, account').eq('client_id', clientId).range(0, 999),
        supabase.from('categories').select('name, sort_order, pl_section, parent').eq('client_id', clientId).order('sort_order'),
      ])
      if (txnRes.error) throw txnRes.error

      const first = txnRes.data ?? []

      // Ensure categories table is seeded (may be empty if user hasn't visited Chart of Accounts)
      const catData = catRes.data ?? []
      const existingCatNames = new Set(catData.map((r: { name: string }) => r.name))
      const missingAccts = DEFAULT_ACCOUNTS.filter(a => !existingCatNames.has(a.name))
      if (missingAccts.length) {
        const toSeed = missingAccts.map(a => ({ client_id: clientId, name: a.name, sort_order: a.sort_order, pl_section: a.pl_section, parent: a.parent ?? null }))
        await supabase.from('categories').upsert(toSeed, { onConflict: 'name' })
      }
      const allCatNames = missingAccts.length
        ? [...Array.from(existingCatNames), ...missingAccts.map(a => a.name)]
        : catData.map((r: { name: string }) => r.name)
      const coaSet = new Set(allCatNames)
      setAllCats(allCatNames)
      const sectionMap: Record<string, string> = {}
      catData.forEach((r: { name: string; pl_section?: string | null }) => { if (r.pl_section) sectionMap[r.name] = r.pl_section })
      missingAccts.forEach(a => { sectionMap[a.name] = a.pl_section })
      setCatSectionMap(sectionMap)
      setTxns(first)
      setLoading(false)

      let all = first
      if (first.length === 1000) {
        setLoadingMore(true)
        let offset = 1000
        while (true) {
          const res = await supabase.from('bank_transactions').select('id, transaction_date, description, amount, category, account').eq('client_id', clientId).range(offset, offset + 999)
          if (res.error || !res.data?.length) break
          all = [...all, ...res.data]
          setTxns(all)
          if (res.data.length < 1000) break
          offset += 1000
        }
        setLoadingMore(false)
      }

      // Rebuild account map and saved set from the complete transaction list
      const aMap: Record<string, string> = {}
      const savedSet = new Set<string>()
      const byCategory: Record<string, Record<string, number>> = {}
      all.forEach((t: Txn) => {
        if (!t.category || !t.account) return
        const cat = t.category as string
        const acc = t.account as string
        if (!byCategory[cat]) byCategory[cat] = {}
        byCategory[cat][acc] = (byCategory[cat][acc] || 0) + 1
      })
      for (const [cat, accts] of Object.entries(byCategory)) {
        const dominant = Object.entries(accts).sort((a, b) => b[1] - a[1])[0]?.[0]
        if (dominant) {
          aMap[cat] = dominant
          if (coaSet.has(dominant)) savedSet.add(cat)
        }
      }
      setAccountMap(aMap)
      setSaved(savedSet)
    } catch (e: unknown) {
      setLoadError((e as Error).message)
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const categoryGroups = useMemo(() => {
    const byCategory: Record<string, { count: number; total: number; txns: Txn[]; merchants: Record<string, number> }> = {}
    txns.forEach(t => {
      const cat = (t.category as string) || '(uncategorized)'
      if (!byCategory[cat]) byCategory[cat] = { count: 0, total: 0, txns: [], merchants: {} }
      byCategory[cat].count++
      byCategory[cat].total += Number(t.amount) || 0
      byCategory[cat].txns.push(t)
      const desc = (t.description || '').trim()
      if (desc) byCategory[cat].merchants[desc] = (byCategory[cat].merchants[desc] || 0) + 1
    })
    return Object.entries(byCategory)
      .map(([category, { count, total, txns: grpTxns, merchants }]) => {
        const topMerchants = Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name)
        return { category, count, total, txns: grpTxns, topMerchants }
      })
      .sort((a, b) => a.category.localeCompare(b.category))
  }, [txns])

  const descAmountGroups = useMemo(() => {
    const SEP = '|||'
    const byKey: Record<string, { count: number; total: number; txns: Txn[]; merchants: Record<string, number> }> = {}
    txns.forEach(t => {
      const key = `${(t.description || '').trim()}${SEP}${Number(t.amount).toFixed(2)}`
      if (!byKey[key]) byKey[key] = { count: 0, total: 0, txns: [], merchants: {} }
      byKey[key].count++
      byKey[key].total += Number(t.amount) || 0
      const desc = (t.description || '').trim()
      if (desc) byKey[key].merchants[desc] = (byKey[key].merchants[desc] || 0) + 1
    })
    return Object.entries(byKey)
      .map(([key, { count, total, txns: grpTxns, merchants }]) => {
        const topMerchants = Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name)
        return { category: key, count, total, txns: grpTxns, topMerchants }
      })
      .sort((a, b) => a.category.split('|||')[0].localeCompare(b.category.split('|||')[0]))
  }, [txns])

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

  const coverage = useMemo(() => {
    if (!txns.length) return null
    const assetSections = new Set(['Current Assets', 'Non-Current Assets'])
    const map: Record<string, Record<string, number>> = {}
    txns.forEach(t => {
      const acct = t.account
      if (!acct || !assetSections.has(catSectionMap[acct] ?? '')) return
      const ym = (t.transaction_date || '').slice(0, 7)
      if (!ym) return
      if (!map[acct]) map[acct] = {}
      map[acct][ym] = (map[acct][ym] || 0) + 1
    })
    if (!Object.keys(map).length) return null
    const months = [...new Set(txns.map(t => (t.transaction_date || '').slice(0, 7)).filter(Boolean))].sort()
    return { accounts: Object.keys(map).sort(), months, map }
  }, [txns, catSectionMap])

  const visibleGroups = useMemo(() => {
    const groups = groupMode === 'desc_amount' ? descAmountGroups : categoryGroups
    switch (txnFilter) {
      case 'mapped':        return groups.filter(g => saved.has(g.category))
      case 'unmapped':      return groups.filter(g => !saved.has(g.category))
      case 'uncategorized': return groupMode === 'category'
        ? groups.filter(g => g.category === '(uncategorized)')
        : groups
      default:              return groups
    }
  }, [categoryGroups, descAmountGroups, groupMode, txnFilter, saved])

  const filteredTxns = useMemo(() => {
    let list = [...txns]
    // Status filter
    switch (txnFilter) {
      case 'mapped':        list = list.filter(t => !!t.account); break
      case 'unmapped':      list = list.filter(t => !t.account); break
      case 'uncategorized': list = list.filter(t => !t.category); break
    }
    // Date range
    if (txDateFrom) list = list.filter(t => t.transaction_date >= txDateFrom)
    if (txDateTo)   list = list.filter(t => t.transaction_date <= txDateTo)
    // Text search
    if (txSearch.trim()) {
      const q = txSearch.trim().toLowerCase()
      list = list.filter(t =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.category    || '').toLowerCase().includes(q) ||
        (t.account     || '').toLowerCase().includes(q)
      )
    }
    list.sort((a, b) => {
      let av: string | number, bv: string | number
      switch (txSortCol) {
        case 'transaction_date': av = a.transaction_date || '';                     bv = b.transaction_date || '';                     break
        case 'description':      av = (a.description || '').toLowerCase();          bv = (b.description || '').toLowerCase();          break
        case 'category':         av = (a.category    || '').toLowerCase();          bv = (b.category    || '').toLowerCase();          break
        case 'account':          av = (a.account     || '').toLowerCase();          bv = (b.account     || '').toLowerCase();          break
        case 'amount':           av = Number(a.amount);                             bv = Number(b.amount);                             break
        default:                 av = ''; bv = ''
      }
      if (av < bv) return txSortDir === 'asc' ? -1 : 1
      if (av > bv) return txSortDir === 'asc' ?  1 : -1
      return 0
    })
    return list
  }, [txns, txSearch, txSortCol, txSortDir, txnFilter, txDateFrom, txDateTo])

  const applyMapping = async (category: string, accountName: string) => {
    const name = accountName.trim()
    if (!name) return
    if (!allCats.includes(name)) {
      setCreateModal({ categoryKey: category, accountName: name })
      setNewAccName(name); setNewAccSection('Operating Expenses'); setNewAccParent('')
      return
    }
    setApplying(prev => new Set([...prev, category]))
    try {
      let q = supabase.from('bank_transactions').update({ account: name }).eq('client_id', clientId)
      if (groupMode === 'desc_amount') {
        const [desc, amtStr] = category.split('|||')
        q = q.eq('description', desc).eq('amount', amtStr)
      } else {
        const isUncategorized = category === '(uncategorized)'
        q = isUncategorized ? q.eq('category', null as unknown as string) : q.eq('category', category)
      }
      const { error } = await q
      if (error) throw error
      setSaved(prev => new Set([...prev, category]))
      if (groupMode === 'desc_amount') {
        const [desc, amtStr] = category.split('|||')
        setTxns(prev => prev.map(t =>
          (t.description || '').trim() === desc && Number(t.amount).toFixed(2) === amtStr
            ? { ...t, account: name } : t
        ))
      } else {
        setTxns(prev => prev.map(t => ((t.category as string) || '(uncategorized)') === category ? { ...t, account: name } : t))
      }
    } catch (e: unknown) { alert('Failed: ' + (e as Error).message) }
    finally { setApplying(prev => { const s = new Set(prev); s.delete(category); return s }) }
  }

  const applyAll = async () => {
    setSaving(true)
    for (const [category, account] of Object.entries(accountMap)) {
      if (!saved.has(category) && allCats.includes(account.trim())) {
        await applyMapping(category, account)
      }
    }
    setSaving(false)
  }

  const createAndApplyAccount = async () => {
    if (!createModal) return
    const name = newAccName.trim()
    if (!name) return
    setSavingNewAcc(true)
    try {
      const maxOrder = allCats.length * 10 + 10
      const { error } = await supabase.from('categories').insert({ client_id: clientId, name, sort_order: maxOrder, pl_section: newAccSection, parent: newAccParent || null })
      if (error) throw error
      setAllCats(prev => [...prev, name])
      if (createModal.txnIds?.length) {
        // Bulk assign to specific transaction IDs (from filter+select)
        const ids = createModal.txnIds
        for (let i = 0; i < ids.length; i += 500) {
          const { error: updateErr } = await supabase.from('bank_transactions').update({ account: name }).in('id', ids.slice(i, i + 500))
          if (updateErr) throw updateErr
        }
        setTxns(prev => prev.map(t => ids.includes(t.id) ? { ...t, account: name } : t))
        setExpandSelected(prev => ({ ...prev, [createModal.categoryKey]: new Set() }))
        setExpandMoveTo(prev => ({ ...prev, [createModal.categoryKey]: '' }))
      } else {
        // Assign to all transactions in this category
        const { error: updateErr } = await supabase.from('bank_transactions').update({ account: name }).eq('category', createModal.categoryKey).eq('client_id', clientId)
        if (updateErr) throw updateErr
        setSaved(prev => new Set([...prev, createModal.categoryKey]))
        setAccountMap(prev => ({ ...prev, [createModal.categoryKey]: name }))
        setTxns(prev => prev.map(t => ((t.category as string) || '(uncategorized)') === createModal.categoryKey ? { ...t, account: name } : t))
      }
      setCreateModal(null)
    } catch (e: unknown) { alert('Failed: ' + (e as Error).message) }
    finally { setSavingNewAcc(false) }
  }

  const enterSplitMode = (category: string) => {
    const grp = categoryGroups.find(g => g.category === category)
    if (!grp) return
    const merchantCounts: Record<string, number> = {}
    grp.txns.forEach(t => {
      const desc = (t.description || '').trim()
      if (desc) merchantCounts[desc] = (merchantCounts[desc] || 0) + 1
    })
    const config: Record<string, { checked: boolean; newCat: string }> = {}
    Object.keys(merchantCounts)
      .sort((a, b) => merchantCounts[b] - merchantCounts[a])
      .forEach(desc => { config[desc] = { checked: false, newCat: desc } })
    setSplitConfig(config)
    setSplitMode(category)
  }

  const doSplit = async (category: string) => {
    const grp = categoryGroups.find(g => g.category === category)
    if (!grp) return
    const toSplit = Object.entries(splitConfig).filter(([, v]) => v.checked && v.newCat.trim() && v.newCat.trim() !== category)
    if (!toSplit.length) return
    setApplyingSplit(true)
    try {
      for (const [merchant, { newCat }] of toSplit) {
        const ids = grp.txns.filter(t => (t.description || '').trim() === merchant).map(t => t.id)
        for (let i = 0; i < ids.length; i += 500) {
          const { error } = await supabase.from('bank_transactions').update({ category: newCat.trim() }).in('id', ids.slice(i, i + 500))
          if (error) throw error
        }
      }
      const updates: Record<string, string> = {}
      toSplit.forEach(([merchant, { newCat }]) => { updates[merchant] = newCat.trim() })
      setTxns(prev => prev.map(t => {
        const newCat = updates[(t.description || '').trim()]
        return newCat ? { ...t, category: newCat } : t
      }))
      setSplitMode(null)
    } catch (e: unknown) { alert('Split failed: ' + (e as Error).message) }
    finally { setApplyingSplit(false) }
  }

  const moveSelected = async (category: string) => {
    const target = (expandMoveTo[category] || '').trim()
    if (!target) return
    const ids = [...(expandSelected[category] ?? new Set())]
    if (!ids.length) return
    if (!allCats.includes(target)) {
      setCreateModal({ categoryKey: category, accountName: target, txnIds: ids })
      setNewAccName(target); setNewAccSection('Operating Expenses'); setNewAccParent('')
      return
    }
    setMovingGroup(category)
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await supabase.from('bank_transactions').update({ account: target }).in('id', ids.slice(i, i + 500))
        if (error) throw error
      }
      setTxns(prev => prev.map(t => ids.includes(t.id) ? { ...t, account: target } : t))
      setExpandSelected(prev => ({ ...prev, [category]: new Set() }))
      setExpandMoveTo(prev => ({ ...prev, [category]: '' }))
    } catch (e: unknown) { alert('Move failed: ' + (e as Error).message) }
    finally { setMovingGroup(null) }
  }

  const extractSelected = async (category: string) => {
    const newCat = (expandExtractTo[category] || '').trim()
    if (!newCat || newCat === category) return
    const ids = [...(expandSelected[category] ?? new Set())]
    if (!ids.length) return
    setMovingGroup(category)
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await supabase.from('bank_transactions').update({ category: newCat }).in('id', ids.slice(i, i + 500))
        if (error) throw error
      }
      setTxns(prev => prev.map(t => ids.includes(t.id) ? { ...t, category: newCat } : t))
      setExpandSelected(prev => ({ ...prev, [category]: new Set() }))
      setExpandExtractTo(prev => ({ ...prev, [category]: '' }))
    } catch (e: unknown) { alert('Extract failed: ' + (e as Error).message) }
    finally { setMovingGroup(null) }
  }

  const ungroupSelected = async (groupKey: string) => {
    const ids = [...(expandSelected[groupKey] ?? new Set())]
    if (!ids.length) return
    setMovingGroup(groupKey)
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await supabase
          .from('bank_transactions')
          .update({ category: null })
          .in('id', ids.slice(i, i + 500))
        if (error) throw error
      }
      setTxns(prev => prev.map(t => ids.includes(t.id) ? { ...t, category: null } : t))
      setExpandSelected(prev => ({ ...prev, [groupKey]: new Set() }))
    } catch (e: unknown) { alert('Ungroup failed: ' + (e as Error).message) }
    finally { setMovingGroup(null) }
  }

  const bulkAssignAccount = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || !txSelected.size) return
    const ids = [...txSelected]
    if (!allCats.includes(trimmed)) {
      setCreateModal({ categoryKey: '', accountName: trimmed, txnIds: ids })
      setNewAccName(trimmed); setNewAccSection('Operating Expenses'); setNewAccParent('')
      return
    }
    setTxBulkAssigning(true)
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await supabase.from('bank_transactions').update({ account: trimmed }).in('id', ids.slice(i, i + 500))
        if (error) throw error
      }
      setTxns(prev => prev.map(t => ids.includes(t.id) ? { ...t, account: trimmed } : t))
      setTxSelected(new Set())
      setTxBulkAccount('')
    } catch (e: unknown) { alert('Assign failed: ' + (e as Error).message) }
    finally { setTxBulkAssigning(false) }
  }

  const saveTxAccount = async (id: string, name: string) => {
    try {
      const { error } = await supabase.from('bank_transactions').update({ account: name }).eq('id', id)
      if (error) throw error
      setTxns(prev => prev.map(t => t.id === id ? { ...t, account: name } : t))
    } catch (e: unknown) { alert('Save failed: ' + (e as Error).message) }
    finally { setTxEditId(null) }
  }

  const deleteTxns = async (ids: string[]) => {
    if (!ids.length) return
    if (!confirm(`Delete ${ids.length} transaction${ids.length !== 1 ? 's' : ''}?`)) return
    setDeletingTxns(true)
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await supabase.from('bank_transactions').delete().in('id', ids.slice(i, i + 500))
        if (error) throw error
      }
      setTxns(prev => prev.filter(t => !ids.includes(t.id)))
      setTxSelected(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s })
    } catch (e: unknown) { alert('Delete failed: ' + (e as Error).message) }
    finally { setDeletingTxns(false) }
  }

  const deleteAll = async () => {
    if (!confirm(`Permanently delete ALL ${txns.length} transactions? This cannot be undone.`)) return
    const typed = window.prompt('Type DELETE to confirm:')
    if (typed !== 'DELETE') return
    setSaving(true)
    try {
      const { error } = await supabase.from('bank_transactions').delete().eq('client_id', clientId)
      if (error) throw error
      setTxns([]); setSaved(new Set()); setAccountMap({})
    } catch (e: unknown) { alert('Delete failed: ' + (e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return (
    <div style={s.center}>
      <div style={s.spinner} />
      <p style={{ color: '#6b7280', marginTop: 16 }}>Loading transactions…</p>
    </div>
  )

  if (loadError) return (
    <div style={s.wrap}><div style={{ padding: 28 }}><div style={s.errorBox}>Failed to load: {loadError}</div></div></div>
  )

  const unmappedCount = categoryGroups.filter(g => !saved.has(g.category)).length
  const pendingApply  = Object.entries(accountMap).filter(([c, v]) => !saved.has(c) && v.trim() && allCats.includes(v.trim())).length

  const txTotalPages  = Math.max(1, Math.ceil(filteredTxns.length / TX_PAGE_SIZE))
  const txPagedTxns   = filteredTxns.slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE)
  const txAllPageSel  = txPagedTxns.length > 0 && txPagedTxns.every(t => txSelected.has(t.id))
  const toggleTxPageAll = () => setTxSelected(prev => {
    const next = new Set(prev)
    if (txAllPageSel) txPagedTxns.forEach(t => next.delete(t.id))
    else txPagedTxns.forEach(t => next.add(t.id))
    return next
  })
  const toggleTxRow = (id: string) => setTxSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const setTxSort = (col: typeof txSortCol) => {
    if (txSortCol === col) setTxSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTxSortCol(col); setTxSortDir('asc'); setTxPage(1) }
  }

  return (
    <div style={s.wrap}>
      <header style={s.pageHeader}>
        <div>
          <h2 style={s.h2}>Transactions</h2>
          <p style={s.sub}>
            {categoryGroups.length} categories · {txns.length} transactions
            {loadingMore && <> · <span style={{ color: T.charcoal, opacity: .6 }}>loading more…</span></>}
            {unmappedCount > 0 && <> · <span style={{ color: T.amber, fontWeight: 500 }}>{unmappedCount} unmapped</span></>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {pendingApply > 0 && (
            <button style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={applyAll} disabled={saving}>
              {saving ? 'Applying…' : `Apply All (${pendingApply})`}
            </button>
          )}
          {txns.length > 0 && <button style={s.btnDanger} disabled={saving} onClick={deleteAll}>Delete All</button>}
          <button style={s.btnSecondary} onClick={() => setShowImport(true)}>↑ Import CSV</button>
        </div>
      </header>

      <div style={s.content}>
        {/* View toggle */}
        <div style={{ display: 'flex', gap: 4, marginBottom: view === 'groups' ? 8 : 16 }}>
          <button style={{ ...s.tab, ...(view === 'groups' ? s.tabActive : {}) }} onClick={() => setView('groups')}>Grouped View</button>
          <button style={{ ...s.tab, ...(view === 'transactions' ? s.tabActive : {}) }} onClick={() => setView('transactions')}>All Transactions</button>
        </div>
        {view === 'groups' && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: T.charcoal, opacity: 0.55, marginRight: 2 }}>Group by:</span>
            <button style={{ ...s.tab, ...(groupMode === 'category' ? s.tabActive : {}) }} onClick={() => setGroupMode('category')}>Category (Column Z)</button>
            <button style={{ ...s.tab, ...(groupMode === 'desc_amount' ? s.tabActive : {}) }} onClick={() => setGroupMode('desc_amount')}>Description + Amount</button>
          </div>
        )}

        {view === 'groups' && (<>
        {coverage && <CoveragePanel coverage={coverage} />}

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' as const }}>
          {([
            { key: 'all',           label: 'All',           count: categoryGroups.length },
            { key: 'unmapped',      label: 'Unmapped',      count: categoryGroups.filter(g => !saved.has(g.category)).length },
            { key: 'mapped',        label: 'Mapped',        count: categoryGroups.filter(g => saved.has(g.category)).length },
            { key: 'uncategorized', label: 'Uncategorized', count: categoryGroups.filter(g => g.category === '(uncategorized)').length },
          ] as const).map(f => (
            <button
              key={f.key}
              style={{ ...s.tab, ...(txnFilter === f.key ? s.tabActive : {}), display: 'flex', gap: 5, alignItems: 'center' as const }}
              onClick={() => setTxnFilter(f.key)}
            >
              {f.label}
              <span style={{
                fontSize: 9.5, fontWeight: 600,
                background: txnFilter === f.key ? 'rgba(255,255,255,0.25)' : T.page,
                color: txnFilter === f.key ? '#fff' : '#9ca3af',
                borderRadius: 9, padding: '1px 6px', lineHeight: 1.5,
              }}>
                {f.count}
              </span>
            </button>
          ))}
        </div>

        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {/* Column headers */}
          <div style={{ ...gridRow, background: '#f9faf8', borderBottom: `2px solid ${T.border}` }}>
            <div style={colHd}>Merchant / Description</div>
            <div style={colHd}>{groupMode === 'desc_amount' ? 'Amount' : 'Bank Category'}</div>
            <div style={colHd}>Account Category</div>
            <div style={{ ...colHd, textAlign: 'right' }}>Txns</div>
            <div style={{ ...colHd, textAlign: 'right' }}>Total</div>
            <div />
          </div>

          {visibleGroups.map(g => {
            const isSaved    = saved.has(g.category)
            const isApplying = applying.has(g.category)
            const pending    = accountMap[g.category] ?? ''
            const isExp      = !!expanded[g.category]

            return (
              <Fragment key={g.category}>
                <div style={{ ...gridRow, background: isSaved ? 'rgba(44,95,82,0.04)' : 'transparent', borderBottom: `1px solid ${T.border}` }}>

                  {/* Merchant / Description */}
                  <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, overflow: 'hidden' }}>
                    {g.topMerchants.slice(0, 2).map((merch, i) => (
                      <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{merch}</div>
                    ))}
                    {g.topMerchants.length === 0 && <span style={{ color: '#c0bdb7' }}>—</span>}
                    {g.count > 2 && (
                      <div style={{ color: '#9ca3af', fontSize: 11 }}>
                        +{g.count - Math.min(2, g.topMerchants.length)} more
                      </div>
                    )}
                  </div>

                  {/* Bank Category (Column Z) or per-transaction Amount */}
                  {groupMode === 'desc_amount' ? (
                    <div style={{ fontSize: 13, fontWeight: 500, color: Number(g.category.split('|||')[1]) < 0 ? '#dc2626' : '#16a34a' }}>
                      {Number(g.category.split('|||')[1]) < 0 ? '−' : '+'}
                      ${Math.abs(Number(g.category.split('|||')[1])).toFixed(2)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 500, color: T.charcoal }}>{g.category}</div>
                  )}

                  {/* Account Category */}
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <CategoryInput
                        value={pending}
                        onChange={v => {
                          setAccountMap(prev => ({ ...prev, [g.category]: v }))
                          if (isSaved) setSaved(prev => { const s = new Set(prev); s.delete(g.category); return s })
                        }}
                        groups={accountGroups}
                        placeholder="Select account…"
                        onCreate={name => {
                          setCreateModal({ categoryKey: g.category, accountName: name })
                          setNewAccName(name); setNewAccSection('Operating Expenses'); setNewAccParent('')
                        }}
                      />
                    </div>
                    {isSaved ? (
                      <span style={{ fontSize: 12, color: T.sage, fontWeight: 600, flexShrink: 0 }}>✓</span>
                    ) : (
                      <button
                        onClick={() => applyMapping(g.category, pending)}
                        disabled={!pending.trim() || isApplying}
                        style={{ ...s.btnPrimary, padding: '4px 8px', fontSize: 11, flexShrink: 0, opacity: (!pending.trim() || isApplying) ? 0.4 : 1 }}
                      >
                        {isApplying ? '…' : 'Apply'}
                      </button>
                    )}
                  </div>

                  {/* Txns */}
                  <div style={{ textAlign: 'right', fontSize: 13, color: '#6b7280' }}>{g.count}</div>

                  {/* Total */}
                  <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 500, color: g.total < 0 ? '#dc2626' : '#16a34a', fontVariantNumeric: 'tabular-nums' }}>
                    {g.total < 0 ? '−' : '+'}${Math.abs(g.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>

                  {/* Expand */}
                  <div style={{ textAlign: 'center' }}>
                    <button style={s.expandBtn} onClick={() => setExpanded(p => ({ ...p, [g.category]: !p[g.category] }))}>
                      {isExp ? '▲' : '▼'}
                    </button>
                  </div>
                </div>

                {isExp && (
                  <div style={{ background: '#E8F0EE', borderBottom: `2px solid #B8D4CC` }}>
                    {splitMode === g.category ? (
                      /* ── Split by merchant mode ── */
                      <div style={{ padding: '10px 14px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: T.charcoal, flex: 1 }}>
                            Check the merchants you want to split into their own category
                          </span>
                          <button style={{ ...s.btnSecondary, fontSize: 11, padding: '4px 10px' }} onClick={() => setSplitMode(null)}>Cancel</button>
                          <button
                            style={{ ...s.btnPrimary, fontSize: 11, padding: '4px 10px', opacity: applyingSplit ? 0.6 : 1 }}
                            disabled={applyingSplit || !Object.values(splitConfig).some(v => v.checked && v.newCat.trim())}
                            onClick={() => doSplit(g.category)}
                          >
                            {applyingSplit ? 'Splitting…' : 'Apply Split'}
                          </button>
                        </div>
                        {Object.entries(splitConfig).map(([merchant, { checked, newCat }]) => {
                          const count = g.txns.filter(t => (t.description || '').trim() === merchant).length
                          return (
                            <div key={merchant} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 2px', borderBottom: `1px solid rgba(0,0,0,0.06)` }}>
                              <input type="checkbox" checked={checked}
                                onChange={e => setSplitConfig(prev => ({ ...prev, [merchant]: { ...prev[merchant], checked: e.target.checked } }))} />
                              <span style={{ fontSize: 12, color: T.charcoal, flex: '0 1 260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{merchant}</span>
                              <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>({count} txn{count !== 1 ? 's' : ''})</span>
                              {checked && (
                                <>
                                  <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>→</span>
                                  <input
                                    style={{ flex: 1, padding: '4px 8px', border: `1px solid ${T.border}`, borderRadius: 4, fontSize: 12, color: T.charcoal, background: '#fff' }}
                                    value={newCat}
                                    onChange={e => setSplitConfig(prev => ({ ...prev, [merchant]: { ...prev[merchant], newCat: e.target.value } }))}
                                    placeholder="New category name…"
                                  />
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      /* ── Normal expanded view ── */
                      <div style={{ padding: '10px 14px 12px' }}>
                        {/* Toolbar */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                          <input
                            style={{ ...s.input, flex: 1, fontSize: 12 }}
                            placeholder="Filter transactions…"
                            value={expandFilters[g.category] || ''}
                            onChange={e => {
                              setExpandFilters(prev => ({ ...prev, [g.category]: e.target.value }))
                              setExpandSelected(prev => ({ ...prev, [g.category]: new Set() }))
                            }}
                          />
                          {groupMode === 'category' && (
                            <button
                              style={{ ...s.btnSecondary, fontSize: 11, padding: '4px 10px', flexShrink: 0 }}
                              onClick={() => enterSplitMode(g.category)}
                            >
                              Split by merchant
                            </button>
                          )}
                        </div>

                        {/* Bulk action bar */}
                        {(expandSelected[g.category]?.size ?? 0) > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8, padding: '8px 10px', background: '#D0E4DE', borderRadius: 5 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: T.charcoal }}>
                                {expandSelected[g.category]!.size} selected
                              </span>
                              <button
                                style={{ ...s.btnSecondary, fontSize: 11, padding: '2px 8px' }}
                                onClick={() => setExpandSelected(prev => ({ ...prev, [g.category]: new Set() }))}
                              >
                                Clear
                              </button>
                            </div>

                            {/* Assign account */}
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span style={{ fontSize: 11, color: T.charcoal, flexShrink: 0, width: 110 }}>Assign account:</span>
                              <div style={{ flex: 1 }}>
                                <CategoryInput
                                  value={expandMoveTo[g.category] || ''}
                                  onChange={v => setExpandMoveTo(prev => ({ ...prev, [g.category]: v }))}
                                  groups={accountGroups}
                                  placeholder="Select or create account…"
                                  onCreate={name => {
                                    const ids = [...(expandSelected[g.category] ?? new Set())]
                                    setCreateModal({ categoryKey: g.category, accountName: name, txnIds: ids })
                                    setNewAccName(name); setNewAccSection('Operating Expenses'); setNewAccParent('')
                                  }}
                                />
                              </div>
                              <button
                                style={{ ...s.btnPrimary, fontSize: 11, padding: '4px 10px', flexShrink: 0, opacity: movingGroup === g.category ? 0.6 : 1 }}
                                disabled={movingGroup === g.category || !(expandMoveTo[g.category] || '').trim()}
                                onClick={() => moveSelected(g.category)}
                              >
                                {movingGroup === g.category ? '…' : 'Assign'}
                              </button>
                            </div>

                            {/* Extract to new group */}
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4, borderTop: '1px solid rgba(44,95,82,0.15)' }}>
                              <span style={{ fontSize: 11, color: T.charcoal, flexShrink: 0, width: 110 }}>Extract to group:</span>
                              <input
                                style={{ ...s.input, flex: 1, fontSize: 12 }}
                                value={expandExtractTo[g.category] || ''}
                                onChange={e => setExpandExtractTo(prev => ({ ...prev, [g.category]: e.target.value }))}
                                placeholder="New or existing category name…"
                              />
                              <button
                                style={{ ...s.btnSecondary, fontSize: 11, padding: '4px 10px', flexShrink: 0, opacity: movingGroup === g.category ? 0.6 : 1 }}
                                disabled={movingGroup === g.category || !(expandExtractTo[g.category] || '').trim() || (expandExtractTo[g.category] || '').trim() === g.category}
                                onClick={() => extractSelected(g.category)}
                              >
                                {movingGroup === g.category ? '…' : 'Extract'}
                              </button>
                            </div>
                            {/* Ungroup — clear category without requiring a destination */}
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4, borderTop: '1px solid rgba(44,95,82,0.15)' }}>
                              <span style={{ fontSize: 11, color: T.charcoal, flexShrink: 0, width: 110 }}>Ungroup:</span>
                              <span style={{ fontSize: 11, color: '#6b7280', flex: 1 }}>
                                Clears bank category — moves to (uncategorized)
                              </span>
                              <button
                                style={{ ...s.btnDanger, fontSize: 11, padding: '4px 10px', flexShrink: 0, opacity: movingGroup === g.category ? 0.6 : 1 }}
                                disabled={movingGroup === g.category}
                                onClick={() => ungroupSelected(g.category)}
                              >
                                {movingGroup === g.category ? '…' : 'Ungroup'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Transaction table */}
                        {(() => {
                          const filter = (expandFilters[g.category] || '').toLowerCase()
                          const visible = filter ? g.txns.filter(t => (t.description || '').toLowerCase().includes(filter)) : g.txns
                          const sel = expandSelected[g.category] ?? new Set<string>()
                          const allSel = visible.length > 0 && visible.every(t => sel.has(t.id))

                          const toggleTxn = (id: string) => setExpandSelected(prev => {
                            const next = new Set(prev[g.category] ?? [])
                            next.has(id) ? next.delete(id) : next.add(id)
                            return { ...prev, [g.category]: next }
                          })
                          const toggleAll = () => setExpandSelected(prev => {
                            const next = new Set(prev[g.category] ?? [])
                            if (allSel) visible.forEach(t => next.delete(t.id))
                            else visible.forEach(t => next.add(t.id))
                            return { ...prev, [g.category]: next }
                          })

                          return (
                            <table style={s.table}>
                              <thead>
                                <tr>
                                  <th style={{ ...s.th, background: '#D0E4DE', padding: '5px 8px', width: 28 }}>
                                    <input type="checkbox" checked={allSel} onChange={toggleAll} />
                                  </th>
                                  {['Date', 'Description', 'Column Z', 'Amount', 'Account'].map(h => (
                                    <th key={h} style={{ ...s.th, background: '#D0E4DE', padding: '5px 8px' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {visible.slice(0, 100).map(t => (
                                  <tr key={t.id}
                                    style={{ background: sel.has(t.id) ? '#dceee8' : '#fff', cursor: 'pointer' }}
                                    onClick={() => toggleTxn(t.id)}
                                  >
                                    <td style={{ ...s.td, padding: '4px 8px' }} onClick={e => e.stopPropagation()}>
                                      <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggleTxn(t.id)} />
                                    </td>
                                    <td style={{ ...s.td, padding: '4px 8px', whiteSpace: 'nowrap' }}>{t.transaction_date}</td>
                                    <td style={{ ...s.td, padding: '4px 8px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</td>
                                    <td style={{ ...s.td, padding: '4px 8px', color: '#6b7280', fontSize: 11 }}>{t.category || '—'}</td>
                                    <td style={{ ...s.td, padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: Number(t.amount) < 0 ? '#dc2626' : '#16a34a' }}>{Number(t.amount).toFixed(2)}</td>
                                    <td style={{ ...s.td, padding: '4px 8px' }}>{t.account || '—'}</td>
                                  </tr>
                                ))}
                                {visible.length > 100 && (
                                  <tr><td colSpan={6} style={{ padding: '4px 8px', color: '#9ca3af', fontSize: 11 }}>…and {visible.length - 100} more — refine filter to narrow down</td></tr>
                                )}
                                {filter && visible.length === 0 && (
                                  <tr><td colSpan={6} style={{ padding: '8px', color: '#9ca3af', fontSize: 12, textAlign: 'center' }}>No transactions match</td></tr>
                                )}
                              </tbody>
                            </table>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
        </>)}

        {view === 'transactions' && (
          <div>
            {/* Status filter tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' as const }}>
              {([
                { key: 'all',           label: 'All',           count: txns.length },
                { key: 'unmapped',      label: 'Unmapped',      count: txns.filter(t => !t.account).length },
                { key: 'mapped',        label: 'Mapped',        count: txns.filter(t => !!t.account).length },
                { key: 'uncategorized', label: 'Uncategorized', count: txns.filter(t => !t.category).length },
              ] as const).map(f => (
                <button
                  key={f.key}
                  style={{ ...s.tab, ...(txnFilter === f.key ? s.tabActive : {}), display: 'flex', gap: 5, alignItems: 'center' as const }}
                  onClick={() => { setTxnFilter(f.key); setTxPage(1); setTxSelected(new Set()) }}
                >
                  {f.label}
                  <span style={{
                    fontSize: 9.5, fontWeight: 600,
                    background: txnFilter === f.key ? 'rgba(255,255,255,0.25)' : T.page,
                    color: txnFilter === f.key ? '#fff' : '#9ca3af',
                    borderRadius: 9, padding: '1px 6px', lineHeight: 1.5,
                  }}>{f.count}</span>
                </button>
              ))}
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' as const }}>
              <input
                style={{ ...s.input, flex: '1 1 240px', fontSize: 12 }}
                placeholder="Search description, bank category, account…"
                value={txSearch}
                onChange={e => { setTxSearch(e.target.value); setTxPage(1); setTxSelected(new Set()) }}
              />
              <input
                type="date"
                value={txDateFrom}
                onChange={e => { setTxDateFrom(e.target.value); setTxPage(1) }}
                style={{ ...s.input, width: 140, fontSize: 12 }}
                title="From date"
              />
              <span style={{ fontSize: 11, color: T.charcoal, opacity: 0.5 }}>→</span>
              <input
                type="date"
                value={txDateTo}
                onChange={e => { setTxDateTo(e.target.value); setTxPage(1) }}
                style={{ ...s.input, width: 140, fontSize: 12 }}
                title="To date"
              />
              {(txDateFrom || txDateTo) && (
                <button
                  style={{ ...s.btnSecondary, fontSize: 11, padding: '4px 8px', flexShrink: 0 }}
                  onClick={() => { setTxDateFrom(''); setTxDateTo(''); setTxPage(1) }}
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, padding: '8px 12px', background: '#f0fdf4', border: `1px solid #bbf7d0`, borderRadius: 8, flexWrap: 'wrap' as const }}>
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
                      setNewAccName(name); setNewAccSection('Operating Expenses'); setNewAccParent('')
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
                  onClick={() => { setTxSelected(new Set()); setTxBulkAccount('') }}
                >
                  Clear
                </button>
              </div>
            )}

            {/* Table */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, width: 32, padding: '7px 8px' }}>
                      <input type="checkbox" checked={txAllPageSel} onChange={toggleTxPageAll} />
                    </th>
                    {([
                      { col: 'transaction_date' as const, label: 'Date' },
                      { col: 'description'      as const, label: 'Description' },
                      { col: 'category'         as const, label: 'Bank Category' },
                      { col: 'account'          as const, label: 'Account' },
                      { col: 'amount'           as const, label: 'Amount', right: true },
                    ]).map(({ col, label, right }) => (
                      <th
                        key={col}
                        style={{ ...s.th, cursor: 'pointer', userSelect: 'none', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}
                        onClick={() => setTxSort(col)}
                      >
                        {label}{' '}
                        <span style={{ opacity: txSortCol === col ? 0.75 : 0.25 }}>
                          {txSortCol === col ? (txSortDir === 'asc' ? '▲' : '▼') : '⇅'}
                        </span>
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
                      <td style={{ ...s.td, padding: '5px 10px', whiteSpace: 'nowrap' }}>{t.transaction_date}</td>
                      <td style={{ ...s.td, padding: '5px 10px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '—'}</td>
                      <td style={{ ...s.td, padding: '5px 10px', color: t.category ? T.charcoal : '#c0bdb7' }}>{t.category || '—'}</td>
                      <td style={{ ...s.td, padding: '4px 6px', minWidth: 180 }} onClick={e => e.stopPropagation()}>
                        {txEditId === t.id ? (
                          <div
                            tabIndex={-1}
                            onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTxEditId(null) }}
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
                                setCreateModal({ categoryKey: (t.category as string) || '', accountName: name, txnIds: [t.id] })
                                setNewAccName(name); setNewAccSection('Operating Expenses'); setNewAccParent('')
                                setTxEditId(null)
                              }}
                            />
                          </div>
                        ) : (
                          <div
                            onClick={() => { setTxEditId(t.id); setTxEditVal(t.account || '') }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            style={{ cursor: 'pointer', color: t.account ? T.charcoal : '#c0bdb7', padding: '3px 6px', borderRadius: 4, fontSize: 12 }}
                          >
                            {t.account || '— assign —'}
                          </div>
                        )}
                      </td>
                      <td style={{ ...s.td, padding: '5px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: Number(t.amount) < 0 ? '#dc2626' : '#16a34a' }}>
                        {Number(t.amount) < 0 ? '−' : '+'}${Math.abs(Number(t.amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ ...s.td, padding: '4px 8px', width: 36, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => deleteTxns([t.id])}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0bdb7', fontSize: 14, padding: '2px 4px', lineHeight: 1 }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#c0bdb7')}
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                  {txPagedTxns.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
                      {txSearch ? 'No transactions match that search' : 'No transactions'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {txTotalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 12, color: T.charcoal }}>
                <button
                  style={{ ...s.btnSecondary, padding: '4px 12px', opacity: txPage <= 1 ? 0.4 : 1 }}
                  disabled={txPage <= 1}
                  onClick={() => setTxPage(p => p - 1)}
                >← Prev</button>
                <span style={{ color: '#9ca3af' }}>Page {txPage} of {txTotalPages}</span>
                <button
                  style={{ ...s.btnSecondary, padding: '4px 12px', opacity: txPage >= txTotalPages ? 0.4 : 1 }}
                  disabled={txPage >= txTotalPages}
                  onClick={() => setTxPage(p => p + 1)}
                >Next →</button>
              </div>
            )}
          </div>
        )}
      </div>

      {createModal && (
        <div style={m.overlay} onClick={e => { if (e.target === e.currentTarget) setCreateModal(null) }}>
          <div style={{ ...m.modal, maxWidth: 460 }}>
            <div style={m.head}>
              <h3 style={m.title}>Create New Account</h3>
              <button style={m.closeBtn} onClick={() => setCreateModal(null)}>✕</button>
            </div>
            <div style={m.body}>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.5 }}>
                &ldquo;{createModal.accountName}&rdquo; doesn&apos;t exist yet. Create it to apply the mapping.
              </p>
              <IRow label="Account Name">
                <input style={m.input} value={newAccName} onChange={e => setNewAccName(e.target.value)} autoFocus />
              </IRow>
              <IRow label="Section">
                <select style={m.select} value={newAccSection} onChange={e => { setNewAccSection(e.target.value); setNewAccParent('') }}>
                  <optgroup label="— P&L —">
                    {PL_SECTIONS.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                  </optgroup>
                  <optgroup label="— Balance Sheet —">
                    {BS_SECTIONS.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                  </optgroup>
                </select>
              </IRow>
              <IRow label="Parent (optional)">
                <select style={m.select} value={newAccParent} onChange={e => setNewAccParent(e.target.value)}>
                  <option value="">— none —</option>
                  {allCats.filter(c => catSectionMap[c] === newAccSection).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </IRow>
              <div style={m.actions}>
                <button style={m.btnSec} onClick={() => setCreateModal(null)}>Cancel</button>
                <button style={m.btnPri} onClick={createAndApplyAccount} disabled={!newAccName.trim() || savingNewAcc}>
                  {savingNewAcc ? 'Creating…' : 'Create & Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <ImportModal
          clientId={clientId} allCats={allCats} catSectionMap={catSectionMap} existingTxns={txns}
          onDone={() => { setShowImport(false); load() }}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}

// ─── Coverage Panel ───────────────────────────────────────────────────────────

function CoveragePanel({ coverage }: { coverage: { accounts: string[]; months: string[]; map: Record<string, Record<string, number>> } }) {
  const { accounts, months, map } = coverage
  const fmtMonth = (ym: string) => {
    const [y, mo] = ym.split('-')
    return new Date(+y, +mo - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' })
  }
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, padding: '12px 16px', marginBottom: 16, overflowX: 'auto' }}>
      <h3 style={{ fontSize: 10.5, fontWeight: 700, color: T.gold, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 10px' }}>Upload Coverage</h3>
      <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ padding: '4px 10px 4px 0', textAlign: 'left', color: T.charcoal, fontWeight: 600, whiteSpace: 'nowrap', minWidth: 130 }}>Account</th>
            {months.map(ym => (
              <th key={ym} style={{ padding: '4px 6px', textAlign: 'center', color: T.charcoal, fontWeight: 500, whiteSpace: 'nowrap' }}>{fmtMonth(ym)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {accounts.map(acct => (
            <tr key={acct}>
              <td style={{ padding: '3px 10px 3px 0', color: T.charcoal, whiteSpace: 'nowrap', fontWeight: 500 }}>{acct}</td>
              {months.map(ym => {
                const count = map[acct]?.[ym] ?? 0
                return (
                  <td key={ym} style={{ padding: '3px 6px', textAlign: 'center' }}>
                    {count > 0
                      ? <span style={{ display: 'inline-block', background: '#D1E8D4', color: '#1A5C28', borderRadius: 3, padding: '1px 7px', fontWeight: 500 }}>{count}</span>
                      : <span style={{ display: 'inline-block', background: T.page, color: '#C0BDB7', borderRadius: 3, padding: '1px 7px' }}>—</span>
                    }
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Import Modal ─────────────────────────────────────────────────────────────

function autoDetectCols(headers: string[]): Partial<CsvCfg> & { cols: Record<string, string> } {
  const find = (candidates: string[]) => {
    const h = headers.map(x => x.toLowerCase().trim())
    for (const c of candidates) {
      const idx = h.findIndex(x => x === c || x.includes(c))
      if (idx >= 0) return headers[idx]
    }
    return ''
  }
  const credit = find(['cr amount','credit amount','credit','deposits'])
  const debit  = find(['db amount','debit amount','debit','withdrawals'])
  const splitAmounts = !!(credit || debit)
  return {
    splitAmounts,
    cols: {
      transaction_date: find(['date','posted date','posting date','transaction date','trans date']),
      description:      find(['description','memo','payee','narrative','details','name','transaction description']),
      amount:           splitAmounts ? '' : find(['amount','transaction amount','net amount']),
      account:          find(['account name','account number','account']),
      reference_id:     find(['ref num','reference','ref','check number','transaction id','confirmation']),
      category:         find(['category']),
      credit, debit,
    },
  }
}

interface ImportModalProps {
  clientId: string; allCats: string[]; catSectionMap: Record<string, string>; existingTxns: Txn[]
  onDone: () => void; onClose: () => void
}

function ImportModal({ clientId, allCats, catSectionMap, existingTxns, onDone, onClose }: ImportModalProps) {
  const [step,       setStep]       = useState<string>('upload')
  const [dragOver,   setDragOver]   = useState(false)
  const [csv,        setCsv]        = useState<CsvData | null>(null)
  const [cfg,        setCfg]        = useState<CsvCfg>(DEFAULT_CFG)
  const [mapError,   setMapError]   = useState('')
  const [parsed,     setParsed]     = useState<ParsedRow[]>([])
  const [parseErrs,  setParseErrs]  = useState<Array<{ line: number; msg: string }>>([])
  const [catLoading, setCatLoading] = useState(false)
  const [toInsert,   setToInsert]   = useState<ParsedRow[]>([])
  const [dupCount,   setDupCount]   = useState(0)
  const [newGroups,  setNewGroups]  = useState<MerchantGroup[]>([])
  const [catAssign,  setCatAssign]  = useState<Record<string, string>>({})
  const [expanded,   setExpanded]   = useState<Record<string, boolean>>({})
  const [result,     setResult]     = useState<{ inserted: number; skipped: number; errors: string[]; parseErrors: unknown[] } | null>(null)
  const [showInstr,  setShowInstr]  = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const groupedCats = useMemo(() => {
    const bySection: Record<string, string[]> = {}
    allCats.forEach(name => {
      const sec = catSectionMap[name] ?? 'Other'
      if (!bySection[sec]) bySection[sec] = []
      bySection[sec].push(name)
    })
    const ordered = ALL_SECTIONS.filter(s => bySection[s]?.length).map(s => ({ section: s, accounts: bySection[s] }))
    if (bySection['Other']?.length) ordered.push({ section: 'Other', accounts: bySection['Other'] })
    return ordered.length ? ordered : null
  }, [allCats, catSectionMap])

  const handleFile = useCallback((file: File | null | undefined) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) { setMapError('Please select a .csv file'); return }
    const reader = new FileReader()
    reader.onload = e => {
      let text = (e.target?.result as string).replace(/^﻿/, '')
      const allLines = text.split(/\r?\n/)
      let txnSectionStart = 0
      for (let i = 0; i < allLines.length; i++) {
        const lower = allLines[i].toLowerCase()
        if (lower.includes('date') && lower.includes('description')) txnSectionStart = i
      }
      if (txnSectionStart > 0) text = allLines.slice(txnSectionStart).join('\n')
      const raw = parseCSVText(text)
      if (!raw.headers.length) { setMapError('Could not parse CSV — no headers found'); return }
      const data: CsvData = {
        headers: raw.headers,
        rows: raw.rows.filter(r => {
          const firstVal = (Object.values(r)[0] || '').trim()
          return firstVal.toLowerCase() !== 'totals' && !firstVal.includes(' - ')
        }),
      }
      const { cols, splitAmounts } = autoDetectCols(data.headers)
      const base = DEFAULT_CFG()
      setCsv(data); setCfg({ ...base, cols: { ...base.cols, ...cols }, splitAmounts: splitAmounts ?? false }); setMapError(''); setStep('mapping')
    }
    reader.readAsText(file)
  }, [])

  const unbundle = useCallback((fromGroupKey: string, row: ParsedRow) => {
    const uniqueKey = `unbundled_${Date.now()}_${Math.random().toString(36).slice(2)}`
    setNewGroups(gs => {
      const updated = gs.map(g => {
        if (g.key !== fromGroupKey) return g
        const remaining = (g.txns as ParsedRow[]).filter(t => t !== row)
        return { ...g, txns: remaining, total: remaining.reduce((s, t) => s + t.amount, 0) }
      }).filter(g => g.txns.length > 0)
      return [...updated, { key: uniqueKey, displayDesc: row.description, txns: [row], total: row.amount, suggestedCat: '', variants: [] }]
    })
    setCatAssign(prev => ({ ...prev, [uniqueKey]: prev[fromGroupKey] ?? '' }))
  }, [])

  const setCol  = (key: string, val: string) => { setCfg(c => ({ ...c, cols: { ...c.cols, [key]: val } })); setMapError('') }
  const setProp = (key: keyof CsvCfg, val: unknown) => setCfg(c => ({ ...c, [key]: val }))

  const onApplyMapping = () => {
    const { cols, dateFormat, splitAmounts, debitsPositive, bankName } = cfg
    if (!cols.transaction_date)                      { setMapError('Please map the Date column'); return }
    if (!cols.description)                           { setMapError('Please map the Description column'); return }
    if (!splitAmounts && !cols.amount)               { setMapError('Please map the Amount column'); return }
    if (splitAmounts && !cols.debit && !cols.credit) { setMapError('Please map at least one of Debit or Credit'); return }
    setMapError('')
    if (bankName.trim()) saveBankMapping(bankName.trim(), cfg)

    const errors: Array<{ line: number; msg: string }> = [], rows: ParsedRow[] = []
    csv!.rows.forEach((raw, i) => {
      const line = i + 2
      const rawDate = raw[cols.transaction_date] || ''
      const date = parseDate(rawDate, dateFormat)
      if (!date) { errors.push({ line, msg: `Invalid date "${rawDate}"` }); return }
      const rawDesc = (raw[cols.description] || '').trim()
      if (!rawDesc) { errors.push({ line, msg: 'Empty description' }); return }
      let amount: number
      if (splitAmounts) {
        const credit = parseFloat((raw[cols.credit] || '0').replace(/[$,\s]/g, '')) || 0
        const debit  = parseFloat((raw[cols.debit]  || '0').replace(/[$,\s]/g, '')) || 0
        amount = credit - debit
      } else {
        const rawAmt = (raw[cols.amount] || '').replace(/[$,\s]/g, '')
        amount = parseFloat(rawAmt)
        if (isNaN(amount)) { errors.push({ line, msg: `Invalid amount "${raw[cols.amount]}"` }); return }
        if (debitsPositive) amount = -amount
      }
      rows.push({
        transaction_date: date, description: rawDesc, amount,
        ...(cols.account      && raw[cols.account]      ? { account:      raw[cols.account].trim()      } : {}),
        ...(cols.reference_id && raw[cols.reference_id] ? { reference_id: raw[cols.reference_id].trim() } : {}),
        ...(cols.category     && raw[cols.category]     ? { category:     raw[cols.category].trim()     } : {}),
        ...(clientId !== null ? { client_id: clientId } : {}),
      })
    })
    setParsed(rows); setParseErrs(errors); setStep('categorize')
  }

  useEffect(() => {
    if (step !== 'categorize') return
    let cancelled = false
    const run = async () => {
      setCatLoading(true)
      try {
        const existingFPs = new Set<string>()
        const descCatMap: Record<string, string> = {}
        existingTxns.forEach(r => {
          existingFPs.add(fingerprint(r))
          if (r.category) {
            const k = normKey(r.description)
            if (k && !descCatMap[k]) descCatMap[k] = r.category
          }
        })
        if (cancelled) return

        const seenFPs = new Set(existingFPs)
        const newRows: ParsedRow[] = [], dupes: ParsedRow[] = []
        parsed.forEach(row => {
          const fp = fingerprint(row)
          if (seenFPs.has(fp)) { dupes.push(row); return }
          newRows.push(row); seenFPs.add(fp)
        })

        const catIdx = buildCatIndex(descCatMap)
        const groupMap: Record<string, MerchantGroup> = {}
        newRows.forEach(row => {
          const key = normKey(row.description)
          if (!groupMap[key]) groupMap[key] = { key, displayDesc: row.description, txns: [], total: 0, suggestedCat: suggestCat(key, catIdx) }
          ;(groupMap[key].txns as ParsedRow[]).push(row)
          groupMap[key].total += row.amount
        })

        const rawGroups = Object.values(groupMap).sort((a, b) => a.key.localeCompare(b.key))
        const { clusters, keyToCluster: _ } = clusterGroups(rawGroups)

        const initAssign: Record<string, string> = {}
        clusters.forEach(g => {
          const importedCat = dominantCat(g.txns as Txn[])
          if (importedCat)        initAssign[g.key] = importedCat
          else if (g.suggestedCat) initAssign[g.key] = g.suggestedCat
        })

        setToInsert(newRows); setDupCount(dupes.length)
        setNewGroups(clusters); setCatAssign(initAssign)
      } catch (e: unknown) {
        alert('Error: ' + (e as Error).message); setStep('mapping')
      } finally {
        if (!cancelled) setCatLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const doUpload = async () => {
    setStep('uploading')
    try {
      const txnCatMap = new Map<ParsedRow, string>()
      newGroups.forEach(group => {
        const cat = (catAssign[group.key] || '').trim()
        ;(group.txns as ParsedRow[]).forEach(row => txnCatMap.set(row, cat))
      })
      const rowsToSave = toInsert.map(row => {
        const cat = txnCatMap.get(row) || ''
        return cat ? { ...row, category: cat } : row
      })
      let inserted = 0; const errs: string[] = []
      for (let i = 0; i < rowsToSave.length; i += 500) {
        const { data, error } = await supabase
          .from('bank_transactions').upsert(rowsToSave.slice(i, i + 500), { onConflict: 'client_id,transaction_date,description,amount', ignoreDuplicates: true }).select()
        if (error) errs.push(error.message)
        else inserted += data?.length ?? 0
      }
      setResult({ inserted, skipped: dupCount, errors: errs, parseErrors: parseErrs })
      setStep('result')
    } catch (e: unknown) {
      setResult({ inserted: 0, skipped: dupCount, errors: [(e as Error).message], parseErrors: parseErrs })
      setStep('result')
    }
  }

  const savedBanks = Object.keys(loadAllMappings())
  const colOptions = csv ? csv.headers.map(h => <option key={h} value={h}>{h}</option>) : []
  const bankDDVal  = savedBanks.includes(cfg.bankName) ? cfg.bankName : ''

  return (
    <div style={m.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={m.modal}>
        <div style={m.head}>
          <h3 style={m.title}>
            {step === 'upload'     && 'Import CSV'}
            {step === 'mapping'    && 'Map Columns'}
            {step === 'categorize' && 'Preview & Categorize'}
            {step === 'uploading'  && 'Uploading…'}
            {step === 'result'     && 'Import Complete'}
          </h3>
          <button style={m.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={m.body}>
          {step === 'upload' && (
            <div>
              <div
                style={{ ...m.dropzone, ...(dragOver ? m.dropzoneOn : {}) }}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileRef.current!.click()}
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={T.gold} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 14 }}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  <line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 11 15 14"/>
                </svg>
                <p style={{ fontSize: 14, margin: '0 0 5px', color: T.sage, fontWeight: 500 }}>
                  Drag &amp; drop a CSV file, or <strong>click to browse</strong>
                </p>
                <p style={{ fontSize: 11, color: T.charcoal, margin: 0, opacity: .7 }}>Supports most bank CSV exports — column mapping happens next</p>
                <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
              </div>

              <div style={m.instrWrap}>
                <button style={m.instrToggle} onClick={() => setShowInstr(v => !v)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5, flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
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
                      <li>Look for an <strong>Export</strong> or <strong>Download</strong> option</li>
                      <li>Select <strong>CSV</strong> format and your desired date range, then download</li>
                      <li>Upload the file here — you&apos;ll map the columns in the next step</li>
                    </ol>
                    <p style={{ fontSize: 12, color: '#9ca3af', margin: '8px 0 0' }}>
                      The system automatically detects most formats. If columns aren&apos;t mapped correctly you can adjust them manually.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'mapping' && csv && (
            <div>
              <p style={m.sub}>{csv.rows.length} rows · columns: <em>{csv.headers.join(', ')}</em></p>
              <ISection title="Bank">
                <IRow label="Saved banks">
                  <select style={m.select} value={bankDDVal} onChange={e => {
                    const val = e.target.value; if (!val) return
                    const all = loadAllMappings()
                    if (all[val]) setCfg({ ...all[val], bankName: val })
                    else setProp('bankName', val)
                  }}>
                    <option value="">— Select to load saved mapping —</option>
                    {savedBanks.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </IRow>
                <IRow label="Bank name (to save)">
                  <input style={m.input} value={cfg.bankName} onChange={e => setProp('bankName', e.target.value)} placeholder="e.g. Chase Checking" />
                </IRow>
              </ISection>

              <ISection title="Map CSV Columns">
                {STANDARD_FIELDS.filter(f => !(cfg.splitAmounts && f.key === 'amount')).map(f => {
                  const req = f.key === 'transaction_date' || f.key === 'description' || (f.key === 'amount' && !cfg.splitAmounts)
                  return (
                    <IRow key={f.key} label={<>{f.label}{req && <span style={{ color: '#dc2626' }}> *</span>}</>}>
                      <select style={m.select} value={cfg.cols[f.key]} onChange={e => setCol(f.key, e.target.value)}>
                        <option value="">— not mapped —</option>{colOptions}
                      </select>
                    </IRow>
                  )
                })}
              </ISection>

              <ISection title="Date Format">
                <IRow label={<>Format<span style={{ color: '#dc2626' }}> *</span></>}>
                  <select style={m.select} value={cfg.dateFormat} onChange={e => setProp('dateFormat', e.target.value)}>
                    {DATE_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
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
                  <input type="checkbox" checked={cfg.splitAmounts} onChange={e => setProp('splitAmounts', e.target.checked)} />
                </IRow>
                {cfg.splitAmounts ? (
                  <>
                    <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 232px' }}>Net = credit − debit</p>
                    <IRow label="Credit column (money in)">
                      <select style={m.select} value={cfg.cols.credit} onChange={e => setCol('credit', e.target.value)}><option value="">— not mapped —</option>{colOptions}</select>
                    </IRow>
                    <IRow label="Debit column (money out)">
                      <select style={m.select} value={cfg.cols.debit} onChange={e => setCol('debit', e.target.value)}><option value="">— not mapped —</option>{colOptions}</select>
                    </IRow>
                  </>
                ) : (
                  <>
                    <IRow label="Debits shown as positive numbers">
                      <input type="checkbox" checked={cfg.debitsPositive} onChange={e => setProp('debitsPositive', e.target.checked)} />
                    </IRow>
                    <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 0 232px' }}>Sign will be flipped if enabled.</p>
                  </>
                )}
              </ISection>

              {mapError && <div style={{ ...m.errBox, marginTop: 12 }}>{mapError}</div>}
              <div style={m.actions}>
                <button style={m.btnSec} onClick={() => setStep('upload')}>← Back</button>
                <button style={m.btnPri} onClick={onApplyMapping}>Continue →</button>
              </div>
            </div>
          )}

          {step === 'categorize' && (
            <div>
              {catLoading ? (
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                  <div style={m.spinner} />
                  <p style={{ color: '#6b7280', marginTop: 12 }}>Checking for duplicates…</p>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <StatCard label="New transactions"   value={toInsert.length}  color="#2563eb" />
                    <StatCard label="Duplicates skipped" value={dupCount}         color="#d97706" />
                    <StatCard label="Parse errors"       value={parseErrs.length} color={parseErrs.length ? '#dc2626' : '#9ca3af'} />
                  </div>
                  {parseErrs.length > 0 && (
                    <div style={m.errBox}>
                      <strong>{parseErrs.length} row(s) could not be parsed:</strong>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                        {parseErrs.slice(0, 8).map((e, i) => <li key={i}>Line {e.line}: {e.msg}</li>)}
                        {parseErrs.length > 8 && <li>…and {parseErrs.length - 8} more</li>}
                      </ul>
                    </div>
                  )}
                  {toInsert.length === 0 ? (
                    <p style={{ color: '#6b7280', fontSize: 14, padding: '16px 0' }}>All {dupCount} rows already exist — nothing new to import.</p>
                  ) : (
                    <>
                      {(() => {
                        const uncatCount = newGroups.filter(g => !(catAssign[g.key] || '').trim()).length
                        const hasSugg = Object.keys(catAssign).length > 0
                        return (
                          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {hasSugg && <span>Purple dot = category suggested from previous transactions. Change any before importing.</span>}
                            {uncatCount > 0 && (
                              <span style={{ color: '#d97706' }}>
                                {uncatCount} group{uncatCount !== 1 ? 's' : ''} without a category — they will import uncategorized.
                              </span>
                            )}
                          </div>
                        )
                      })()}
                      <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                        <table style={m.table}>
                          <thead>
                            <tr>
                              <th style={m.th}>Description</th>
                              <th style={{ ...m.th, minWidth: 220 }}>Category</th>
                              <th style={{ ...m.th, width: 60, textAlign: 'right' }}>Txns</th>
                              <th style={{ ...m.th, width: 100, textAlign: 'right' }}>Total</th>
                              <th style={{ ...m.th, width: 36 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {newGroups.map((g, i) => {
                              const cat    = catAssign[g.key] ?? ''
                              const isSugg = cat !== '' && cat === g.suggestedCat
                              const isExp  = !!expanded[g.key]
                              return (
                                <Fragment key={g.key}>
                                  <tr style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                                    <td style={{ ...m.td, maxWidth: 0, width: '99%', overflow: 'hidden' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                                        {isSugg && <span style={s.suggDot} />}
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.displayDesc}</span>
                                        {(g.variants?.length ?? 0) > 0 && <span style={s.badge}>+{g.variants!.length} similar</span>}
                                      </div>
                                    </td>
                                    <td style={m.td}>
                                      <CategoryInput
                                        value={cat}
                                        onChange={val => setCatAssign(p => ({ ...p, [g.key]: val }))}
                                        categories={allCats} groups={groupedCats}
                                        style={isSugg ? { border: '1px solid #a78bfa', background: '#faf5ff' } : {}}
                                      />
                                    </td>
                                    <td style={{ ...m.td, textAlign: 'right', color: '#9ca3af', fontSize: 13 }}>{(g.txns as ParsedRow[]).length}</td>
                                    <td style={{ ...m.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: g.total < 0 ? '#dc2626' : '#16a34a' }}>{g.total.toFixed(2)}</td>
                                    <td style={m.td}>
                                      <button style={s.expandBtn} onClick={() => setExpanded(p => ({ ...p, [g.key]: !p[g.key] }))}>{isExp ? '▲' : '▼'}</button>
                                    </td>
                                  </tr>
                                  {isExp && (
                                    <tr>
                                      <td colSpan={5} style={{ padding: 0, background: '#f0f9ff', borderBottom: '2px solid #bae6fd' }}>
                                        <div style={{ padding: '8px 12px 10px 16px' }}>
                                          {(g.variants?.length ?? 0) > 0 && (
                                            <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 6px' }}>
                                              <strong>Grouped:</strong> {[g.displayDesc, ...(g.variants ?? [])].join(', ')}
                                            </p>
                                          )}
                                          <table style={{ ...m.table, fontSize: 12 }}>
                                            <thead>
                                              <tr>{['Date','Description','Amount',''].map((h, hi) => (
                                                <th key={hi} style={{ ...m.th, background: '#e0f2fe', padding: '5px 8px', fontSize: 11 }}>{h}</th>
                                              ))}</tr>
                                            </thead>
                                            <tbody>
                                              {(g.txns as ParsedRow[]).map((r, ri) => (
                                                <tr key={ri} style={{ background: '#fff' }}>
                                                  <td style={{ ...m.td, padding: '4px 8px', whiteSpace: 'nowrap' }}>{r.transaction_date}</td>
                                                  <td style={{ ...m.td, padding: '4px 8px', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                                                  <td style={{ ...m.td, padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.amount < 0 ? '#dc2626' : '#16a34a' }}>{r.amount.toFixed(2)}</td>
                                                  <td style={{ ...m.td, padding: '2px 6px', width: 28 }}>
                                                    {(g.txns as ParsedRow[]).length > 1 && (
                                                      <button title="Move to its own category group" style={s.unbundleBtn} onClick={() => unbundle(g.key, r)}>↗</button>
                                                    )}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  <div style={m.actions}>
                    <button style={m.btnSec} onClick={() => setStep('mapping')}>← Back</button>
                    {toInsert.length > 0 && (
                      <button style={m.btnPri} onClick={doUpload}>Import {toInsert.length} transaction{toInsert.length !== 1 ? 's' : ''}</button>
                    )}
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
                <StatCard label="Imported"      value={result.inserted}               color="#16a34a" />
                <StatCard label="Duplicates"    value={result.skipped}                color="#d97706" />
                <StatCard label="Parse errors"  value={(result.parseErrors as unknown[])?.length ?? 0} color="#9ca3af" />
                <StatCard label="Insert errors" value={result.errors.length}          color={result.errors.length ? '#dc2626' : '#9ca3af'} />
              </div>
              {result.errors.length > 0 && (
                <div style={m.errBox}>
                  <strong>Insert errors:</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              )}
              <div style={m.actions}><button style={m.btnPri} onClick={onDone}>Done</button></div>
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
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
      <h4 style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '.05em', margin: '0 0 10px' }}>{title}</h4>
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
    <div style={{ flex: '1 1 100px', minWidth: 100, background: '#fff', border: '1px solid #e2e8f0', borderTop: `3px solid ${color}`, borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  )
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  sage: '#2C5F52', gold: '#C8A96E', charcoal: '#4A4A3F',
  page: '#F5F0E8', card: '#FAFAF8', border: '#D9D4C8',
  success: '#059669', danger: '#DC2626', amber: '#D97706',
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  wrap:         { width: '100%', background: T.page, minHeight: '100%' },
  pageHeader:   { display: 'flex' as const, justifyContent: 'space-between' as const, alignItems: 'flex-start' as const, padding: '14px 28px', background: T.card, borderBottom: `1px solid ${T.border}` },
  h2:           { fontSize: 14, fontWeight: 600, color: T.sage, margin: '0 0 2px' },
  sub:          { fontSize: 11, color: 'rgba(74,74,63,0.65)', margin: 0 },
  savedMsg:     { fontSize: 11, color: T.success, fontWeight: 500 },
  center:       { display: 'flex' as const, flexDirection: 'column' as const, alignItems: 'center' as const, justifyContent: 'center' as const, minHeight: 300, background: T.page },
  spinner:      { width: 28, height: 28, border: `2px solid ${T.border}`, borderTopColor: T.sage, borderRadius: '50%', animation: 'spin .7s linear infinite' },
  errorBox:     { background: '#FDE8E8', border: '1px solid #F5C2C2', borderRadius: 6, padding: '10px 14px', fontSize: 11, color: '#991B1B', marginBottom: 14 },
  content:      { padding: '20px 28px' },
  toolbar:      { display: 'flex' as const, gap: 8, alignItems: 'center' as const, marginBottom: 14, flexWrap: 'wrap' as const },
  input:        { padding: '5px 9px', border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 11, color: T.charcoal, background: '#fff', outline: 'none' },
  tabs:         { display: 'flex' as const, gap: 2 },
  tab:          { padding: '5px 12px', border: `1px solid ${T.border}`, borderRadius: 5, background: '#fff', fontSize: 11, color: T.charcoal, cursor: 'pointer', fontWeight: 400 },
  tabActive:    { background: T.sage, color: '#fff', borderColor: T.sage, fontWeight: 500 },
  fuzzyLabel:   { display: 'flex' as const, alignItems: 'center' as const, gap: 6, fontSize: 11, color: T.charcoal, cursor: 'pointer', userSelect: 'none' as const },
  bulkBar:      { display: 'flex' as const, gap: 8, alignItems: 'center' as const, background: '#E8F0EE', border: '1px solid #B8D4CC', borderRadius: 6, padding: '8px 12px', marginBottom: 12, flexWrap: 'wrap' as const },
  table:        { width: '100%', borderCollapse: 'collapse' as const },
  th:           { background: T.page, padding: '7px 10px', textAlign: 'left' as const, fontWeight: 700, borderBottom: `2px solid ${T.border}`, fontSize: 9.5, color: T.gold, textTransform: 'uppercase' as const, letterSpacing: '.06em', whiteSpace: 'nowrap' as const },
  td:           { padding: '7px 10px', borderBottom: `1px solid ${T.border}`, verticalAlign: 'middle' as const, fontSize: 12, color: T.charcoal },
  dirtyDot:     { flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: T.sage, display: 'inline-block' as const },
  sepTag:       { flexShrink: 0, fontSize: 9.5, color: '#9ca3af', background: T.page, border: `1px solid ${T.border}`, borderRadius: 3, padding: '1px 5px' },
  badge:        { flexShrink: 0, fontSize: 10, fontWeight: 500, color: '#4A7B6A', background: '#E8F0EE', borderRadius: 3, padding: '1px 6px', whiteSpace: 'nowrap' as const, cursor: 'default' },
  suggRow:      { display: 'flex' as const, alignItems: 'center' as const, gap: 5, marginBottom: 4 },
  suggDot:      { flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: T.gold, display: 'inline-block' as const },
  suggLabel:    { fontSize: 11, color: T.gold, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  acceptBtn:    { flexShrink: 0, padding: '1px 7px', background: '#E6F0E9', color: '#047857', border: '1px solid #B8D4BE', borderRadius: 3, fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  rejectBtn:    { flexShrink: 0, padding: '1px 5px', background: '#FDE8E8', color: T.danger, border: '1px solid #F5C2C2', borderRadius: 3, fontSize: 11, cursor: 'pointer' },
  expandBtn:    { background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 10, padding: '2px 5px', lineHeight: 1 },
  separateBtn:  { padding: '2px 8px', background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D', borderRadius: 3, fontSize: 10, fontWeight: 500, cursor: 'pointer' },
  rejoinBtn:    { padding: '2px 8px', background: '#E8F0EE', color: T.sage, border: `1px solid #B8D4CC`, borderRadius: 3, fontSize: 10, fontWeight: 500, cursor: 'pointer' },
  pager:        { display: 'flex' as const, justifyContent: 'center' as const, alignItems: 'center' as const, gap: 14, marginTop: 20 },
  btnPrimary:   { padding: '6px 16px', background: T.sage, color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer' },
  btnSecondary: { padding: '6px 14px', background: '#fff', color: T.charcoal, border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer' },
  btnOutline:   { padding: '6px 14px', background: 'transparent', color: T.gold, border: `1px solid ${T.gold}`, borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer' },
  btnDisabled:  { opacity: 0.45, cursor: 'not-allowed' as const },
  btnDanger:    { padding: '6px 14px', background: '#FDE8E8', color: T.danger, border: '1px solid #F5C2C2', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer' },
  unbundleBtn:  { fontSize: 11, padding: '1px 5px', background: 'none', border: `1px solid ${T.border}`, borderRadius: 3, cursor: 'pointer', color: '#6b7280', lineHeight: 1.4 },
}

const m = {
  overlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(44,95,82,.4)', display: 'flex' as const, alignItems: 'flex-start' as const, justifyContent: 'center' as const, zIndex: 1000, padding: '40px 16px', overflowY: 'auto' as const },
  modal:       { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 800, boxShadow: '0 20px 60px rgba(0,0,0,.18)', display: 'flex' as const, flexDirection: 'column' as const },
  head:        { display: 'flex' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, padding: '14px 20px', borderBottom: `1px solid ${T.border}` },
  title:       { fontSize: 14, fontWeight: 600, color: T.sage, margin: 0 },
  closeBtn:    { background: 'none', border: 'none', fontSize: 15, color: '#9ca3af', cursor: 'pointer', padding: '3px 7px', borderRadius: 4 },
  body:        { padding: '20px 22px', overflowY: 'auto' as const },
  sub:         { fontSize: 11, color: T.charcoal, margin: '0 0 14px' },
  input:       { width: '100%', padding: '5px 9px', border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 12, color: T.charcoal, background: '#fff', outline: 'none', boxSizing: 'border-box' as const },
  select:      { width: '100%', padding: '5px 9px', border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 12, color: T.charcoal, background: '#fff', outline: 'none' },
  actions:     { display: 'flex' as const, justifyContent: 'flex-end' as const, gap: 8, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.border}` },
  btnPri:      { padding: '7px 20px', background: T.sage, color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  btnSec:      { padding: '7px 18px', background: '#fff', color: T.charcoal, border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  table:       { width: '100%', borderCollapse: 'collapse' as const },
  th:          { background: T.page, padding: '7px 10px', textAlign: 'left' as const, fontWeight: 700, borderBottom: `2px solid ${T.border}`, fontSize: 9.5, color: T.gold, textTransform: 'uppercase' as const, letterSpacing: '.06em', whiteSpace: 'nowrap' as const },
  td:          { padding: '7px 10px', borderBottom: `1px solid ${T.border}`, verticalAlign: 'middle' as const, fontSize: 12, color: T.charcoal },
  dropzone:    { border: `2px dashed ${T.border}`, borderRadius: 8, padding: '52px 24px', textAlign: 'center' as const, cursor: 'pointer', background: T.page, userSelect: 'none' as const, transition: 'border-color .2s, background .2s' },
  dropzoneOn:  { borderColor: T.sage, background: '#E8F0EE' },
  spinner:     { display: 'inline-block', width: 28, height: 28, border: `2px solid ${T.border}`, borderTopColor: T.sage, borderRadius: '50%', animation: 'spin .7s linear infinite' },
  errBox:      { background: '#FDE8E8', border: '1px solid #F5C2C2', borderRadius: 6, padding: '10px 14px', fontSize: 11, color: '#991B1B', marginBottom: 14 },
  instrWrap:   { marginTop: 14, border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden' as const },
  instrToggle: { display: 'flex' as const, alignItems: 'center' as const, width: '100%', padding: '9px 12px', background: T.page, border: 'none', cursor: 'pointer', fontSize: 12, color: T.charcoal, fontWeight: 500, gap: 4 },
  instrBody:   { padding: '14px 16px', background: '#fff', borderTop: `1px solid ${T.border}` },
  instrTitle:  { fontSize: 12, fontWeight: 600, color: T.sage, margin: '0 0 6px' },
  instrList:   { fontSize: 12, color: T.charcoal, margin: '0 0 12px', paddingLeft: 20, lineHeight: 1.7 },
}
