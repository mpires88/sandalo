'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  PL_SECTIONS,
  BS_SECTIONS,
  DEFAULT_ACCOUNTS,
  isPLSection,
  isBSSection,
  mergeAccounts,
  type MergedAccount,
} from '@/lib/chartOfAccounts'
import { type FinancialAccount, accountSection, ACCOUNT_TYPE_LABELS } from '@/components/FinancialAccounts'

const T = {
  sage: '#2C5F52',
  gold: '#C8A96E',
  charcoal: '#4A4A3F',
  page: '#F5F0E8',
  card: '#FAFAF8',
  border: '#D9D4C8',
  danger: '#DC2626',
}

type DisplayRow = { account: MergedAccount; depth: number }
type SectionRow =
  | { kind: 'coa'; account: MergedAccount; depth: number }
  | { kind: 'fa'; finAccount: FinancialAccount; depth: number }

const FA_DEFAULT_SECTION: Record<'asset' | 'liability', string> = {
  asset: 'Current Assets',
  liability: 'Current Liabilities',
}

function mergeFARows(displayList: DisplayRow[], sectionFAs: FinancialAccount[]): SectionRow[] {
  const result: SectionRow[] = []
  for (const row of displayList) {
    result.push({ kind: 'coa', ...row })
    sectionFAs
      .filter(fa => fa.parent_category === row.account.name)
      .forEach(fa => result.push({ kind: 'fa', finAccount: fa, depth: row.depth + 1 }))
  }
  sectionFAs.filter(fa => !fa.parent_category).forEach(fa => result.push({ kind: 'fa', finAccount: fa, depth: 0 }))
  return result
}

function buildDisplayList(sectionAccounts: MergedAccount[]): DisplayRow[] {
  const alpha = (a: MergedAccount, b: MergedAccount) => a.name.localeCompare(b.name)
  const byParent: Record<string, MergedAccount[]> = {}
  sectionAccounts.forEach(a => {
    const key = a.parent ?? ''
    if (!byParent[key]) byParent[key] = []
    byParent[key].push(a)
  })
  Object.values(byParent).forEach(arr => arr.sort(alpha))

  const result: DisplayRow[] = []
  const placed = new Set<string>()

  function addWithChildren(name: string, depth: number) {
    const acct = sectionAccounts.find(a => a.name === name)
    if (!acct || placed.has(name)) return
    placed.add(name)
    result.push({ account: acct, depth })
    ;(byParent[name] ?? []).forEach(child => addWithChildren(child.name, depth + 1))
  }

  ;(byParent[''] ?? []).forEach(a => addWithChildren(a.name, 0))
  // Orphaned accounts whose parent is not in this section
  sectionAccounts
    .filter(a => !placed.has(a.name))
    .sort(alpha)
    .forEach(a => result.push({ account: a, depth: 0 }))
  return result
}

function getAllDescendants(name: string, all: MergedAccount[]): MergedAccount[] {
  const result: MergedAccount[] = []
  const queue = all.filter(a => a.parent === name)
  while (queue.length) {
    const cur = queue.shift()!
    result.push(cur)
    all.filter(a => a.parent === cur.name).forEach(a => queue.push(a))
  }
  return result
}

export default function ChartOfAccounts({ clientId }: { clientId: string }) {
  const [accounts, setAccounts] = useState<MergedAccount[]>([])
  const [finAccounts, setFinAccounts] = useState<FinancialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'pl' | 'bs'>('pl')

  const [editKey, setEditKey] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editParent, setEditParent] = useState('')

  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newSection, setNewSection] = useState('Operating Expenses')
  const [newParent, setNewParent] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [{ data, error: err }, { data: faData }] = await Promise.all([
        supabase
          .from('categories')
          .select('name, sort_order, pl_section, parent')
          .eq('client_id', clientId)
          .order('sort_order'),
        supabase.from('financial_accounts').select('*').eq('client_id', clientId).order('sort_order'),
      ])
      setFinAccounts(faData ?? [])
      if (err) {
        setError(err.message)
        return
      }

      const existingNames = new Set((data ?? []).map((r: { name: string }) => r.name))
      const missing = DEFAULT_ACCOUNTS.filter(a => !existingNames.has(a.name))
      if (missing.length && clientId) {
        const rows = missing.map(a => ({
          client_id: clientId,
          name: a.name,
          sort_order: a.sort_order,
          pl_section: a.pl_section,
          parent: a.parent ?? null,
        }))
        await supabase.from('categories').upsert(rows, { onConflict: 'name' })
        const { data: fresh } = await supabase
          .from('categories')
          .select('name, sort_order, pl_section, parent')
          .eq('client_id', clientId)
          .order('sort_order')
        setAccounts(mergeAccounts(fresh ?? []))
      } else {
        setAccounts(mergeAccounts(data ?? []))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    load()
  }, [load])

  const seedDefaults = async () => {
    setSaving(true)
    const rows = DEFAULT_ACCOUNTS.map(a => ({
      client_id: clientId,
      name: a.name,
      sort_order: a.sort_order,
      pl_section: a.pl_section,
      parent: a.parent ?? null,
    }))
    const { error: err } = await supabase.from('categories').upsert(rows, { onConflict: 'name' })
    if (err) {
      alert('Seed failed: ' + err.message)
      setSaving(false)
      return
    }
    await load()
    setSaving(false)
  }

  const addAccount = async (section: string) => {
    const name = newName.trim()
    if (!name) return
    const maxOrder = accounts.reduce((m, a) => Math.max(m, a.sort_order ?? 0), 0)
    setSaving(true)
    const { error: err } = await supabase
      .from('categories')
      .insert({ client_id: clientId, name, sort_order: maxOrder + 10, pl_section: section, parent: newParent || null })
    if (err) {
      alert('Could not add account: ' + err.message)
      setSaving(false)
      return
    }
    setNewName('')
    setNewParent('')
    setAddingTo(null)
    await load()
    setSaving(false)
  }

  const saveEdit = async (oldName: string) => {
    const name = editName.trim()
    if (!name) {
      setEditKey(null)
      return
    }
    setSaving(true)
    const updates: Record<string, unknown> = { parent: editParent || null }
    if (name !== oldName) updates.name = name
    const { error: err } = await supabase.from('categories').update(updates).eq('name', oldName)
    if (err) {
      alert('Save failed: ' + err.message)
      setSaving(false)
      return
    }
    if (name !== oldName) {
      await supabase.from('categories').update({ parent: name }).eq('parent', oldName)
    }
    setEditKey(null)
    await load()
    setSaving(false)
  }

  const changeSection = async (name: string, section: string) => {
    const acc = accounts.find(a => a.name === name)
    const descendants = getAllDescendants(name, accounts)
    const detachFromParent = acc?.parent
      ? (() => {
          const p = accounts.find(a => a.name === acc.parent)
          return !p || p.pl_section !== section
        })()
      : false

    const descNames = new Set(descendants.map(d => d.name))
    setAccounts(prev =>
      prev.map(a => {
        if (a.name === name) return { ...a, pl_section: section, parent: detachFromParent ? null : a.parent }
        if (descNames.has(a.name)) return { ...a, pl_section: section }
        return a
      }),
    )

    await supabase
      .from('categories')
      .update({ pl_section: section, ...(detachFromParent ? { parent: null } : {}) })
      .eq('name', name)
    for (const d of descendants) {
      await supabase.from('categories').update({ pl_section: section }).eq('name', d.name)
    }
  }

  const changeParent = async (name: string, parentName: string | null) => {
    setAccounts(prev => prev.map(a => (a.name === name ? { ...a, parent: parentName ?? null } : a)))
    await supabase.from('categories').update({ parent: parentName }).eq('name', name)
  }

  const deleteAccount = async (name: string) => {
    const children = accounts.filter(a => a.parent === name)
    const childNote = children.length ? ` Its ${children.length} sub-account(s) will become top-level.` : ''
    if (!confirm(`Remove "${name}"?${childNote} Transactions using this category will become uncategorized.`)) return
    setSaving(true)
    const { error: err } = await supabase.from('categories').delete().eq('name', name).eq('client_id', clientId)
    if (err) {
      alert('Delete failed: ' + err.message)
      setSaving(false)
      return
    }
    // Promote direct children to their grandparent (or top-level)
    const grandparent = accounts.find(a => a.name === name)?.parent ?? null
    await supabase.from('categories').update({ parent: grandparent }).eq('parent', name).eq('client_id', clientId)
    await load()
    setSaving(false)
  }

  const changeFAParent = async (fa: FinancialAccount, parentName: string | null) => {
    setFinAccounts(prev => prev.map(a => (a.id === fa.id ? { ...a, parent_category: parentName } : a)))
    await supabase
      .from('financial_accounts')
      .update({ parent_category: parentName })
      .eq('id', fa.id)
      .eq('client_id', clientId)
  }

  if (loading)
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 300,
        }}
      >
        <div style={s.spinner} />
        <p style={{ fontSize: 12, color: T.charcoal, marginTop: 14 }}>Loading chart of accounts…</p>
      </div>
    )

  const activeSections = tab === 'pl' ? PL_SECTIONS : BS_SECTIONS
  const grouped = activeSections.reduce(
    (acc, sec) => {
      acc[sec] = accounts.filter(a => a.pl_section === sec)
      return acc
    },
    {} as Record<string, MergedAccount[]>,
  )

  const plCount = accounts.filter(a => isPLSection(a.pl_section)).length
  const bsCount = accounts.filter(a => isBSSection(a.pl_section)).length + finAccounts.length

  // Parent options for a financial account: CoA accounts in the matching BS sections
  function faParentOptions(fa: FinancialAccount): DisplayRow[] {
    const validSections =
      accountSection(fa.account_type) === 'asset'
        ? ['Current Assets', 'Non-Current Assets']
        : ['Current Liabilities', 'Non-Current Liabilities']
    return buildDisplayList(accounts.filter(a => validSections.includes(a.pl_section)))
  }

  return (
    <div style={{ background: T.page, minHeight: '100%' }}>
      <header style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Chart of Accounts</h1>
          <p style={s.pageSub}>Define accounts and assign them to P&amp;L or Balance Sheet sections.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saving && <span style={{ fontSize: 11, color: T.charcoal }}>Saving…</span>}
          {accounts.length === 0 && (
            <button style={s.btnPrimary} onClick={seedDefaults} disabled={saving}>
              Seed Default Accounts
            </button>
          )}
        </div>
      </header>

      <div style={{ padding: '20px 28px', maxWidth: 860 }}>
        {error && <div style={s.errorBox}>{error}</div>}

        {accounts.length === 0 && !loading && (
          <div style={s.infoBox}>
            No accounts yet. Click <strong>Seed Default Accounts</strong> to pre-populate the standard chart of accounts
            for a spa business.
          </div>
        )}

        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: `1px solid ${T.border}` }}>
          {[
            { key: 'pl', label: 'Income Statement (P&L)', count: plCount },
            { key: 'bs', label: 'Balance Sheet', count: bsCount },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key as 'pl' | 'bs')
                setAddingTo(null)
                setNewName('')
                setNewParent('')
              }}
              style={{
                padding: '8px 18px',
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
                fontSize: 12,
                fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? T.sage : T.charcoal,
                borderBottom: tab === t.key ? `2px solid ${T.sage}` : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t.label}
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  fontWeight: 500,
                  color: tab === t.key ? T.gold : '#9ca3af',
                  background: '#f1f5f9',
                  borderRadius: 10,
                  padding: '1px 6px',
                }}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {activeSections.map(section => {
          const sectionAccounts = grouped[section] ?? []
          const displayList = buildDisplayList(sectionAccounts)

          // Financial accounts that belong in this section
          const sectionFAs =
            tab === 'bs'
              ? finAccounts.filter(fa => {
                  if (!fa.parent_category) return section === FA_DEFAULT_SECTION[accountSection(fa.account_type)]
                  const parentCoA = accounts.find(a => a.name === fa.parent_category)
                  return parentCoA?.pl_section === section
                })
              : []

          const mergedList =
            tab === 'bs' ? mergeFARows(displayList, sectionFAs) : displayList.map(r => ({ kind: 'coa' as const, ...r }))

          // Build indented option list for parent dropdowns, excluding a given name
          const parentOptionRows = (excludeName?: string) => displayList.filter(r => r.account.name !== excludeName)

          return (
            <div key={section} style={s.sectionCard}>
              <div style={s.sectionHead}>
                <span style={s.sectionLabel}>{section}</span>
                <button
                  style={s.addBtn}
                  onClick={() => {
                    setAddingTo(addingTo === section ? null : section)
                    setNewName('')
                    setNewParent('')
                  }}
                >
                  + Add account
                </button>
              </div>

              {addingTo === section && (
                <div style={s.addForm}>
                  <input
                    autoFocus
                    style={s.input}
                    placeholder="Account name…"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') addAccount(section)
                      if (e.key === 'Escape') setAddingTo(null)
                    }}
                  />
                  <select
                    style={s.sectionSelect}
                    value={newParent}
                    onChange={e => setNewParent(e.target.value)}
                    title="Optional: nest this under a parent account"
                  >
                    <option value="">— Top Level —</option>
                    {parentOptionRows().map(r => (
                      <option key={r.account.name} value={r.account.name}>
                        {'  '.repeat(r.depth)}
                        {r.depth > 0 ? '└ ' : ''}
                        {r.account.name}
                      </option>
                    ))}
                  </select>
                  <button style={s.btnPrimary} onClick={() => addAccount(section)} disabled={!newName.trim() || saving}>
                    Add
                  </button>
                  <button style={s.btnSecondary} onClick={() => setAddingTo(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {mergedList.length === 0 && (
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '8px 14px 10px' }}>No accounts in this section.</p>
              )}

              <table style={s.table}>
                <tbody>
                  {mergedList.map(row => {
                    if (row.kind === 'fa') {
                      const { finAccount: fa, depth } = row
                      const isAsset = accountSection(fa.account_type) === 'asset'
                      const badgeColor = isAsset ? '#16a34a' : '#dc2626'
                      const badgeBg = isAsset ? '#dcfce7' : '#fee2e2'
                      return (
                        <tr
                          key={`fa-${fa.id}`}
                          style={s.row}
                          onMouseEnter={e => (e.currentTarget.style.background = T.page)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <td style={{ ...s.td, width: '99%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', paddingLeft: depth * 20 }}>
                              {depth > 0 && <span style={{ color: '#c0bbb4', marginRight: 6, fontSize: 11 }}>└</span>}
                              <span style={{ fontSize: 12, color: T.charcoal }}>
                                {fa.name}
                                {fa.last_four ? ` ••••${fa.last_four}` : ''}
                              </span>
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: 10,
                                  fontWeight: 500,
                                  color: badgeColor,
                                  background: badgeBg,
                                  borderRadius: 4,
                                  padding: '1px 6px',
                                }}
                              >
                                {ACCOUNT_TYPE_LABELS[fa.account_type]}
                              </span>
                            </div>
                          </td>
                          <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                            <select
                              style={s.sectionSelect}
                              value={fa.parent_category ?? ''}
                              onChange={e => changeFAParent(fa, e.target.value || null)}
                              title="Nest under a chart-of-accounts category"
                            >
                              <option value="">— Top Level —</option>
                              {faParentOptions(fa).map(r => (
                                <option key={r.account.name} value={r.account.name}>
                                  {'  '.repeat(r.depth)}
                                  {r.depth > 0 ? '└ ' : ''}
                                  {r.account.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                            <span
                              title="Managed on the Accounts page — cannot be deleted here"
                              style={{ ...s.iconBtn, cursor: 'default', color: '#D9D4C8', display: 'inline-block' }}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                              >
                                <rect x="3" y="11" width="18" height="11" rx="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                            </span>
                          </td>
                        </tr>
                      )
                    }

                    const { account: acc, depth } = row
                    const isChild = depth > 0
                    const isEditing = editKey === acc.name

                    return (
                      <tr
                        key={acc.name}
                        style={s.row}
                        onMouseEnter={e => (e.currentTarget.style.background = T.page)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ ...s.td, width: '99%' }}>
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              <input
                                autoFocus
                                style={{ ...s.input, margin: 0, fontSize: 12 }}
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveEdit(acc.name)
                                  if (e.key === 'Escape') setEditKey(null)
                                }}
                              />
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>Sub-account of:</span>
                                <select
                                  style={{ ...s.sectionSelect, fontSize: 10, padding: '3px 7px' }}
                                  value={editParent}
                                  onChange={e => setEditParent(e.target.value)}
                                >
                                  <option value="">— Top Level —</option>
                                  {parentOptionRows(acc.name).map(r => (
                                    <option key={r.account.name} value={r.account.name}>
                                      {'  '.repeat(r.depth)}
                                      {r.depth > 0 ? '└ ' : ''}
                                      {r.account.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  style={{ ...s.btnPrimary, padding: '3px 10px', fontSize: 10 }}
                                  onClick={() => saveEdit(acc.name)}
                                  disabled={saving}
                                >
                                  Save
                                </button>
                                <button
                                  style={{ ...s.btnSecondary, padding: '3px 8px', fontSize: 10 }}
                                  onClick={() => setEditKey(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', paddingLeft: depth * 20 }}>
                              {isChild && <span style={{ color: '#c0bbb4', marginRight: 6, fontSize: 11 }}>└</span>}
                              <span style={{ fontSize: 12, color: T.charcoal }}>{acc.name}</span>
                              {isChild && (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 10,
                                    color: '#9ca3af',
                                    background: '#f1f5f9',
                                    borderRadius: 4,
                                    padding: '1px 7px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                >
                                  {acc.parent}
                                  <button
                                    title="Remove parent"
                                    onClick={() => changeParent(acc.name, null)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      fontSize: 12,
                                      color: '#9ca3af',
                                      padding: 0,
                                      lineHeight: 1,
                                    }}
                                  >
                                    ×
                                  </button>
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                          <select
                            style={s.sectionSelect}
                            value={acc.pl_section}
                            onChange={e => changeSection(acc.name, e.target.value)}
                          >
                            <optgroup label="Income Statement">
                              {PL_SECTIONS.map(sec => (
                                <option key={sec} value={sec}>
                                  {sec}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Balance Sheet">
                              {BS_SECTIONS.map(sec => (
                                <option key={sec} value={sec}>
                                  {sec}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </td>

                        <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                          <button
                            style={s.iconBtn}
                            title="Edit"
                            onClick={() => {
                              setEditKey(acc.name)
                              setEditName(acc.name)
                              setEditParent(acc.parent ?? '')
                            }}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                            >
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            style={{ ...s.iconBtn, color: T.danger }}
                            title="Delete"
                            onClick={() => deleteAccount(acc.name)}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                              <path d="M9 6V4h6v2" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}

        <div style={{ ...s.sectionCard, marginTop: 8 }}>
          <div style={s.sectionHead}>
            <span style={s.sectionLabel}>Add Account</span>
          </div>
          <div style={s.addForm}>
            <input
              style={s.input}
              placeholder="Account name…"
              value={addingTo === '__global__' ? newName : ''}
              onChange={e => {
                setAddingTo('__global__')
                setNewName(e.target.value)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && addingTo === '__global__') addAccount(newSection)
                if (e.key === 'Escape') {
                  setAddingTo(null)
                  setNewName('')
                }
              }}
            />
            <select
              style={s.sectionSelect}
              value={newSection}
              onChange={e => {
                setNewSection(e.target.value)
                setNewParent('')
              }}
            >
              <optgroup label="Income Statement">
                {PL_SECTIONS.map(sec => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Balance Sheet">
                {BS_SECTIONS.map(sec => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </optgroup>
            </select>
            <select
              style={s.sectionSelect}
              value={newParent}
              onChange={e => setNewParent(e.target.value)}
              title="Optional: nest this under a parent account"
            >
              <option value="">— Top Level —</option>
              {buildDisplayList(accounts.filter(a => a.pl_section === newSection)).map(r => (
                <option key={r.account.name} value={r.account.name}>
                  {'  '.repeat(r.depth)}
                  {r.depth > 0 ? '└ ' : ''}
                  {r.account.name}
                </option>
              ))}
            </select>
            <button
              style={s.btnPrimary}
              disabled={!(addingTo === '__global__' && newName.trim()) || saving}
              onClick={() => addAccount(newSection)}
            >
              Add Account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const s = {
  pageHeader: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    padding: '14px 28px',
    background: '#FAFAF8',
    borderBottom: '1px solid #D9D4C8',
  },
  pageTitle: { fontSize: 14, fontWeight: 600, color: '#2C5F52', margin: '0 0 2px' },
  pageSub: { fontSize: 11, color: 'rgba(74,74,63,0.65)', margin: 0 },
  spinner: {
    width: 28,
    height: 28,
    border: '2px solid #D9D4C8',
    borderTopColor: '#2C5F52',
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
    marginBottom: 16,
  },
  infoBox: {
    background: '#E8F0EE',
    border: '1px solid #B8D4CC',
    borderRadius: 6,
    padding: '10px 14px',
    fontSize: 11,
    color: '#2C5F52',
    marginBottom: 16,
  },
  sectionCard: {
    background: '#FAFAF8',
    border: '1px solid #D9D4C8',
    borderRadius: 7,
    marginBottom: 12,
    overflow: 'hidden' as const,
  },
  sectionHead: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: '8px 14px',
    background: '#F5F0E8',
    borderBottom: '1px solid #D9D4C8',
  },
  sectionLabel: {
    fontSize: 9.5,
    fontWeight: 700,
    color: '#C8A96E',
    textTransform: 'uppercase' as const,
    letterSpacing: '.07em',
  },
  addBtn: {
    fontSize: 11,
    fontWeight: 500,
    color: '#2C5F52',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 0',
  },
  addForm: {
    display: 'flex' as const,
    gap: 8,
    padding: '10px 14px',
    alignItems: 'center' as const,
    borderBottom: '1px solid #F0EEE9',
    flexWrap: 'wrap' as const,
  },
  input: {
    flex: 1,
    padding: '5px 9px',
    border: '1px solid #D9D4C8',
    borderRadius: 5,
    fontSize: 12,
    color: '#2C5F52',
    background: '#fff',
    outline: 'none',
  },
  sectionSelect: {
    padding: '5px 9px',
    border: '1px solid #D9D4C8',
    borderRadius: 5,
    fontSize: 11,
    color: '#4A4A3F',
    background: '#fff',
    outline: 'none',
  },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  row: { borderBottom: '1px solid #F0EEE9', transition: 'background .1s' },
  td: { padding: '7px 14px', verticalAlign: 'middle' as const },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#9ca3af',
    padding: '3px 5px',
    borderRadius: 4,
    lineHeight: 0,
  },
  btnPrimary: {
    padding: '5px 14px',
    background: '#2C5F52',
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnSecondary: {
    padding: '5px 12px',
    background: '#fff',
    color: '#4A4A3F',
    border: '1px solid #D9D4C8',
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  },
}
